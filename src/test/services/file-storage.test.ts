import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SyncConflictInfo } from '../../services/file-storage'

// ─── Mocks ────────────────────────────────────────────────────────────

const mockLoadFileHandle = vi.fn().mockResolvedValue(null)
const mockSaveFileHandle = vi.fn().mockResolvedValue(undefined)
const mockClearFileHandle = vi.fn().mockResolvedValue(undefined)

vi.mock('../../services/file-handle-idb', () => ({
  saveFileHandle: (...args: unknown[]) => mockSaveFileHandle(...args),
  loadFileHandle: (...args: unknown[]) => mockLoadFileHandle(...args),
  clearFileHandle: (...args: unknown[]) => mockClearFileHandle(...args),
}))

const mockValidateImportData = vi.fn()

vi.mock('../../data/import-validation', () => ({
  validateImportData: (...args: unknown[]) => mockValidateImportData(...args),
  MAX_IMPORT_SIZE_BYTES: 50 * 1024 * 1024,
  MAX_RECORDS_PER_TABLE: 100_000,
}))

const mockRestoreFromImportData = vi.fn().mockResolvedValue(undefined)

vi.mock('../../data/restore', () => ({
  restoreFromImportData: (...args: unknown[]) => mockRestoreFromImportData(...args),
}))

const mockBuildExportData = vi.fn().mockResolvedValue({ todos: [], projects: [] })

const mockSelfCheckExportJson = vi.fn<(json: string) => string | null>(() => null)

vi.mock('../../data/export-data', () => ({
  buildExportData: (...args: unknown[]) => mockBuildExportData(...args),
  selfCheckExportJson: (json: string) => mockSelfCheckExportJson(json),
}))

const mockSnapshotBeforeDestructive = vi.fn().mockResolvedValue(undefined)
const mockSnapshotFileBeforeOverwrite = vi.fn().mockResolvedValue(undefined)

vi.mock('../../data/backup-scheduler', () => ({
  backupScheduler: {
    snapshotBeforeDestructive: (...args: unknown[]) => mockSnapshotBeforeDestructive(...args),
    snapshotFileBeforeOverwrite: (...args: unknown[]) => mockSnapshotFileBeforeOverwrite(...args),
  },
}))

const mockBrowserMatchesFile = vi.fn().mockResolvedValue(false)
const mockBrowserTaskCount = vi.fn().mockResolvedValue(0)

vi.mock('../../services/file-sync-compare', () => ({
  browserMatchesFile: (...args: unknown[]) => mockBrowserMatchesFile(...args),
  browserTaskCount: (...args: unknown[]) => mockBrowserTaskCount(...args),
}))

// Mock ALL_DATA_TABLES with a hook API whose handlers we can fire to
// simulate local writes.
type Handler = () => void
function makeMockTable() {
  const hooks: Record<string, { subscribe: ReturnType<typeof vi.fn>; unsubscribe: ReturnType<typeof vi.fn>; handlers: Set<Handler> }> = {}
  return {
    hook: (name: string) => {
      if (!hooks[name]) {
        const handlers = new Set<Handler>()
        hooks[name] = {
          handlers,
          subscribe: vi.fn((h: Handler) => { handlers.add(h) }),
          unsubscribe: vi.fn((h: Handler) => { handlers.delete(h) }),
        }
      }
      return hooks[name]
    },
    _hooks: hooks,
  }
}

const mockTables = Array.from({ length: 14 }, () => makeMockTable())

/** Simulate one local DB write (fires every subscribed `creating` hook on table 0). */
function fireLocalChange() {
  for (const h of mockTables[0]!.hook('creating').handlers) h()
}

vi.mock('../../data/database', () => ({
  ALL_DATA_TABLES: mockTables,
  CURRENT_DB_VERSION: 48,
  OLDEST_SUPPORTED_DB_VERSION: 16,
}))

// ─── Helpers ──────────────────────────────────────────────────────────

const SYNC_KEY = 'todo2-file-sync-state'
const FILE_SAVED_AT = '2026-10-01T10:00:00.000Z'

function makeWritable() {
  return {
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
  }
}

function fileBody(overrides: Record<string, unknown> = {}) {
  return { __schemaVersion: 48, savedAt: FILE_SAVED_AT, canvases: [{ id: 1 }], todos: [], ...overrides }
}

function createMockHandle(content: unknown = fileBody(), overrides: Record<string, unknown> = {}) {
  const writable = makeWritable()
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  return {
    writable,
    handle: {
      kind: 'file',
      name: 'todo2-data.json',
      getFile: vi.fn().mockResolvedValue(new File([text], 'todo2-data.json', { type: 'application/json' })),
      queryPermission: vi.fn().mockResolvedValue('granted'),
      requestPermission: vi.fn().mockResolvedValue('granted'),
      createWritable: vi.fn().mockResolvedValue(writable),
      isSameEntry: vi.fn(),
      ...overrides,
    },
  }
}

const validImportData = { todos: [{ id: 1 }, { id: 2 }], canvases: [{ id: 1, name: 'Default' }] }

function setSyncState(state: { fileSavedAt: string | null; dirtySince: string | null }) {
  localStorage.setItem(SYNC_KEY, JSON.stringify(state))
}
function syncState(): { fileSavedAt: string | null; dirtySince: string | null } {
  return JSON.parse(localStorage.getItem(SYNC_KEY) ?? '{"fileSavedAt":null,"dirtySince":null}')
}

async function getService() {
  const mod = await import('../../services/file-storage')
  return mod.fileStorageService
}

async function startWith(content: unknown = fileBody(), handleOverrides: Record<string, unknown> = {}) {
  const { handle, writable } = createMockHandle(content, handleOverrides)
  mockLoadFileHandle.mockResolvedValue(handle)
  const svc = await getService()
  return { svc, handle, writable }
}

function expectUntouched(writable: ReturnType<typeof makeWritable>) {
  expect(mockRestoreFromImportData).not.toHaveBeenCalled()
  expect(writable.write).not.toHaveBeenCalled()
  expect(mockSnapshotFileBeforeOverwrite).not.toHaveBeenCalled()
}

/** Edits after a pause must never reach the file. */
async function expectNoWriteAfterChange(writable: ReturnType<typeof makeWritable>) {
  fireLocalChange()
  await vi.advanceTimersByTimeAsync(2000)
  expect(writable.write).not.toHaveBeenCalled()
  expect(syncState().dirtySince).not.toBeNull()
}

// ─── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  localStorage.clear()

  mockLoadFileHandle.mockReset().mockResolvedValue(null)
  mockSaveFileHandle.mockReset().mockResolvedValue(undefined)
  mockClearFileHandle.mockReset().mockResolvedValue(undefined)
  mockValidateImportData.mockReset().mockReturnValue({ ok: true, data: validImportData, warnings: [] })
  mockRestoreFromImportData.mockReset().mockResolvedValue(undefined)
  mockBuildExportData.mockReset().mockResolvedValue({ todos: [], projects: [] })
  mockSelfCheckExportJson.mockReset().mockReturnValue(null)
  mockSnapshotBeforeDestructive.mockReset().mockResolvedValue(undefined)
  mockSnapshotFileBeforeOverwrite.mockReset().mockResolvedValue(undefined)
  mockBrowserMatchesFile.mockReset().mockResolvedValue(false)
  mockBrowserTaskCount.mockReset().mockResolvedValue(0)

  for (const table of mockTables) {
    for (const hookName of ['creating', 'updating', 'deleting']) {
      const h = table._hooks[hookName]
      if (h) {
        h.subscribe.mockClear()
        h.unsubscribe.mockClear()
        h.handlers.clear()
      }
    }
  }

  vi.stubGlobal('showOpenFilePicker', vi.fn())
  vi.stubGlobal('showSaveFilePicker', vi.fn())
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ─── isSupported ──────────────────────────────────────────────────────

describe('FileStorageService — isSupported', () => {
  it('returns true when showOpenFilePicker exists on window', async () => {
    const svc = await getService()
    expect(svc.isSupported).toBe(true)
  })

  it('returns false when showOpenFilePicker is absent', async () => {
    delete (window as any).showOpenFilePicker
    const svc = await getService()
    expect(svc.isSupported).toBe(false)
  })
})

// ─── Startup decision matrix ──────────────────────────────────────────

describe('FileStorageService — load decision matrix', () => {
  it('does nothing when no saved handle exists', async () => {
    const svc = await getService()
    await svc.initialize()
    expect(svc.status.isConnected).toBe(false)
    expect(svc.status.fileName).toBeNull()
  })

  it('in sync (file unchanged, browser clean) → loads the file, no prompt, no write', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: null })
    const { svc, writable } = await startWith()
    const conflict = vi.fn()
    svc.onConflict(conflict)
    await svc.initialize()

    expect(conflict).not.toHaveBeenCalled()
    expect(mockSnapshotBeforeDestructive).toHaveBeenCalled()
    expect(mockRestoreFromImportData).toHaveBeenCalledWith(validImportData)
    expect(writable.write).not.toHaveBeenCalled()
    expect(svc.status.isConnected).toBe(true)
    expect(syncState()).toEqual({ fileSavedAt: FILE_SAVED_AT, dirtySince: null })
  })

  it('file changed elsewhere, browser clean → loads the file without asking (multi-machine)', async () => {
    setSyncState({ fileSavedAt: '2026-09-01T00:00:00.000Z', dirtySince: null })
    const { svc } = await startWith()
    const conflict = vi.fn()
    svc.onConflict(conflict)
    await svc.initialize()

    expect(conflict).not.toHaveBeenCalled()
    expect(mockRestoreFromImportData).toHaveBeenCalled()
    expect(syncState().fileSavedAt).toBe(FILE_SAVED_AT)
  })

  it('browser has unsynced changes, file unchanged → conflict before anything changes', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: '2026-10-02T09:00:00.000Z' })
    mockBrowserTaskCount.mockResolvedValue(5)
    const { svc, writable } = await startWith()
    let seen: SyncConflictInfo | null = null
    svc.onConflict(async (info) => {
      seen = info
      // Nothing may have changed while the user is deciding.
      expect(mockRestoreFromImportData).not.toHaveBeenCalled()
      expect(writable.write).not.toHaveBeenCalled()
      return 'cancel'
    })
    await svc.initialize()

    expect(seen).toMatchObject({
      reason: 'browser-changes',
      browser: { taskCount: 5, schemaVersion: 48, unsyncedSince: '2026-10-02T09:00:00.000Z' },
      file: { taskCount: 2, schemaVersion: 48, savedAt: FILE_SAVED_AT, changedSinceLastSync: false },
    })
    expectUntouched(writable)
    expect(svc.status.paused?.reason).toBe('conflict-cancelled')
    expect(svc.status.isConnected).toBe(false)
    await expectNoWriteAfterChange(writable)
  })

  it('both sides changed → conflict reports the file as changed; "Use file" snapshots the browser and restores', async () => {
    setSyncState({ fileSavedAt: '2026-09-01T00:00:00.000Z', dirtySince: '2026-10-02T09:00:00.000Z' })
    const { svc, writable } = await startWith()
    let seen: SyncConflictInfo | null = null
    svc.onConflict(async (info) => { seen = info; return 'file' })
    await svc.initialize()

    expect(seen!.file.changedSinceLastSync).toBe(true)
    expect(mockSnapshotBeforeDestructive).toHaveBeenCalled()
    expect(mockRestoreFromImportData).toHaveBeenCalledWith(validImportData)
    expect(writable.write).not.toHaveBeenCalled()
    expect(svc.status.isConnected).toBe(true)
    expect(syncState()).toEqual({ fileSavedAt: FILE_SAVED_AT, dirtySince: null })
  })

  it('"Use browser data" backs up the file text, overwrites the file, and resumes sync', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: '2026-10-02T09:00:00.000Z' })
    const { svc, writable } = await startWith()
    svc.onConflict(async () => 'browser')
    await svc.initialize()

    expect(mockSnapshotFileBeforeOverwrite).toHaveBeenCalledWith(JSON.stringify(fileBody()))
    expect(mockRestoreFromImportData).not.toHaveBeenCalled()
    expect(writable.write).toHaveBeenCalledTimes(1)
    expect(svc.status.isConnected).toBe(true)
    const state = syncState()
    expect(state.dirtySince).toBeNull()
    expect(state.fileSavedAt).not.toBe(FILE_SAVED_AT)
  })

  it('unsynced changes but identical data on both sides → no prompt', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: '2026-10-02T09:00:00.000Z' })
    mockBrowserMatchesFile.mockResolvedValue(true)
    const { svc } = await startWith()
    const conflict = vi.fn()
    svc.onConflict(conflict)
    await svc.initialize()

    expect(conflict).not.toHaveBeenCalled()
    expect(svc.status.isConnected).toBe(true)
    expect(syncState().dirtySince).toBeNull()
  })

  it('no sync record + browser has tasks + different data → conflict (no-sync-record)', async () => {
    mockBrowserTaskCount.mockResolvedValue(3)
    const { svc, writable } = await startWith()
    let seen: SyncConflictInfo | null = null
    svc.onConflict(async (info) => { seen = info; return 'cancel' })
    await svc.initialize()

    expect(seen!.reason).toBe('no-sync-record')
    expect(seen!.file.changedSinceLastSync).toBeNull()
    expectUntouched(writable)
  })

  it('no sync record + identical data → adopts the file silently', async () => {
    mockBrowserTaskCount.mockResolvedValue(3)
    mockBrowserMatchesFile.mockResolvedValue(true)
    const { svc } = await startWith()
    const conflict = vi.fn()
    svc.onConflict(conflict)
    await svc.initialize()

    expect(conflict).not.toHaveBeenCalled()
    expect(syncState().fileSavedAt).toBe(FILE_SAVED_AT)
  })

  it('no sync record + empty browser → loads the file without asking', async () => {
    const { svc } = await startWith()
    const conflict = vi.fn()
    svc.onConflict(conflict)
    await svc.initialize()

    expect(conflict).not.toHaveBeenCalled()
    expect(mockRestoreFromImportData).toHaveBeenCalled()
  })

  it('conflict with no dialog listener stays paused (safe default)', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: '2026-10-02T09:00:00.000Z' })
    const { svc, writable } = await startWith()
    await svc.initialize()
    expectUntouched(writable)
    expect(svc.status.paused?.reason).toBe('conflict-cancelled')
  })

  it("the restore's own writes are not recorded as browser changes", async () => {
    mockRestoreFromImportData.mockImplementation(async () => { fireLocalChange() })
    const { svc, writable } = await startWith()
    await svc.initialize()
    expect(syncState().dirtySince).toBeNull()
    await vi.advanceTimersByTimeAsync(2000)
    expect(writable.write).not.toHaveBeenCalled()
  })
})

// ─── Failures: always paused, nothing touched ─────────────────────────

describe('FileStorageService — failed loads pause sync and touch nothing', () => {
  it('invalid JSON', async () => {
    const { svc, writable } = await startWith('not json{{{')
    await svc.initialize()
    expect(svc.status.paused?.reason).toBe('invalid-json')
    expect(svc.status.paused?.message).toMatch(/^File sync paused — the file contains invalid JSON/)
    expectUntouched(writable)
    await expectNoWriteAfterChange(writable)
  })

  it('validation failure', async () => {
    mockValidateImportData.mockReturnValue({ ok: false, error: 'Missing todos field' })
    const { svc, writable } = await startWith()
    await svc.initialize()
    expect(svc.status.paused).toMatchObject({ reason: 'invalid' })
    expect(svc.status.paused?.message).toContain('Missing todos field')
    expectUntouched(writable)
    await expectNoWriteAfterChange(writable)
  })

  it('file from a newer schema', async () => {
    const { svc, writable } = await startWith(fileBody({ __schemaVersion: 49 }))
    await svc.initialize()
    expect(svc.status.paused?.reason).toBe('too-new')
    expect(svc.status.paused?.message).toMatch(/^File sync paused — .*newer version of TODO2/)
    expect(svc.status.fileName).toBe('todo2-data.json')
    expect(mockClearFileHandle).not.toHaveBeenCalled()
    expectUntouched(writable)
    await expectNoWriteAfterChange(writable)
  })

  it('file too large', async () => {
    const bigFile = new File(['x'], 'big.json', { type: 'application/json' })
    Object.defineProperty(bigFile, 'size', { value: 60 * 1024 * 1024 })
    const { svc, writable } = await startWith(fileBody(), { getFile: vi.fn().mockResolvedValue(bigFile) })
    await svc.initialize()
    expect(svc.status.paused?.reason).toBe('too-large')
    expectUntouched(writable)
    await expectNoWriteAfterChange(writable)
  })

  it('read error', async () => {
    const { svc, writable } = await startWith(fileBody(), { getFile: vi.fn().mockRejectedValue(new Error('disk on fire')) })
    await svc.initialize()
    expect(svc.status.paused?.reason).toBe('read-error')
    expect(svc.status.paused?.message).toContain('disk on fire')
    expectUntouched(writable)
    await expectNoWriteAfterChange(writable)
  })

  it('file not found forgets the handle (nothing on disk to protect)', async () => {
    const notFound = new Error('gone')
    notFound.name = 'NotFoundError'
    const { svc } = await startWith(fileBody(), { getFile: vi.fn().mockRejectedValue(notFound) })
    await svc.initialize()
    expect(svc.status.error).toMatch(/not found/)
    expect(svc.status.fileName).toBeNull()
    expect(mockClearFileHandle).toHaveBeenCalled()
  })

  it('"Keep browser data" from a paused state backs up the file, overwrites it, and resumes', async () => {
    const { svc, writable } = await startWith('not json{{{')
    await svc.initialize()
    expect(svc.status.paused).not.toBeNull()

    await svc.overwriteFileWithBrowser()

    expect(mockSnapshotFileBeforeOverwrite).toHaveBeenCalledWith('not json{{{')
    expect(writable.write).toHaveBeenCalledTimes(1)
    expect(svc.status.paused).toBeNull()
    expect(svc.status.isConnected).toBe(true)

    fireLocalChange()
    await vi.advanceTimersByTimeAsync(600)
    expect(writable.write).toHaveBeenCalledTimes(2)
  })

  it('Retry re-runs the load (e.g. the file was fixed)', async () => {
    mockValidateImportData.mockReturnValueOnce({ ok: false, error: 'bad' })
    const { svc } = await startWith()
    await svc.initialize()
    expect(svc.status.paused).not.toBeNull()

    await svc.retry()
    expect(svc.status.paused).toBeNull()
    expect(svc.status.isConnected).toBe(true)
    expect(mockRestoreFromImportData).toHaveBeenCalled()
  })
})

// ─── Schema upgrades ──────────────────────────────────────────────────
// The database mock pins CURRENT_DB_VERSION = 48 / floor = 16.

describe('FileStorageService — older sync files', () => {
  it('asks before upgrading an older file; cancel leaves everything untouched', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: null })
    const { svc, writable } = await startWith(fileBody({ __schemaVersion: 47 }))
    const ask = vi.fn().mockResolvedValue(false)
    svc.onConfirmFileUpgrade(ask)
    await svc.initialize()

    expect(ask).toHaveBeenCalledWith({ fileName: 'todo2-data.json', fromVersion: 47, toVersion: 48 })
    expectUntouched(writable)
    expect(svc.status.paused?.reason).toBe('upgrade-cancelled')
  })

  it('accepting the upgrade loads the file and restamps it', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: null })
    const { svc, writable } = await startWith(fileBody({ __schemaVersion: 47 }))
    svc.onConfirmFileUpgrade(async () => true)
    await svc.initialize()

    expect(mockRestoreFromImportData).toHaveBeenCalled()
    expect(writable.write).toHaveBeenCalledTimes(1)
    expect(svc.status.isConnected).toBe(true)
  })

  it('upgrade prompt with no listener stays paused', async () => {
    const { svc, writable } = await startWith(fileBody({ __schemaVersion: 47 }))
    await svc.initialize()
    expectUntouched(writable)
    expect(svc.status.paused?.reason).toBe('upgrade-cancelled')
  })

  it('does not rewrite a file already at the current version', async () => {
    const { svc, writable } = await startWith()
    await svc.initialize()
    expect(mockRestoreFromImportData).toHaveBeenCalled()
    expect(writable.write).not.toHaveBeenCalled()
  })

  it('below-floor file: cancelling the MigrationDialog pauses (handle kept, nothing touched)', async () => {
    const { svc, writable } = await startWith(fileBody({ __schemaVersion: 10 }))
    const confirm = vi.fn().mockResolvedValue(false)
    svc.onConfirmMigration(confirm)
    await svc.initialize()

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ sourceVersion: 10, targetVersion: 48 }))
    expectUntouched(writable)
    expect(mockClearFileHandle).not.toHaveBeenCalled()
    expect(svc.status.paused?.reason).toBe('legacy-cancelled')
  })

  it('below-floor file: confirming loads and restamps without a second upgrade prompt', async () => {
    const { svc, writable } = await startWith(fileBody({ __schemaVersion: 10 }))
    svc.onConfirmMigration(async () => true)
    const ask = vi.fn()
    svc.onConfirmFileUpgrade(ask)
    await svc.initialize()

    expect(ask).not.toHaveBeenCalled()
    expect(mockRestoreFromImportData).toHaveBeenCalled()
    expect(writable.write).toHaveBeenCalledTimes(1)
  })
})

// ─── Raw-file backup before every rewrite ─────────────────────────────
// Rule: the sync file's raw text is backed up before it is rewritten at a
// newer schema (or overwritten with browser data). Backup failure → paused,
// nothing written, browser untouched.

describe('FileStorageService — file backup before rewrite', () => {
  /** Every caller here rewrites an older file: its copy goes outside the pruned pool. */
  function expectBackupFirst(text: string, writable: ReturnType<typeof makeWritable>) {
    expect(mockSnapshotFileBeforeOverwrite).toHaveBeenCalledWith(text, { olderVersion: true })
    const backupAt = mockSnapshotFileBeforeOverwrite.mock.invocationCallOrder[0]!
    expect(backupAt).toBeLessThan(writable.write.mock.invocationCallOrder[0]!)
    const restoreAt = mockRestoreFromImportData.mock.invocationCallOrder[0]
    if (restoreAt !== undefined) expect(backupAt).toBeLessThan(restoreAt)
  }

  function expectBackupFailurePaused(svc: { status: { paused: { reason: string; message: string } | null } }, writable: ReturnType<typeof makeWritable>) {
    expect(svc.status.paused?.reason).toBe('backup-failed')
    expect(svc.status.paused?.message).toContain('could not be backed up')
    expect(mockRestoreFromImportData).not.toHaveBeenCalled()
    expect(writable.write).not.toHaveBeenCalled()
  }

  const older = fileBody({ __schemaVersion: 47 })
  const belowFloor = fileBody({ __schemaVersion: 10 })

  it('confirmed upgrade: backs up the raw text before restoring and restamping', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: null })
    const { svc, writable } = await startWith(older)
    svc.onConfirmFileUpgrade(async () => true)
    await svc.initialize()
    expectBackupFirst(JSON.stringify(older), writable)
  })

  it('confirmed upgrade: backup failure leaves file and browser untouched and pauses', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: null })
    mockSnapshotFileBeforeOverwrite.mockRejectedValue(new Error('quota'))
    const { svc, writable } = await startWith(older)
    svc.onConfirmFileUpgrade(async () => true)
    await svc.initialize()
    expectBackupFailurePaused(svc, writable)
    await expectNoWriteAfterChange(writable)
  })

  it('below-floor confirm: backs up first; failure pauses untouched', async () => {
    const ok = await startWith(belowFloor)
    ok.svc.onConfirmMigration(async () => true)
    await ok.svc.initialize()
    expectBackupFirst(JSON.stringify(belowFloor), ok.writable)

    vi.resetModules()
    mockRestoreFromImportData.mockClear()
    mockSnapshotFileBeforeOverwrite.mockReset().mockRejectedValue(new Error('quota'))
    const bad = await startWith(belowFloor)
    bad.svc.onConfirmMigration(async () => true)
    await bad.svc.initialize()
    expectBackupFailurePaused(bad.svc, bad.writable)
  })

  it('conflict "Use file" with an older file: backs up first; failure pauses untouched', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: '2026-10-02T09:00:00.000Z' })
    const ok = await startWith(older)
    ok.svc.onConflict(async () => 'file')
    await ok.svc.initialize()
    expectBackupFirst(JSON.stringify(older), ok.writable)

    vi.resetModules()
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: '2026-10-02T09:00:00.000Z' })
    mockRestoreFromImportData.mockClear()
    mockSnapshotFileBeforeOverwrite.mockReset().mockRejectedValue(new Error('quota'))
    const bad = await startWith(older)
    bad.svc.onConflict(async () => 'file')
    await bad.svc.initialize()
    expectBackupFailurePaused(bad.svc, bad.writable)
  })

  it('confirmed upgrade whose rewrite of the file fails: sync pauses and says so (not "on" over an old file)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: null })
    const { svc, writable } = await startWith(older)
    writable.write.mockRejectedValue(new Error('disk full'))
    svc.onConfirmFileUpgrade(async () => true)
    await svc.initialize()
    expect(svc.status.paused?.reason).toBe('write-failed')
    expect(svc.status.paused?.message).toContain('could not be written')
    // Paused: a later edit doesn't write over the old file either.
    const writes = writable.write.mock.calls.length
    fireLocalChange()
    await vi.advanceTimersByTimeAsync(2000)
    expect(writable.write).toHaveBeenCalledTimes(writes)
  })

  it('"Use browser data" / "Keep browser data" over an older file keep its copy outside the pruned pool', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: '2026-10-02T09:00:00.000Z' })
    const a = await startWith(older)
    a.svc.onConflict(async () => 'browser')
    await a.svc.initialize()
    expect(mockSnapshotFileBeforeOverwrite).toHaveBeenCalledWith(JSON.stringify(older), { olderVersion: true })

    vi.resetModules()
    mockSnapshotFileBeforeOverwrite.mockClear()
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: null })
    const b = await startWith(older)
    b.svc.onConfirmFileUpgrade(async () => false)
    await b.svc.initialize()
    expect(b.svc.status.paused?.reason).toBe('upgrade-cancelled')
    await b.svc.overwriteFileWithBrowser()
    expect(mockSnapshotFileBeforeOverwrite).toHaveBeenCalledWith(JSON.stringify(older), { olderVersion: true })
  })

  it('a current-version file the import trimmed (warnings): its raw text is backed up before sync rewrites it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockValidateImportData.mockReturnValue({ ok: true, data: validImportData, warnings: ['Ignored 1 unrecognized setting: color.dark.old'] })
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: null })
    const { svc, writable } = await startWith()
    await svc.initialize()
    expect(mockSnapshotFileBeforeOverwrite).toHaveBeenCalledWith(JSON.stringify(fileBody()))
    expect(svc.status.isConnected).toBe(true)
    // …and a failed backup leaves the file untouched (paused), as for every rewrite.
    vi.resetModules()
    mockSnapshotFileBeforeOverwrite.mockReset().mockRejectedValue(new Error('quota'))
    mockRestoreFromImportData.mockClear()
    const bad = await startWith()
    await bad.svc.initialize()
    expect(bad.svc.status.paused?.reason).toBe('backup-failed')
    expect(mockRestoreFromImportData).not.toHaveBeenCalled()
    void writable
  })

  it('conflict "Use file" at the current version: no rewrite, so no file backup needed', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: '2026-10-02T09:00:00.000Z' })
    const { svc, writable } = await startWith()
    svc.onConflict(async () => 'file')
    await svc.initialize()
    expect(mockSnapshotFileBeforeOverwrite).not.toHaveBeenCalled()
    expect(writable.write).not.toHaveBeenCalled()
  })

  it('conflict "Use browser data": backup failure leaves the file untouched and pauses', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: '2026-10-02T09:00:00.000Z' })
    mockSnapshotFileBeforeOverwrite.mockRejectedValue(new Error('quota'))
    const { svc, writable } = await startWith(older)
    svc.onConflict(async () => 'browser')
    await svc.initialize()
    expectBackupFailurePaused(svc, writable)
  })

  it('"Keep browser data": backup failure keeps the file untouched and stays paused', async () => {
    const { svc, writable } = await startWith(fileBody({ __schemaVersion: 49 }))
    await svc.initialize()
    mockSnapshotFileBeforeOverwrite.mockRejectedValue(new Error('quota'))
    await svc.overwriteFileWithBrowser()
    expectBackupFailurePaused(svc, writable)
  })

  it('"Keep browser data": an unreadable file cannot be backed up, so it is not overwritten', async () => {
    const getFile = vi.fn().mockRejectedValue(new Error('locked'))
    const { svc, writable } = await startWith(fileBody(), { getFile })
    await svc.initialize()
    await svc.overwriteFileWithBrowser()
    expect(svc.status.paused?.reason).toBe('backup-failed')
    expect(writable.write).not.toHaveBeenCalled()
  })
})

// ─── Change tracking ──────────────────────────────────────────────────

describe('FileStorageService — change tracking', () => {
  it('a change while synced is written after the debounce and clears dirty', async () => {
    const { svc, writable } = await startWith()
    await svc.initialize()

    fireLocalChange()
    expect(syncState().dirtySince).not.toBeNull()
    await vi.advanceTimersByTimeAsync(600)

    expect(writable.write).toHaveBeenCalledTimes(1)
    const state = syncState()
    expect(state.dirtySince).toBeNull()
    const written = JSON.parse(writable.write.mock.calls[0]![0] as string)
    expect(state.fileSavedAt).toBe(written.savedAt)
  })

  it('a written file that would not load back says so (and is still written); checked again at most once a minute', async () => {
    mockSelfCheckExportJson.mockReturnValue('Invalid "todos" record at index 0')
    const { svc, writable } = await startWith()
    await svc.initialize()
    fireLocalChange()
    await vi.advanceTimersByTimeAsync(600)
    expect(writable.write).toHaveBeenCalledTimes(1)
    expect(svc.status.error).toBe('Saved, but the sync file would not load back: Invalid "todos" record at index 0')
    expect(mockSelfCheckExportJson).toHaveBeenCalledTimes(1)

    fireLocalChange()
    await vi.advanceTimersByTimeAsync(600)
    expect(writable.write).toHaveBeenCalledTimes(2)
    expect(mockSelfCheckExportJson).toHaveBeenCalledTimes(1)
    expect(svc.status.error).toContain('would not load back')

    mockSelfCheckExportJson.mockReturnValue(null)
    await vi.advanceTimersByTimeAsync(60_000)
    fireLocalChange()
    await vi.advanceTimersByTimeAsync(600)
    expect(mockSelfCheckExportJson).toHaveBeenCalledTimes(2)
    expect(svc.status.error).toBeNull()
  })

  it('a failed save keeps the browser dirty', async () => {
    const { svc, writable } = await startWith()
    await svc.initialize()
    writable.write.mockRejectedValueOnce(new Error('disk full'))

    fireLocalChange()
    await vi.advanceTimersByTimeAsync(600)

    expect(svc.status.error).toBe('Failed to save to file')
    expect(syncState().dirtySince).not.toBeNull()
  })

  it('edits made while permission is needed survive Grant Access via the conflict prompt', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: null })
    const { svc, writable } = await startWith(fileBody(), {
      queryPermission: vi.fn().mockResolvedValue('prompt'),
      requestPermission: vi.fn().mockResolvedValue('granted'),
    })
    await svc.initialize()
    expect(svc.status.needsPermission).toBe(true)

    fireLocalChange()
    await vi.advanceTimersByTimeAsync(2000)
    expect(writable.write).not.toHaveBeenCalled()
    expect(syncState().dirtySince).not.toBeNull()

    const conflict = vi.fn().mockResolvedValue('browser')
    svc.onConflict(conflict)
    await svc.reconnect()

    expect(conflict).toHaveBeenCalledWith(expect.objectContaining({ reason: 'browser-changes' }))
    // The browser's edits were kept: no restore, file overwritten.
    expect(mockRestoreFromImportData).not.toHaveBeenCalled()
    expect(writable.write).toHaveBeenCalledTimes(1)
    expect(svc.status.isConnected).toBe(true)
  })

  it('sets error when permission is denied on reconnect', async () => {
    const { svc } = await startWith(fileBody(), {
      queryPermission: vi.fn().mockResolvedValue('prompt'),
      requestPermission: vi.fn().mockResolvedValue('denied'),
    })
    await svc.initialize()
    await svc.reconnect()
    expect(svc.status.isConnected).toBe(false)
    expect(svc.status.error).toBe('Permission denied')
  })
})

describe('FileStorageService — changes made while sync starts', () => {
  it('a change made while the stores reload after a load is saved once sync is on, not left unsynced', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: null })
    const { svc, writable } = await startWith()
    // A store seeding a row as it reloads, before sync is switched on.
    const off = svc.onAfterImport(async () => { fireLocalChange() })
    await svc.initialize()
    off()
    expect(svc.status.isConnected).toBe(true)
    expect(syncState().dirtySince).not.toBeNull()

    await vi.advanceTimersByTimeAsync(600)
    expect(writable.write).toHaveBeenCalledTimes(1)
    expect(syncState().dirtySince).toBeNull()
  })

  it('a load with nothing changed meanwhile writes nothing', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: null })
    const { svc, writable } = await startWith()
    await svc.initialize()
    await vi.advanceTimersByTimeAsync(2000)
    expect(writable.write).not.toHaveBeenCalled()
  })
})

// ─── The launch question ──────────────────────────────────────────────

describe('FileStorageService — launch question (permission needed at start)', () => {
  const needsPermission = (request: 'granted' | 'denied' = 'granted') => ({
    queryPermission: vi.fn().mockResolvedValue('prompt'),
    requestPermission: vi.fn().mockResolvedValue(request),
  })

  it('initialize waits for the answer, with permission marked needed meanwhile and nothing touched', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: null })
    const { svc, writable } = await startWith(fileBody(), needsPermission())
    let answer!: () => void
    const ask = vi.fn(() => new Promise<void>((resolve) => { answer = resolve }))
    svc.onLaunchPermission(ask)
    const statuses: boolean[] = []
    svc.onStatusChange((s) => statuses.push(s.needsPermission))

    let done = false
    const run = svc.initialize().then(() => { done = true })
    await vi.advanceTimersByTimeAsync(0)

    expect(ask).toHaveBeenCalledWith({ fileName: 'todo2-data.json' })
    expect(done).toBe(false)
    expect(statuses).toEqual([true])
    expectUntouched(writable)

    answer()
    await run
    expect(done).toBe(true)
    expect(svc.status.needsPermission).toBe(true)
    expectUntouched(writable)
  })

  it('a granted handle loads at once: no question', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: null })
    const { svc } = await startWith()
    const ask = vi.fn(() => Promise.resolve())
    svc.onLaunchPermission(ask)
    await svc.initialize()
    expect(ask).not.toHaveBeenCalled()
    expect(svc.status.isConnected).toBe(true)
  })

  it('concurrent initialize calls share one run: one question, one permission check', async () => {
    const { svc, handle } = await startWith(fileBody(), needsPermission())
    let answer!: () => void
    const ask = vi.fn(() => new Promise<void>((resolve) => { answer = resolve }))
    svc.onLaunchPermission(ask)

    const first = svc.initialize()
    const second = svc.initialize()
    expect(second).toBe(first)
    await vi.advanceTimersByTimeAsync(0)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(handle.queryPermission).toHaveBeenCalledTimes(1)
    answer()
    await Promise.all([first, second])

    // Once settled, a later call runs again.
    ask.mockImplementationOnce(() => Promise.resolve())
    await svc.initialize()
    expect(handle.queryPermission).toHaveBeenCalledTimes(2)
  })

  it('Grant access from the question: onGranted before the file loads, then the load decision', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: null })
    const { svc } = await startWith(fileBody(), needsPermission())
    const order: string[] = []
    mockRestoreFromImportData.mockImplementation(async () => { order.push('restore') })
    svc.onLaunchPermission(() => svc.reconnect({ onGranted: () => order.push('granted') }))

    await svc.initialize()

    expect(order).toEqual(['granted', 'restore'])
    expect(svc.status).toMatchObject({ needsPermission: false, isConnected: true })
  })

  it('a refused grant never calls onGranted and keeps permission needed', async () => {
    const { svc, writable } = await startWith(fileBody(), needsPermission('denied'))
    const onGranted = vi.fn()
    await svc.initialize()
    await svc.reconnect({ onGranted })
    expect(onGranted).not.toHaveBeenCalled()
    expect(svc.status).toMatchObject({ needsPermission: true, error: 'Permission denied' })
    expectUntouched(writable)
  })
})

// ─── Attach / create / disconnect ─────────────────────────────────────

describe('FileStorageService — attach, create, disconnect', () => {
  it('openFile drops the previous sync record, so a non-empty browser is asked', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: null })
    mockBrowserTaskCount.mockResolvedValue(4)
    const { handle, writable } = createMockHandle()
    vi.stubGlobal('showOpenFilePicker', vi.fn().mockResolvedValue([handle]))
    const svc = await getService()
    const conflict = vi.fn().mockResolvedValue('cancel')
    svc.onConflict(conflict)

    await svc.openFile()

    expect(mockSaveFileHandle).toHaveBeenCalledWith(handle)
    expect(conflict).toHaveBeenCalledWith(expect.objectContaining({ reason: 'no-sync-record' }))
    expectUntouched(writable)
  })

  it('openFile with an empty browser just loads the file', async () => {
    const { handle } = createMockHandle()
    vi.stubGlobal('showOpenFilePicker', vi.fn().mockResolvedValue([handle]))
    const svc = await getService()
    await svc.openFile()
    expect(mockRestoreFromImportData).toHaveBeenCalled()
    expect(svc.status.isConnected).toBe(true)
  })

  it('does not set error when user cancels the picker', async () => {
    const abortError = new Error('User cancelled')
    abortError.name = 'AbortError'
    vi.stubGlobal('showOpenFilePicker', vi.fn().mockRejectedValue(abortError))
    const svc = await getService()
    await svc.openFile()
    expect(svc.status.isConnected).toBe(false)
    expect(svc.status.error).toBeNull()
  })

  it('createFile writes the browser data into the new file and records the sync', async () => {
    const { handle, writable } = createMockHandle('')
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue(handle))
    const svc = await getService()
    await svc.createFile()

    expect(writable.write).toHaveBeenCalledTimes(1)
    expect(svc.status.isConnected).toBe(true)
    expect(syncState().fileSavedAt).not.toBeNull()
  })

  it('createFile suggests a name dated with the local day, never the old fixed name', async () => {
    vi.setSystemTime(new Date(2026, 0, 5, 23, 30)) // local 5 Jan, late evening
    const { handle } = createMockHandle('')
    const picker = vi.fn().mockResolvedValue(handle)
    vi.stubGlobal('showSaveFilePicker', picker)
    const svc = await getService()
    await svc.createFile()
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'todo2-data-2026-01-05.json' }))
  })

  it('newSyncFileName pads month and day and uses the local date', async () => {
    const { newSyncFileName } = await import('../../services/file-storage')
    expect(newSyncFileName(new Date(2026, 9, 16, 0, 5))).toBe('todo2-data-2026-10-16.json')
    expect(newSyncFileName(new Date(2027, 11, 31, 23, 59))).toBe('todo2-data-2027-12-31.json')
  })

  it('an empty attached file is seeded with the browser data', async () => {
    const { svc, writable } = await startWith('')
    await svc.initialize()
    expect(mockRestoreFromImportData).not.toHaveBeenCalled()
    expect(writable.write).toHaveBeenCalledTimes(1)
    expect(svc.status.isConnected).toBe(true)
  })

  it('disconnect never rejects: a handle store that fails is said, and the file is still let go here', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { svc } = await startWith()
    await svc.initialize()
    mockClearFileHandle.mockRejectedValueOnce(new Error('aborted'))
    await expect(svc.disconnect()).resolves.toBeUndefined()
    expect(svc.status.fileName).toBeNull()
    expect(svc.status.error).toBe('Disconnected, but the browser could not forget the file — it may reconnect on the next start. Disconnect again to retry.')
  })

  it('disconnect clears the handle, the sync record, and the tracking hooks', async () => {
    const { svc } = await startWith()
    await svc.initialize()
    expect(mockTables[0]!.hook('creating').subscribe).toHaveBeenCalled()

    await svc.disconnect()

    expect(svc.status.fileName).toBeNull()
    expect(svc.status.isConnected).toBe(false)
    expect(localStorage.getItem(SYNC_KEY)).toBeNull()
    expect(mockClearFileHandle).toHaveBeenCalled()
    for (const table of mockTables) {
      expect(table.hook('creating').unsubscribe).toHaveBeenCalled()
    }
  })
})

// ─── Status listener ──────────────────────────────────────────────────

describe('FileStorageService — status notifications', () => {
  it('notifies listener on status changes', async () => {
    const listener = vi.fn()
    const { svc } = await startWith()
    svc.onStatusChange(listener)
    await svc.initialize()
    const lastStatus = listener.mock.calls[listener.mock.calls.length - 1]![0]
    expect(lastStatus.isConnected).toBe(true)
  })

  it('notifies afterImport listener after loading file data', async () => {
    const afterImport = vi.fn().mockResolvedValue(undefined)
    const { svc } = await startWith()
    svc.onAfterImport(afterImport)
    await svc.initialize()
    expect(afterImport).toHaveBeenCalled()
  })

  it('every status subscriber gets every change; an unsubscribed one gets no more', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { svc } = await startWith()
    svc.onStatusChange(first)
    const unsubscribeSecond = svc.onStatusChange(second)
    await svc.initialize()
    expect(first.mock.calls.length).toBeGreaterThan(0)
    expect(second.mock.calls).toEqual(first.mock.calls)

    unsubscribeSecond()
    unsubscribeSecond() // a second call is harmless
    const before = second.mock.calls.length
    await svc.disconnect()
    expect(second).toHaveBeenCalledTimes(before)
    expect(first.mock.calls.at(-1)![0].fileName).toBeNull()
  })

  it('a status subscriber that throws does not keep the others from hearing it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const later = vi.fn()
    const { svc } = await startWith()
    svc.onStatusChange(() => { throw new Error('boom') })
    svc.onStatusChange(later)
    await svc.initialize()
    expect(later.mock.calls.at(-1)![0].isConnected).toBe(true)
  })

  it('every import subscriber runs: before-import holds are released after every after-import listener', async () => {
    const order: string[] = []
    const { svc } = await startWith()
    svc.onBeforeImport(async () => { order.push('hold 1'); return () => order.push('release 1') })
    svc.onBeforeImport(async () => { order.push('hold 2'); return () => order.push('release 2') })
    svc.onAfterImport(async () => { order.push('after 1') })
    svc.onAfterImport(async () => { order.push('after 2') })
    mockRestoreFromImportData.mockImplementation(async () => { order.push('restore') })
    await svc.initialize()
    expect(order).toEqual(['hold 1', 'hold 2', 'restore', 'after 1', 'after 2', 'release 1', 'release 2'])
  })

  it('an after-import listener that fails does not stop the next one; the load rejects with its error', async () => {
    const second = vi.fn().mockResolvedValue(undefined)
    const release = vi.fn()
    const { svc } = await startWith()
    svc.onBeforeImport(async () => release)
    svc.onAfterImport(async () => { throw new Error('reload failed') })
    svc.onAfterImport(second)
    await expect(svc.initialize()).rejects.toThrow('reload failed')
    expect(second).toHaveBeenCalled()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('a before-import hold that fails releases the holds already taken and nothing is replaced', async () => {
    const release = vi.fn()
    const { svc } = await startWith()
    svc.onBeforeImport(async () => release)
    svc.onBeforeImport(async () => { throw new Error('hold failed') })
    await expect(svc.initialize()).rejects.toThrow('hold failed')
    expect(release).toHaveBeenCalledTimes(1)
    expect(mockRestoreFromImportData).not.toHaveBeenCalled()
  })

  it('unsubscribed import listeners no longer run', async () => {
    const before = vi.fn().mockResolvedValue(() => {})
    const after = vi.fn().mockResolvedValue(undefined)
    const { svc } = await startWith()
    svc.onBeforeImport(before)()
    svc.onAfterImport(after)()
    await svc.initialize()
    expect(mockRestoreFromImportData).toHaveBeenCalled()
    expect(before).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })

  it('a question has one handler: a later one replaces it, and removing the replaced one changes nothing', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: '2026-10-02T09:00:00.000Z' })
    mockBrowserTaskCount.mockResolvedValue(5)
    const { svc } = await startWith()
    const first = vi.fn().mockResolvedValue('file')
    const second = vi.fn().mockResolvedValue('cancel')
    const removeFirst = svc.onConflict(first)
    const removeSecond = svc.onConflict(second)
    removeFirst()
    await svc.initialize()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(svc.status.paused?.reason).toBe('conflict-cancelled')

    // Without a handler a conflict stays paused (cancel).
    removeSecond()
    await svc.retry()
    expect(second).toHaveBeenCalledTimes(1)
    expect(svc.status.paused?.reason).toBe('conflict-cancelled')
  })
})

// ─── Test reset ───────────────────────────────────────────────────────

describe('FileStorageService — reset', () => {
  it('forgets the file, stops syncing, removes the Dexie hooks and keeps the subscribers', async () => {
    const listener = vi.fn()
    const { svc, writable } = await startWith()
    svc.onStatusChange(listener)
    await svc.initialize()
    expect(svc.status.isConnected).toBe(true)
    fireLocalChange()

    svc.reset()
    expect(svc.status).toEqual({
      isConnected: false, fileName: null, lastSavedAt: null, needsPermission: false, error: null, paused: null,
    })
    for (const table of mockTables) expect(table.hook('creating').handlers.size).toBe(0)
    await vi.advanceTimersByTimeAsync(2000)
    expect(writable.write).not.toHaveBeenCalled()
    await expect(svc.whenIdle()).resolves.toBeUndefined()

    // Still subscribed: a fresh start is heard.
    listener.mockClear()
    await svc.initialize()
    expect(listener).toHaveBeenCalled()
  })
})

// ─── Browser backup before loading the file ───────────────────────────

describe('FileStorageService — browser backup before the file replaces it', () => {
  async function uiStore() {
    return (await import('../../stores/ui-store')).useUIStore
  }

  it('backup fails → asks; Cancel leaves the browser data and the file untouched and pauses', async () => {
    setSyncState({ fileSavedAt: '2026-09-01T00:00:00.000Z', dirtySince: null })
    mockSnapshotBeforeDestructive.mockRejectedValue(new Error('quota'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { svc, writable } = await startWith()
    const ui = await uiStore()
    const init = svc.initialize()
    await vi.waitFor(() => expect(ui.getState().confirmPrompts).toHaveLength(1))
    expect(ui.getState().confirmPrompts[0]).toMatchObject({ title: 'Continue without a backup?', cancelIsDefault: true })
    expect(mockRestoreFromImportData).not.toHaveBeenCalled()
    ui.getState().answerConfirmation(false)
    await init

    expectUntouched(writable)
    expect(svc.status.paused?.reason).toBe('backup-failed')
    expect(svc.status.isConnected).toBe(false)
    expect(syncState().fileSavedAt).toBe('2026-09-01T00:00:00.000Z')
  })

  it('backup fails → Continue loads the file without a backup', async () => {
    setSyncState({ fileSavedAt: '2026-09-01T00:00:00.000Z', dirtySince: null })
    mockSnapshotBeforeDestructive.mockRejectedValue(new Error('quota'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { svc } = await startWith()
    const ui = await uiStore()
    const init = svc.initialize()
    await vi.waitFor(() => expect(ui.getState().confirmPrompts).toHaveLength(1))
    ui.getState().answerConfirmation(true)
    await init

    expect(mockRestoreFromImportData).toHaveBeenCalledWith(validImportData)
    expect(svc.status.isConnected).toBe(true)
    expect(svc.status.error).toBeNull()
    // The result toast (the warning strip is desktop-only).
    const { useUndoStore } = await import('../../stores/undo-store')
    expect(useUndoStore.getState().snackbar).toEqual({ description: 'Loaded todo2-data.json. No backup was taken.', notice: true })
  })

  it('conflict "Use file": a failed backup asks before the browser data is replaced', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: '2026-10-02T09:00:00.000Z' })
    mockSnapshotBeforeDestructive.mockRejectedValue(new Error('quota'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { svc, writable } = await startWith()
    svc.onConflict(async () => 'file')
    const ui = await uiStore()
    const init = svc.initialize()
    await vi.waitFor(() => expect(ui.getState().confirmPrompts).toHaveLength(1))
    ui.getState().answerConfirmation(false)
    await init

    expectUntouched(writable)
    expect(svc.status.paused?.reason).toBe('backup-failed')
    // Still unsynced: the next load asks again.
    expect(syncState().dirtySince).toBe('2026-10-02T09:00:00.000Z')
  })

  it('in sync with this very file: a failed backup does not stop the (lossless) load', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: null })
    mockSnapshotBeforeDestructive.mockRejectedValue(new Error('quota'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { svc } = await startWith()
    const ui = await uiStore()
    await svc.initialize()

    expect(ui.getState().confirmPrompts).toHaveLength(0)
    expect(mockRestoreFromImportData).toHaveBeenCalledWith(validImportData)
    expect(svc.status.isConnected).toBe(true)
  })
})

// ─── Writes never overlap; reads never race a write ───────────────────

/** A writable whose `close` waits until `finish()` — a save held in flight. */
function heldWritable() {
  let finish!: () => void
  const closed = new Promise<void>((resolve) => { finish = resolve })
  const writable = { ...makeWritable(), close: vi.fn(() => closed) }
  return { writable, finish }
}

describe('FileStorageService — saves in flight', () => {
  it('a forced write while a save is in flight waits for it, then writes (never dropped)', async () => {
    // Synced with file A; a debounced save to A is in flight when the user
    // creates file B.
    const { svc, handle: a } = await startWith()
    await svc.initialize()
    const held = heldWritable()
    a.createWritable.mockResolvedValue(held.writable)
    fireLocalChange()
    await vi.advanceTimersByTimeAsync(600)
    expect(held.writable.write).toHaveBeenCalledTimes(1)

    const { handle: b, writable: bWritable } = createMockHandle('')
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue(b))
    const creating = svc.createFile()
    await vi.advanceTimersByTimeAsync(0)
    expect(bWritable.write).not.toHaveBeenCalled()

    held.finish()
    await creating
    expect(bWritable.write).toHaveBeenCalledTimes(1)
    expect(svc.status.isConnected).toBe(true)
    expect(svc.status.fileName).toBe(b.name)
    // The sync record is B's, not the late save to A's.
    const written = JSON.parse(bWritable.write.mock.calls[0]![0] as string) as { savedAt: string }
    expect(syncState().fileSavedAt).toBe(written.savedAt)
  })

  it('a load waits for the save in flight before reading the file', async () => {
    const { svc, handle } = await startWith()
    await svc.initialize()
    const held = heldWritable()
    handle.createWritable.mockResolvedValue(held.writable)
    fireLocalChange()
    await vi.advanceTimersByTimeAsync(600)
    const readsBefore = handle.getFile.mock.calls.length

    const retrying = svc.retry()
    await vi.advanceTimersByTimeAsync(0)
    expect(handle.getFile.mock.calls.length).toBe(readsBefore)

    held.finish()
    await retrying
    expect(handle.getFile.mock.calls.length).toBe(readsBefore + 1)
  })

  it('whenIdle resolves once the scheduled save has been written', async () => {
    const { svc, writable } = await startWith()
    await svc.initialize()
    await expect(svc.whenIdle()).resolves.toBeUndefined()

    fireLocalChange()
    let idle = false
    void svc.whenIdle().then(() => { idle = true })
    await vi.advanceTimersByTimeAsync(100)
    expect(idle).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(writable.write).toHaveBeenCalledTimes(1)
    expect(idle).toBe(true)
  })

  it('a failed save is logged and surfaced', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { svc, writable } = await startWith()
    await svc.initialize()
    writable.write.mockRejectedValueOnce(new Error('disk full'))
    fireLocalChange()
    await vi.advanceTimersByTimeAsync(600)
    expect(svc.status.error).toBe('Failed to save to file')
    expect(warn).toHaveBeenCalledWith('[file-storage] saving to the file failed', expect.objectContaining({ message: 'disk full' }))
  })
})

describe('FileStorageService — reading a file that another write replaces', () => {
  function replacedError() {
    const err = new Error('A requested file or directory could not be found at the time an operation was processed.')
    err.name = 'NotFoundError'
    return err
  }

  it('a snapshot that went stale mid-read is read again; the handle is kept', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const good = new File([JSON.stringify(fileBody())], 'todo2-data.json')
    const stale = { size: good.size, lastModified: good.lastModified, text: vi.fn().mockRejectedValue(replacedError()) }
    const getFile = vi.fn().mockResolvedValueOnce(stale).mockResolvedValue(good)
    const { svc } = await startWith(fileBody(), { getFile })
    await svc.initialize()

    expect(getFile).toHaveBeenCalledTimes(2)
    expect(svc.status.fileName).toBe('todo2-data.json')
    expect(mockClearFileHandle).not.toHaveBeenCalled()
    expect(mockRestoreFromImportData).toHaveBeenCalled()
    expect(svc.status.isConnected).toBe(true)
  })

  it('a file replaced on every read pauses sync (read error) instead of forgetting the file', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stale = { size: 10, lastModified: 0, text: vi.fn().mockRejectedValue(replacedError()) }
    const { svc, writable } = await startWith(fileBody(), { getFile: vi.fn().mockResolvedValue(stale) })
    await svc.initialize()

    expect(svc.status.paused?.reason).toBe('read-error')
    expect(svc.status.fileName).toBe('todo2-data.json')
    expect(mockClearFileHandle).not.toHaveBeenCalled()
    expectUntouched(writable)
  })

  it('"Keep browser data": a file over the size cap is not read for its backup, and not overwritten', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const huge = { size: 50 * 1024 * 1024 + 1, lastModified: 0, text: vi.fn() }
    const { svc, writable } = await startWith(fileBody(), { getFile: vi.fn().mockResolvedValue(huge) })
    await svc.initialize()
    expect(svc.status.paused?.reason).toBe('too-large')

    await svc.overwriteFileWithBrowser()
    expect(huge.text).not.toHaveBeenCalled()
    expect(svc.status.paused?.reason).toBe('backup-failed')
    expect(svc.status.paused?.message).toContain('too large to back up')
    expectUntouched(writable)
  })
})

// ─── Two loads at once ────────────────────────────────────────────────
// A second load (Retry, StrictMode's double init) while the first waits on
// a question: the newer one decides; the older one stops without touching
// the state (the store answers its question as cancelled).

describe('FileStorageService — a load superseded by a newer one', () => {
  it('the older load, answered "cancel" late, does not pause what the newer one resumed', async () => {
    setSyncState({ fileSavedAt: FILE_SAVED_AT, dirtySince: '2026-10-02T09:00:00.000Z' })
    const { svc } = await startWith()
    let answerFirst!: () => void
    const firstAnswered = new Promise<void>((r) => { answerFirst = r })
    let asked = 0
    svc.onConflict(async () => {
      asked++
      if (asked === 1) {
        await firstAnswered
        return 'cancel'
      }
      return 'file'
    })
    const first = svc.initialize()
    for (let i = 0; i < 100 && asked < 1; i++) await vi.advanceTimersByTimeAsync(1)
    expect(asked).toBe(1)
    await svc.retry()
    expect(svc.status.paused).toBeNull()
    answerFirst()
    await first
    expect(svc.status.paused).toBeNull()
    expect(svc.status.isConnected).toBe(true)
  })
})
