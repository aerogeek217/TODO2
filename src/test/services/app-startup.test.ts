import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { runAppStartup } from '../../services/app-startup'
import { fileStorageService, type LaunchPermissionInfo } from '../../services/file-storage'
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
})
