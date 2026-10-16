import { describe, it, expect, afterEach, vi } from 'vitest'
import { clearFileHandle, saveFileHandle, saveLastPickerHandle } from '../../services/file-handle-idb'

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
