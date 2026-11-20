import { describe, it, expect, afterEach, vi } from 'vitest'
import { clearFileHandle, loadFileHandle, saveFileHandle, saveLastPickerHandle } from '../../services/file-handle-idb'

// A write transaction that aborts (e.g. storage quota) fires `abort`, not
// `error` on the transaction: the write must reject, never hang (Open /
// Create file / Disconnect wait on it).

afterEach(() => {
  vi.restoreAllMocks()
})

function abortingTransactions() {
  const store = { put: vi.fn(), delete: vi.fn() }
  vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(() => {
    const tx = {
      objectStore: () => store,
      error: new DOMException('quota', 'QuotaExceededError'),
      oncomplete: null as null | (() => void),
      onerror: null as null | (() => void),
      onabort: null as null | (() => void),
    }
    queueMicrotask(() => { tx.onabort?.() })
    return tx as unknown as IDBTransaction
  })
}

describe('file-handle-idb writes when the transaction aborts', () => {
  it('saveFileHandle / clearFileHandle / saveLastPickerHandle reject', async () => {
    // Opens (and caches) the meta database before the transactions are faked.
    await clearFileHandle()
    abortingTransactions()
    const handle = {} as FileSystemFileHandle
    await expect(saveFileHandle(handle)).rejects.toThrow('quota')
    await expect(clearFileHandle()).rejects.toThrow('quota')
    await expect(saveLastPickerHandle(handle)).rejects.toThrow('quota')
  })
})

// An open the browser holds up (another connection in the way) fires
// `blocked` and may never fire anything else: launch reads the stored file
// handle through it, so it must reject, never hang.
describe('file-handle-idb when the open is blocked', () => {
  it('loadFileHandle / clearFileHandle reject', async () => {
    const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      const req = { onblocked: null as null | (() => void) }
      queueMicrotask(() => { req.onblocked?.() })
      return req as unknown as IDBOpenDBRequest
    })
    await expect(loadFileHandle()).rejects.toThrow(/holding the sync file’s link open/)
    await expect(clearFileHandle()).rejects.toThrow(/holding the sync file’s link open/)
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('an open that goes through after all is used by the next call', async () => {
    const realOpen = indexedDB.open.bind(indexedDB)
    const open = vi.spyOn(indexedDB, 'open').mockImplementationOnce((name, version) => {
      const req = realOpen(name, version)
      // Blocked first; the real open then succeeds.
      queueMicrotask(() => { req.onblocked?.(new Event('blocked') as IDBVersionChangeEvent) })
      return req
    })
    await expect(loadFileHandle()).rejects.toThrow()
    // Let the real open land: its connection is kept.
    await new Promise((resolve) => setTimeout(resolve, 20))
    await expect(loadFileHandle()).resolves.toBeNull()
    expect(open).toHaveBeenCalledTimes(1)
  })
})
