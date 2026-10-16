import { describe, it, expect, vi, afterEach } from 'vitest'
import { loadFileHandle, resetFileHandleCache, saveFileHandle } from '../../services/file-handle-idb'
import { resetNoteSaves, useNoteStore } from '../../stores/note-store'
import { resetSettingsModuleState, useSettingsStore } from '../../stores/settings-store'
import { resetListOrderLoad, useListOrderStore } from '../../stores/list-order-store'
import { noteRepository } from '../../data/note-repository'
import { listOrderRepository } from '../../data/list-order-repository'

// Each module-state reset puts its module back as a fresh import would have
// it, for test files that share one module instance.

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function deleteDatabase(name: string): Promise<'deleted' | 'blocked'> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = () => resolve('deleted')
    req.onblocked = () => resolve('blocked')
    req.onerror = () => reject(req.error)
  })
}

describe('resetFileHandleCache', () => {
  it('closes the cached connection, so the database can be deleted, and the next call reopens it', async () => {
    const handle = { kind: 'file', name: 'a.json' } as unknown as FileSystemFileHandle
    await saveFileHandle(handle)
    resetFileHandleCache()
    expect(await deleteDatabase('todo2-meta')).toBe('deleted')
    // Reopened (and recreated) on the next call.
    expect(await loadFileHandle()).toBeNull()
    await saveFileHandle(handle)
    expect(await loadFileHandle()).toMatchObject({ name: 'a.json' })
    resetFileHandleCache()
    await deleteDatabase('todo2-meta')
  })
})

describe('resetNoteSaves', () => {
  it('drops a scheduled save', async () => {
    vi.useFakeTimers()
    const save = vi.spyOn(noteRepository, 'saveContent').mockResolvedValue(true)
    useNoteStore.setState({ notes: new Map([[1, { id: 1, content: '', modifiedAt: new Date(0) } as never]]) })
    useNoteStore.getState().setContent(1, 'typed')
    resetNoteSaves()
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).not.toHaveBeenCalled()
    useNoteStore.setState(useNoteStore.getInitialState(), true)
  })

  it('a save after the reset doesn’t wait for one still running', async () => {
    let finish!: () => void
    const save = vi.spyOn(noteRepository, 'saveContent')
      .mockImplementationOnce(() => new Promise((r) => { finish = () => r(true) }))
      .mockResolvedValue(true)
    useNoteStore.setState({ notes: new Map([[1, { id: 1, content: '', modifiedAt: new Date(0) } as never]]) })
    useNoteStore.getState().setContent(1, 'first')
    const stuck = useNoteStore.getState().flush()
    resetNoteSaves()
    useNoteStore.setState({ pending: { id: 1, content: 'second', seq: 1 } })
    await useNoteStore.getState().flush()
    expect(save).toHaveBeenLastCalledWith(1, 'second', expect.any(Date))
    finish()
    await stuck
    useNoteStore.setState(useNoteStore.getInitialState(), true)
  })
})

describe('resetSettingsModuleState', () => {
  it('stops following the OS theme', async () => {
    const remove = vi.fn()
    const add = vi.fn()
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false, media: '', onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: add, removeEventListener: remove, dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList)
    await useSettingsStore.getState().setThemeMode('system')
    expect(add).toHaveBeenCalledTimes(1)
    resetSettingsModuleState()
    expect(remove).toHaveBeenCalledWith('change', add.mock.calls[0]![1])
    // Nothing left to clean up.
    resetSettingsModuleState()
    expect(remove).toHaveBeenCalledTimes(1)
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  })
})

describe('resetListOrderLoad', () => {
  it('forgets a load in flight, so the next ensureLoaded reads again', async () => {
    let finish!: () => void
    const getAll = vi.spyOn(listOrderRepository, 'getAll')
      .mockImplementationOnce(() => new Promise((r) => { finish = () => r([]) }))
      .mockResolvedValue([])
    const stuck = useListOrderStore.getState().ensureLoaded()
    resetListOrderLoad()
    await useListOrderStore.getState().ensureLoaded()
    expect(getAll).toHaveBeenCalledTimes(2)
    finish()
    await stuck
    useListOrderStore.setState(useListOrderStore.getInitialState(), true)
  })
})
