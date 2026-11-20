import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { runAppStartup } from '../../services/app-startup'
import { fileStorageService, FILE_LINK_TIMEOUT_MS, LINK_UNREAD_ERROR, type LaunchPermissionInfo } from '../../services/file-storage'
import { loadFileHandle, saveFileHandle } from '../../services/file-handle-idb'
import { storagePillState } from '../../components/layout/sync-status'
import { useFileStorageStore } from '../../services/file-storage-store'
import { useSettingsStore } from '../../stores/settings-store'
import { usePersonStore } from '../../stores/person-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { backupScheduler } from '../../data/backup-scheduler'
import { todoRepository } from '../../data/todo-repository'
import { db } from '../../data/database'
import { SETTING_KEYS } from '../../data/setting-keys'
import { makeTodo } from '../helpers'

// The launch sequence around the sync file's launch question: nothing reads,
// purges or backs up this browser's data before the user answered.

type WithLaunchHandler = { launchPermissionHandler: ((info: LaunchPermissionInfo) => Promise<void>) | null }

/** The service's launch step as it runs when the stored handle needs permission: ask, wait. */
function askAtLaunch() {
  return vi.spyOn(fileStorageService, 'initialize').mockImplementation(async () => {
    const ask = (fileStorageService as unknown as WithLaunchHandler).launchPermissionHandler
    await ask?.({ fileName: 'todo2.json' })
  })
}

/** Lets every pending promise / timer callback run. */
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }

const DAY = 86_400_000
let expiredUid = ''

beforeEach(async () => {
  await db.settings.put({ key: SETTING_KEYS.completedRetentionDays, value: '30' })
  const old = new Date(Date.now() - 90 * DAY)
  const todo = makeTodo({ id: 1, isCompleted: true, completedAt: old, createdAt: old, modifiedAt: old })
  expiredUid = todo.uid
  await db.todos.clear()
  await db.todos.add(todo)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function spyLaunchWork() {
  return {
    people: vi.spyOn(usePersonStore.getState(), 'ensureLoaded'),
    statuses: vi.spyOn(useStatusStore.getState(), 'ensureLoaded'),
    tags: vi.spyOn(useTagStore.getState(), 'ensureLoaded'),
    readTasks: vi.spyOn(todoRepository, 'getAll'),
    backups: vi.spyOn(backupScheduler, 'start').mockImplementation(() => {}),
  }
}

describe('runAppStartup — the launch question', () => {
  it('waits for the answer: no store load, no purge check, no backups before it; all of them after', async () => {
    askAtLaunch()
    const work = spyLaunchWork()
    const onPurgeCheck = vi.fn()

    let result: Awaited<ReturnType<typeof runAppStartup>> | null = null
    const run = runAppStartup({ onPurgeCheck }).then((r) => { result = r })
    await settle()

    // Settings (the theme) loaded, and the question is up …
    expect(useSettingsStore.getState().completedRetentionDays).toBe(30)
    expect(useFileStorageStore.getState().pendingLaunchPermission).toEqual({ fileName: 'todo2.json', phase: 'ask' })
    // … and nothing else ran.
    expect(work.people).not.toHaveBeenCalled()
    expect(work.statuses).not.toHaveBeenCalled()
    expect(work.tags).not.toHaveBeenCalled()
    expect(onPurgeCheck).not.toHaveBeenCalled()
    expect(work.readTasks).not.toHaveBeenCalled()
    expect(work.backups).not.toHaveBeenCalled()
    expect(result).toBeNull()

    useFileStorageStore.getState().continueWithoutFile()
    await run

    expect(work.people).toHaveBeenCalled()
    expect(work.statuses).toHaveBeenCalled()
    expect(work.tags).toHaveBeenCalled()
    expect(onPurgeCheck).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ expiredUids: new Set([expiredUid]) })
    // In order: the stores, the purge check, then automatic backups.
    const order = (spy: { mock: { invocationCallOrder: number[] } }) => spy.mock.invocationCallOrder[0] ?? 0
    expect(order(work.people)).toBeLessThan(order(work.readTasks))
    expect(order(work.readTasks)).toBeLessThan(order(work.backups))
  })

  it('Grant access: launch goes on only once the file has loaded', async () => {
    askAtLaunch()
    const work = spyLaunchWork()
    let finishLoad!: () => void
    vi.spyOn(fileStorageService, 'reconnect').mockImplementation(async ({ onGranted } = {}) => {
      onGranted?.()
      await new Promise<void>((resolve) => { finishLoad = resolve })
    })

    const run = runAppStartup()
    await settle()
    useFileStorageStore.getState().grantLaunchPermission()
    await settle()

    // Granted: the question is gone while the file loads; launch still waits.
    expect(useFileStorageStore.getState().pendingLaunchPermission).toBeNull()
    expect(work.people).not.toHaveBeenCalled()
    expect(work.readTasks).not.toHaveBeenCalled()
    expect(work.backups).not.toHaveBeenCalled()

    finishLoad()
    await expect(run).resolves.toEqual({ expiredUids: new Set([expiredUid]) })
    expect(work.backups).toHaveBeenCalledTimes(1)
  })

  it('no question (no file, or access already granted): straight through', async () => {
    vi.spyOn(fileStorageService, 'initialize').mockResolvedValue(undefined)
    const work = spyLaunchWork()
    await expect(runAppStartup()).resolves.toEqual({ expiredUids: new Set([expiredUid]) })
    expect(useFileStorageStore.getState().pendingLaunchPermission).toBeNull()
    expect(work.backups).toHaveBeenCalledTimes(1)
  })

  it('makes no list: a launch on data without any writes none', async () => {
    vi.spyOn(fileStorageService, 'initialize').mockResolvedValue(undefined)
    spyLaunchWork()
    await db.listDefinitions.clear()
    await runAppStartup()
    expect(await db.listDefinitions.count()).toBe(0)
  })
})

describe('runAppStartup — the steps it reports', () => {
  it('database, then the sync file, then tasks: each as it begins', async () => {
    const steps: string[] = []
    const initialize = vi.spyOn(fileStorageService, 'initialize').mockImplementation(async () => { steps.push('(initialize)') })
    const work = spyLaunchWork()
    work.people.mockImplementation(async () => { steps.push('(stores)') })
    await runAppStartup({ onStep: (step) => steps.push(step) })
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(steps).toEqual(['database', 'sync-file', '(initialize)', 'tasks', '(stores)'])
  })
})

// The real service over the real link database: the browser never hands the
// stored file handle over (the read of its row never answers).
describe('runAppStartup — a stored file handle the browser never hands over', () => {
  const storedLink = { kind: 'file', name: 'todo2.json' }

  /** Lets the database work in flight run (it schedules with setImmediate, which stays real). */
  const settleReal = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)) }

  beforeEach(async () => {
    vi.stubGlobal('showOpenFilePicker', vi.fn())
    await saveFileHandle(storedLink as unknown as FileSystemFileHandle)
    const realGet = IDBObjectStore.prototype.get
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
      if (this.name !== 'handles') return realGet.call(this, key)
      return {} as IDBRequest
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** The stored link as the next start would read it. */
  async function linkNow() {
    vi.mocked(IDBObjectStore.prototype.get).mockRestore()
    return loadFileHandle()
  }

  const pill = () => {
    const s = useFileStorageStore.getState()
    return storagePillState({
      isConnected: s.isConnected, fileName: s.fileName, needsPermission: s.needsPermission, paused: s.paused,
      error: s.error, dismissedError: s.dismissedError, snapshotWarning: null,
    })
  }

  it('launch completes without the file after the timeout; the pill says so; tasks and the stored link are untouched', async () => {
    const work = spyLaunchWork()
    let result: Awaited<ReturnType<typeof runAppStartup>> | null = null
    void runAppStartup().then((r) => { result = r })
    await settleReal()

    // Waiting for the browser: nothing else ran yet.
    expect(useFileStorageStore.getState().launchWait).toBe('link')
    expect(work.people).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(FILE_LINK_TIMEOUT_MS - 1)
    await settleReal()
    expect(result).toBeNull()

    await vi.advanceTimersByTimeAsync(1)
    await settleReal()
    expect(result).toEqual({ expiredUids: new Set([expiredUid]) })
    expect(work.backups).toHaveBeenCalledTimes(1)
    expect(useFileStorageStore.getState()).toMatchObject({
      launchWait: null, fileName: null, needsPermission: false, pendingLaunchPermission: null, error: LINK_UNREAD_ERROR,
    })
    expect(pill()).toMatchObject({ kind: 'error', text: 'Sync error' })
    expect(await db.todos.count()).toBe(1)
    expect(await linkNow()).toEqual(storedLink)
  })

  it('Forget the sync file while it waits: the stored link is cleared and launch goes on; the tasks stay', async () => {
    const work = spyLaunchWork()
    let result: Awaited<ReturnType<typeof runAppStartup>> | null = null
    void runAppStartup().then((r) => { result = r })
    await settleReal()
    expect(useFileStorageStore.getState().launchWait).toBe('link')

    useFileStorageStore.getState().forgetLaunchFile()
    await settleReal()
    // At once: no timeout to wait for.
    expect(result).toEqual({ expiredUids: new Set([expiredUid]) })
    expect(work.backups).toHaveBeenCalledTimes(1)
    expect(useFileStorageStore.getState()).toMatchObject({ launchWait: null, fileName: null, needsPermission: false, error: null })
    expect(pill()).toMatchObject({ kind: 'local' })
    expect(await db.todos.count()).toBe(1)
    expect((await db.todos.toArray())[0]?.uid).toBe(expiredUid)
    expect(await linkNow()).toBeNull()
  })

  it('Continue without the file while it waits: launch goes on at once, the stored link kept for the next start', async () => {
    spyLaunchWork()
    let result: Awaited<ReturnType<typeof runAppStartup>> | null = null
    void runAppStartup().then((r) => { result = r })
    await settleReal()

    useFileStorageStore.getState().skipLaunchFile()
    await settleReal()
    expect(result).not.toBeNull()
    expect(useFileStorageStore.getState()).toMatchObject({ launchWait: null, fileName: null, error: LINK_UNREAD_ERROR })
    expect(await db.todos.count()).toBe(1)
    expect(await linkNow()).toEqual(storedLink)
  })
})
