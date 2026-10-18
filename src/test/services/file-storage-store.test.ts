import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SyncConflictInfo, FileUpgradeInfo, SyncConflictChoice } from '../../services/file-storage'
import type { UnsupportedImportInfo } from '../../data/file-version'

// The store's wiring to the service, with the service's subscribe calls captured.
const wiring = vi.hoisted(() => ({
  status: [] as Array<(s: unknown) => void>,
  before: [] as Array<() => Promise<() => void>>,
  after: [] as Array<() => Promise<void>>,
  migration: null as null | ((info: unknown) => Promise<boolean>),
  conflict: null as null | ((info: unknown) => Promise<SyncConflictChoice>),
  upgrade: null as null | ((info: unknown) => Promise<boolean>),
  launch: null as null | ((info: { fileName: string }) => Promise<void>),
  /** What the next `reconnect` does: the browser's answer, and when it resolves. */
  reconnect: vi.fn<(opts?: { onGranted?: () => void }) => Promise<void>>(() => Promise.resolve()),
}))

vi.mock('../../services/file-storage', () => ({
  fileStorageService: {
    isSupported: true,
    onStatusChange: (l: (s: unknown) => void) => { wiring.status.push(l); return () => {} },
    onBeforeImport: (l: () => Promise<() => void>) => { wiring.before.push(l); return () => {} },
    onAfterImport: (l: () => Promise<void>) => { wiring.after.push(l); return () => {} },
    onConfirmMigration: (h: (info: unknown) => Promise<boolean>) => { wiring.migration = h; return () => {} },
    onConflict: (h: (info: unknown) => Promise<SyncConflictChoice>) => { wiring.conflict = h; return () => {} },
    onConfirmFileUpgrade: (h: (info: unknown) => Promise<boolean>) => { wiring.upgrade = h; return () => {} },
    onLaunchPermission: (h: (info: { fileName: string }) => Promise<void>) => { wiring.launch = h; return () => {} },
    reconnect: (opts?: { onGranted?: () => void }) => wiring.reconnect(opts),
  },
}))

const { useFileStorageStore, resetFileStoragePrompts } = await import('../../services/file-storage-store')

const conflictInfo = (fileName: string) => ({ fileName }) as SyncConflictInfo
const upgradeInfo: FileUpgradeInfo = { fileName: 'a.json', fromVersion: 49, toVersion: 63 }
const legacyInfo = { version: 12 } as unknown as UnsupportedImportInfo

beforeEach(() => {
  resetFileStoragePrompts()
  useFileStorageStore.setState(useFileStorageStore.getInitialState(), true)
  wiring.reconnect.mockReset().mockResolvedValue(undefined)
})

/** Sets the store's status as the service would report it. */
function reportStatus(status: { needsPermission: boolean; error?: string | null }) {
  wiring.status[0]!({ isConnected: false, fileName: 'todo2.json', lastSavedAt: null, error: null, paused: null, ...status })
}

/** Resolves once pending promise callbacks ran. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('file-storage store — wiring', () => {
  it('subscribes once to each service event when created', () => {
    expect(wiring.status).toHaveLength(1)
    expect(wiring.before).toHaveLength(1)
    expect(wiring.after).toHaveLength(1)
    expect(wiring.migration && wiring.conflict && wiring.upgrade && wiring.launch).toBeTruthy()
  })

  it('a status change lands in the store', () => {
    wiring.status[0]!({ isConnected: true, fileName: 'x.json', lastSavedAt: null, needsPermission: false, error: null, paused: null })
    expect(useFileStorageStore.getState()).toMatchObject({ isConnected: true, fileName: 'x.json' })
  })

  it('a dismissed error is forgotten once it clears, so the same error later shows again', () => {
    reportStatus({ needsPermission: false, error: 'Failed to save to file' })
    useFileStorageStore.getState().dismissError()
    expect(useFileStorageStore.getState().dismissedError).toBe('Failed to save to file')
    // Still failing: stays dismissed.
    reportStatus({ needsPermission: false, error: 'Failed to save to file' })
    expect(useFileStorageStore.getState().dismissedError).toBe('Failed to save to file')
    // A save worked, then the same failure came back.
    reportStatus({ needsPermission: false, error: null })
    reportStatus({ needsPermission: false, error: 'Failed to save to file' })
    expect(useFileStorageStore.getState().dismissedError).toBeNull()
  })
})

describe('file-storage store — waiting questions', () => {
  it('a second conflict answers the first as cancelled instead of leaving it waiting', async () => {
    const first = wiring.conflict!(conflictInfo('first.json'))
    const second = wiring.conflict!(conflictInfo('second.json'))
    await expect(first).resolves.toBe('cancel')
    expect(useFileStorageStore.getState().pendingConflict?.fileName).toBe('second.json')
    useFileStorageStore.getState().resolveConflict('file')
    await expect(second).resolves.toBe('file')
    expect(useFileStorageStore.getState().pendingConflict).toBeNull()
  })

  it('a second upgrade or migration question answers the first with no', async () => {
    const upgrade1 = wiring.upgrade!(upgradeInfo)
    const upgrade2 = wiring.upgrade!(upgradeInfo)
    await expect(upgrade1).resolves.toBe(false)
    useFileStorageStore.getState().resolveFileUpgrade(true)
    await expect(upgrade2).resolves.toBe(true)

    const legacy1 = wiring.migration!(legacyInfo)
    const legacy2 = wiring.migration!(legacyInfo)
    await expect(legacy1).resolves.toBe(false)
    useFileStorageStore.getState().confirmLegacyImport()
    await expect(legacy2).resolves.toBe(true)
  })

  it('the test reset answers every waiting question as cancelled', async () => {
    const conflict = wiring.conflict!(conflictInfo('a.json'))
    const upgrade = wiring.upgrade!(upgradeInfo)
    const legacy = wiring.migration!(legacyInfo)
    resetFileStoragePrompts()
    await expect(conflict).resolves.toBe('cancel')
    await expect(upgrade).resolves.toBe(false)
    await expect(legacy).resolves.toBe(false)
    // Nothing left to answer: a later resolve is a no-op.
    useFileStorageStore.getState().resolveConflict('browser')
  })
})

describe('file-storage store — the launch question', () => {
  it('asks, and Continue without the file answers it: launch goes on, nothing asked of the browser', async () => {
    let answered = false
    const question = wiring.launch!({ fileName: 'todo2.json' }).then(() => { answered = true })
    expect(useFileStorageStore.getState().pendingLaunchPermission).toEqual({ fileName: 'todo2.json', phase: 'ask' })
    await flush()
    expect(answered).toBe(false)

    useFileStorageStore.getState().continueWithoutFile()
    await question
    expect(answered).toBe(true)
    expect(useFileStorageStore.getState().pendingLaunchPermission).toBeNull()
    expect(wiring.reconnect).not.toHaveBeenCalled()
  })

  it('Grant access: waiting while the browser asks; the question closes once granted, launch goes on after the load', async () => {
    let finishLoad!: () => void
    wiring.reconnect.mockImplementation(async (opts) => {
      reportStatus({ needsPermission: false })
      opts?.onGranted?.()
      await new Promise<void>((resolve) => { finishLoad = resolve })
    })
    reportStatus({ needsPermission: true })
    let answered = false
    const question = wiring.launch!({ fileName: 'todo2.json' }).then(() => { answered = true })

    useFileStorageStore.getState().grantLaunchPermission()
    expect(wiring.reconnect).toHaveBeenCalledTimes(1)
    // Granted: the question is gone while the file loads (its prompts show over the start screen) …
    expect(useFileStorageStore.getState().pendingLaunchPermission).toBeNull()
    await flush()
    // … but launch waits for the load.
    expect(answered).toBe(false)
    finishLoad()
    await question
    expect(answered).toBe(true)
  })

  it('refused: the question stays with the refusal; Try again asks the browser again', async () => {
    reportStatus({ needsPermission: true })
    let releaseReconnect!: () => void
    wiring.reconnect.mockImplementation(() => new Promise<void>((resolve) => { releaseReconnect = resolve }))
    let answered = false
    void wiring.launch!({ fileName: 'todo2.json' }).then(() => { answered = true })

    useFileStorageStore.getState().grantLaunchPermission()
    expect(useFileStorageStore.getState().pendingLaunchPermission?.phase).toBe('waiting')
    reportStatus({ needsPermission: true, error: 'Permission denied' })
    releaseReconnect()
    await flush()
    expect(useFileStorageStore.getState().pendingLaunchPermission).toEqual({ fileName: 'todo2.json', phase: 'refused' })
    expect(answered).toBe(false)

    wiring.reconnect.mockImplementation(async (opts) => { reportStatus({ needsPermission: false }); opts?.onGranted?.() })
    useFileStorageStore.getState().grantLaunchPermission()
    await flush()
    expect(wiring.reconnect).toHaveBeenCalledTimes(2)
    expect(answered).toBe(true)
  })

  it('Continue while the browser still asks: launch goes on; a late grant changes nothing about the answered question', async () => {
    reportStatus({ needsPermission: true })
    let grantLate!: () => void
    wiring.reconnect.mockImplementation((opts) => new Promise<void>((resolve) => {
      grantLate = () => { reportStatus({ needsPermission: false }); opts?.onGranted?.(); resolve() }
    }))
    let answers = 0
    void wiring.launch!({ fileName: 'todo2.json' }).then(() => { answers++ })
    useFileStorageStore.getState().grantLaunchPermission()
    useFileStorageStore.getState().continueWithoutFile()
    await flush()
    expect(answers).toBe(1)

    // The next launch question (a later start) isn't touched by the late grant.
    void wiring.launch!({ fileName: 'todo2.json' })
    grantLate()
    await flush()
    expect(useFileStorageStore.getState().pendingLaunchPermission).toEqual({ fileName: 'todo2.json', phase: 'ask' })
    expect(answers).toBe(1)
  })

  it('the test reset answers a waiting launch question', async () => {
    const question = wiring.launch!({ fileName: 'todo2.json' })
    resetFileStoragePrompts()
    await expect(question).resolves.toBeUndefined()
  })
})
