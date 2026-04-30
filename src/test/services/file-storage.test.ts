import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
}))

const mockRestoreFromImportData = vi.fn().mockResolvedValue(undefined)

vi.mock('../../data/restore', () => ({
  restoreFromImportData: (...args: unknown[]) => mockRestoreFromImportData(...args),
}))

const mockBuildExportData = vi.fn().mockResolvedValue({ todos: [], projects: [] })

vi.mock('../../services/export-import', () => ({
  buildExportData: (...args: unknown[]) => mockBuildExportData(...args),
}))

const mockSnapshotBeforeDestructive = vi.fn().mockResolvedValue(undefined)

vi.mock('../../services/backup-scheduler', () => ({
  backupScheduler: {
    snapshotBeforeDestructive: (...args: unknown[]) => mockSnapshotBeforeDestructive(...args),
  },
}))

// Mock ALL_DATA_TABLES with minimal hook API
function makeMockTable() {
  const hooks: Record<string, { subscribe: ReturnType<typeof vi.fn>; unsubscribe: ReturnType<typeof vi.fn> }> = {}
  return {
    hook: (name: string) => {
      if (!hooks[name]) hooks[name] = { subscribe: vi.fn(), unsubscribe: vi.fn() }
      return hooks[name]
    },
    _hooks: hooks,
  }
}

const mockTables = Array.from({ length: 14 }, () => makeMockTable())

vi.mock('../../data/database', () => ({
  ALL_DATA_TABLES: mockTables,
  // file-storage doesn't read these directly, but migration-check (transitively
  // imported via detectUnsupportedImport) does. Mocked exports must mirror the
  // real module's surface or the import explodes — see vitest "No X export defined".
  CURRENT_DB_VERSION: 48,
  OLDEST_SUPPORTED_DB_VERSION: 16,
}))

// ─── Helpers ──────────────────────────────────────────────────────────

function createMockHandle(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'file',
    name: 'todo2-data.json',
    getFile: vi.fn().mockResolvedValue(
      new File(['{"todos":[],"canvases":[]}'], 'todo2-data.json', { type: 'application/json' })
    ),
    queryPermission: vi.fn().mockResolvedValue('granted'),
    requestPermission: vi.fn().mockResolvedValue('granted'),
    createWritable: vi.fn().mockResolvedValue({
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    }),
    isSameEntry: vi.fn(),
    ...overrides,
  }
}

const validImportData = { todos: [], canvases: [{ id: 1, name: 'Default' }] }

async function getService() {
  const mod = await import('../../services/file-storage')
  return mod.fileStorageService
}

// ─── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()

  // Reset all mock call counts AND set default return values
  mockLoadFileHandle.mockReset().mockResolvedValue(null)
  mockSaveFileHandle.mockReset().mockResolvedValue(undefined)
  mockClearFileHandle.mockReset().mockResolvedValue(undefined)
  mockValidateImportData.mockReset().mockReturnValue({ ok: true, data: validImportData })
  mockRestoreFromImportData.mockReset().mockResolvedValue(undefined)
  mockBuildExportData.mockReset().mockResolvedValue({ todos: [], projects: [] })
  mockSnapshotBeforeDestructive.mockReset().mockResolvedValue(undefined)

  // Reset mock table hook call counts
  for (const table of mockTables) {
    for (const hookName of ['creating', 'updating', 'deleting']) {
      if (table._hooks[hookName]) {
        table._hooks[hookName].subscribe.mockClear()
        table._hooks[hookName].unsubscribe.mockClear()
      }
    }
  }

  // Make File System Access API "available"
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

// ─── initialize ───────────────────────────────────────────────────────

describe('FileStorageService — initialize', () => {
  it('does nothing when no saved handle exists', async () => {
    mockLoadFileHandle.mockResolvedValue(null)
    const svc = await getService()

    await svc.initialize()

    expect(svc.status.isConnected).toBe(false)
    expect(svc.status.fileName).toBeNull()
    expect(svc.status.needsPermission).toBe(false)
  })

  it('connects and loads file when saved handle has granted permission', async () => {
    const handle = createMockHandle()
    mockLoadFileHandle.mockResolvedValue(handle)

    const svc = await getService()
    await svc.initialize()

    expect(svc.status.isConnected).toBe(true)
    expect(svc.status.fileName).toBe('todo2-data.json')
    expect(svc.status.needsPermission).toBe(false)
    expect(mockRestoreFromImportData).toHaveBeenCalledWith(validImportData)
  })

  it('sets needsPermission when handle permission is not granted', async () => {
    const handle = createMockHandle({ queryPermission: vi.fn().mockResolvedValue('prompt') })
    mockLoadFileHandle.mockResolvedValue(handle)

    const svc = await getService()
    await svc.initialize()

    expect(svc.status.isConnected).toBe(false)
    expect(svc.status.needsPermission).toBe(true)
    expect(svc.status.fileName).toBe('todo2-data.json')
  })

  it('skips initialization when File System Access API is not supported', async () => {
    delete (window as any).showOpenFilePicker
    const svc = await getService()

    await svc.initialize()

    expect(svc.status.isConnected).toBe(false)
    expect(mockLoadFileHandle).not.toHaveBeenCalled()
  })
})

// ─── reconnect ────────────────────────────────────────────────────────

describe('FileStorageService — reconnect', () => {
  it('connects when permission is granted on reconnect', async () => {
    const handle = createMockHandle({
      queryPermission: vi.fn().mockResolvedValue('prompt'),
      requestPermission: vi.fn().mockResolvedValue('granted'),
    })
    mockLoadFileHandle.mockResolvedValue(handle)

    const svc = await getService()
    await svc.initialize()
    expect(svc.status.needsPermission).toBe(true)

    await svc.reconnect()

    expect(svc.status.isConnected).toBe(true)
    expect(svc.status.needsPermission).toBe(false)
  })

  it('sets error when permission denied on reconnect', async () => {
    const handle = createMockHandle({
      queryPermission: vi.fn().mockResolvedValue('prompt'),
      requestPermission: vi.fn().mockResolvedValue('denied'),
    })
    mockLoadFileHandle.mockResolvedValue(handle)

    const svc = await getService()
    await svc.initialize()

    await svc.reconnect()

    expect(svc.status.isConnected).toBe(false)
    expect(svc.status.error).toBe('Permission denied')
  })
})

// ─── disconnect ───────────────────────────────────────────────────────

describe('FileStorageService — disconnect', () => {
  it('clears handle and resets all status', async () => {
    const handle = createMockHandle()
    mockLoadFileHandle.mockResolvedValue(handle)

    const svc = await getService()
    await svc.initialize()
    expect(svc.status.isConnected).toBe(true)

    await svc.disconnect()

    expect(svc.status.isConnected).toBe(false)
    expect(svc.status.fileName).toBeNull()
    expect(svc.status.lastSavedAt).toBeNull()
    expect(svc.status.error).toBeNull()
    expect(svc.status.needsPermission).toBe(false)
    expect(mockClearFileHandle).toHaveBeenCalled()
  })
})

// ─── openFile ─────────────────────────────────────────────────────────

describe('FileStorageService — openFile', () => {
  it('connects after picking a file', async () => {
    const handle = createMockHandle()
    vi.stubGlobal('showOpenFilePicker', vi.fn().mockResolvedValue([handle]))

    const svc = await getService()
    await svc.openFile()

    expect(svc.status.isConnected).toBe(true)
    expect(svc.status.fileName).toBe('todo2-data.json')
    expect(mockSaveFileHandle).toHaveBeenCalledWith(handle)
    expect(mockRestoreFromImportData).toHaveBeenCalled()
  })

  it('does not set error when user cancels the picker', async () => {
    // jsdom's DOMException may not extend Error; use a plain Error with AbortError name
    const abortError = new Error('User cancelled')
    abortError.name = 'AbortError'
    vi.stubGlobal('showOpenFilePicker', vi.fn().mockRejectedValue(abortError))

    const svc = await getService()
    await svc.openFile()

    expect(svc.status.isConnected).toBe(false)
    expect(svc.status.error).toBeNull()
  })
})

// ─── createFile ───────────────────────────────────────────────────────

describe('FileStorageService — createFile', () => {
  it('connects and saves to new file', async () => {
    const writable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    }
    const handle = createMockHandle({ createWritable: vi.fn().mockResolvedValue(writable) })
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue(handle))

    const svc = await getService()
    await svc.createFile()

    expect(svc.status.isConnected).toBe(true)
    expect(svc.status.fileName).toBe('todo2-data.json')
    expect(mockSaveFileHandle).toHaveBeenCalledWith(handle)
    expect(writable.write).toHaveBeenCalled()
    expect(writable.close).toHaveBeenCalled()
  })
})

// ─── loadFromFile error handling ──────────────────────────────────────

describe('FileStorageService — loadFromFile errors', () => {
  it('sets error for file too large', async () => {
    const bigFile = new File(['x'], 'big.json', { type: 'application/json' })
    Object.defineProperty(bigFile, 'size', { value: 60 * 1024 * 1024 }) // 60MB > 50MB limit
    const handle = createMockHandle({ getFile: vi.fn().mockResolvedValue(bigFile) })
    mockLoadFileHandle.mockResolvedValue(handle)

    const svc = await getService()
    await svc.initialize()

    expect(svc.status.error).toBe('File too large (50 MB max)')
    // Handle is still set (not cleared on size error), so isConnected remains true
    expect(svc.status.fileName).toBe('todo2-data.json')
  })

  it('sets error for invalid JSON', async () => {
    const badFile = new File(['not json{{{'], 'bad.json', { type: 'application/json' })
    const handle = createMockHandle({ getFile: vi.fn().mockResolvedValue(badFile) })
    mockLoadFileHandle.mockResolvedValue(handle)

    const svc = await getService()
    await svc.initialize()

    expect(svc.status.error).toMatch(/invalid JSON/)
  })

  it('sets error when validation fails', async () => {
    mockValidateImportData.mockReturnValue({ ok: false, error: 'Missing todos field' })
    const handle = createMockHandle()
    mockLoadFileHandle.mockResolvedValue(handle)

    const svc = await getService()
    await svc.initialize()

    expect(svc.status.error).toBe('Missing todos field')
  })

  it('handles file not found (moved/deleted)', async () => {
    const notFoundError = new Error('File not found')
    notFoundError.name = 'NotFoundError'
    const handle = createMockHandle({ getFile: vi.fn().mockRejectedValue(notFoundError) })
    mockLoadFileHandle.mockResolvedValue(handle)

    const svc = await getService()
    await svc.initialize()

    expect(svc.status.error).toMatch(/not found/)
    expect(svc.status.fileName).toBeNull()
    expect(mockClearFileHandle).toHaveBeenCalled()
  })

  it('seeds empty file with current DB data', async () => {
    const emptyFile = new File([''], 'empty.json', { type: 'application/json' })
    const writable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    }
    const handle = createMockHandle({
      getFile: vi.fn().mockResolvedValue(emptyFile),
      createWritable: vi.fn().mockResolvedValue(writable),
    })
    mockLoadFileHandle.mockResolvedValue(handle)

    const svc = await getService()
    await svc.initialize()

    // Should have saved (seeded) instead of restored
    expect(mockRestoreFromImportData).not.toHaveBeenCalled()
    expect(writable.write).toHaveBeenCalled()
    expect(svc.status.isConnected).toBe(true)
  })
})

// ─── Status listener ──────────────────────────────────────────────────

describe('FileStorageService — status notifications', () => {
  it('notifies listener on status changes', async () => {
    const listener = vi.fn()
    const handle = createMockHandle()
    mockLoadFileHandle.mockResolvedValue(handle)

    const svc = await getService()
    svc.onStatusChange(listener)

    await svc.initialize()

    expect(listener).toHaveBeenCalled()
    const lastStatus = listener.mock.calls[listener.mock.calls.length - 1]![0]
    expect(lastStatus.isConnected).toBe(true)
  })

  it('notifies afterImport listener after loading file data', async () => {
    const afterImport = vi.fn().mockResolvedValue(undefined)
    const handle = createMockHandle()
    mockLoadFileHandle.mockResolvedValue(handle)

    const svc = await getService()
    svc.onAfterImport(afterImport)

    await svc.initialize()

    expect(afterImport).toHaveBeenCalled()
  })
})

// ─── Dexie hook management ────────────────────────────────────────────

describe('FileStorageService — hook management', () => {
  it('installs hooks on all data tables when connected', async () => {
    const handle = createMockHandle()
    mockLoadFileHandle.mockResolvedValue(handle)

    const svc = await getService()
    await svc.initialize()

    // Each of the 14 tables should have creating, updating, deleting hooks subscribed
    for (const table of mockTables) {
      expect(table.hook('creating').subscribe).toHaveBeenCalled()
      expect(table.hook('updating').subscribe).toHaveBeenCalled()
      expect(table.hook('deleting').subscribe).toHaveBeenCalled()
    }
  })

  it('removes hooks on disconnect', async () => {
    const handle = createMockHandle()
    mockLoadFileHandle.mockResolvedValue(handle)

    const svc = await getService()
    await svc.initialize()
    await svc.disconnect()

    // Unsubscribe should have been called for all hooks
    for (const table of mockTables) {
      expect(table.hook('creating').unsubscribe).toHaveBeenCalled()
      expect(table.hook('updating').unsubscribe).toHaveBeenCalled()
      expect(table.hook('deleting').unsubscribe).toHaveBeenCalled()
    }
  })
})
