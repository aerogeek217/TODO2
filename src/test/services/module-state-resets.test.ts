import { describe, it, expect, vi, afterEach } from 'vitest'
import { loadFileHandle, saveFileHandle } from '../../services/file-handle-idb'
import { useNoteStore } from '../../stores/note-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useListOrderStore } from '../../stores/list-order-store'
import { usePersonStore } from '../../stores/person-store'
import { fileStorageService } from '../../services/file-storage'
import { backupScheduler } from '../../data/backup-scheduler'
import { noteRepository } from '../../data/note-repository'
import { listOrderRepository } from '../../data/list-order-repository'
import { personRepository } from '../../data/person-repository'
import { backupRepository } from '../../data/backup-repository'
import { resetModuleState } from '../../utils/module-reset'

// Every module with state outside its store registers how to go back to a
// fresh import's state; `resetModuleState` (what the test setups call) runs
// them all, for test files that share one module instance.

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

describe('file handle cache', () => {
  it('closes the cached connection, so the database can be deleted, and the next call reopens it', async () => {
    const handle = { kind: 'file', name: 'a.json' } as unknown as FileSystemFileHandle
    await saveFileHandle(handle)
    resetModuleState()
    expect(await deleteDatabase('todo2-meta')).toBe('deleted')
    // Reopened (and recreated) on the next call.
    expect(await loadFileHandle()).toBeNull()
    await saveFileHandle(handle)
    expect(await loadFileHandle()).toMatchObject({ name: 'a.json' })
    resetModuleState()
    await deleteDatabase('todo2-meta')
  })
})

describe('note saves', () => {
  it('drops a scheduled save', async () => {
    vi.useFakeTimers()
    const save = vi.spyOn(noteRepository, 'saveContent').mockResolvedValue(true)
    useNoteStore.setState({ notes: new Map([[1, { id: 1, content: '', createdAt: new Date(0), modifiedAt: new Date(0) }]]) })
    useNoteStore.getState().setContent(1, 'typed')
    resetModuleState()
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).not.toHaveBeenCalled()
    useNoteStore.setState(useNoteStore.getInitialState(), true)
  })

  it('a save after the reset doesn’t wait for one still running', async () => {
    let finish!: () => void
    const save = vi.spyOn(noteRepository, 'saveContent')
      .mockImplementationOnce(() => new Promise((r) => { finish = () => r(true) }))
      .mockResolvedValue(true)
    useNoteStore.setState({ notes: new Map([[1, { id: 1, content: '', createdAt: new Date(0), modifiedAt: new Date(0) }]]) })
    useNoteStore.getState().setContent(1, 'first')
    const stuck = useNoteStore.getState().flush()
    resetModuleState()
    useNoteStore.setState({ pending: { id: 1, content: 'second', seq: 1 } })
    await useNoteStore.getState().flush()
    expect(save).toHaveBeenLastCalledWith(1, 'second', expect.any(Date))
    finish()
    await stuck
    useNoteStore.setState(useNoteStore.getInitialState(), true)
  })
})

describe('settings', () => {
  it('stops following the OS theme', async () => {
    const remove = vi.fn()
    const add = vi.fn()
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false, media: '', onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: add, removeEventListener: remove, dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList)
    await useSettingsStore.getState().setThemeMode('system')
    expect(add).toHaveBeenCalledTimes(1)
    resetModuleState()
    expect(remove).toHaveBeenCalledWith('change', add.mock.calls[0]?.[1])
    // Nothing left to clean up.
    resetModuleState()
    expect(remove).toHaveBeenCalledTimes(1)
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  })
})

describe('loads in flight', () => {
  it('list order: forgets a load in flight, so the next ensureLoaded reads again', async () => {
    let finish!: () => void
    const getAll = vi.spyOn(listOrderRepository, 'getAll')
      .mockImplementationOnce(() => new Promise((r) => { finish = () => r([]) }))
      .mockResolvedValue([])
    const stuck = useListOrderStore.getState().ensureLoaded()
    resetModuleState()
    await useListOrderStore.getState().ensureLoaded()
    expect(getAll).toHaveBeenCalledTimes(2)
    finish()
    await stuck
    useListOrderStore.setState(useListOrderStore.getInitialState(), true)
  })

  it('a store’s ensureLoaded: forgets the load in flight, and the dropped one doesn’t clear its successor', async () => {
    const finishers: Array<() => void> = []
    const getAll = vi.spyOn(personRepository, 'getAll')
      .mockImplementation(() => new Promise((r) => { finishers.push(() => r([])) }))
    const first = usePersonStore.getState().ensureLoaded()
    resetModuleState()
    const second = usePersonStore.getState().ensureLoaded()
    expect(getAll).toHaveBeenCalledTimes(2)
    finishers[0]?.()
    await first
    // The second load is still the one in flight: a third call shares it.
    const third = usePersonStore.getState().ensureLoaded()
    await vi.waitFor(() => expect(finishers).toHaveLength(2))
    expect(getAll).toHaveBeenCalledTimes(2)
    finishers[1]?.()
    await Promise.all([second, third])
    usePersonStore.setState(usePersonStore.getInitialState(), true)
  })
})

describe('singletons', () => {
  it('the file storage service goes back to no file, no sync', () => {
    const reset = vi.spyOn(fileStorageService, 'reset')
    resetModuleState()
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('the backup scheduler is stopped', async () => {
    vi.useFakeTimers()
    vi.spyOn(backupRepository, 'newestSnapshotAt').mockResolvedValue(new Date())
    backupScheduler.start()
    expect(vi.getTimerCount()).toBe(1)
    resetModuleState()
    expect(vi.getTimerCount()).toBe(0)
    await vi.runAllTimersAsync()
  })
})
