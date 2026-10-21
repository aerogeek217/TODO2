import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { useNoteStore, SAVE_DEBOUNCE_MS } from '../../stores/note-store'
import { noteRepository } from '../../data/note-repository'
import { useUndoStore } from '../../stores/undo-store'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

beforeEach(async () => {
  await db.delete()
  await db.open()
  useNoteStore.setState(useNoteStore.getInitialState(), true)
  useUndoStore.getState().clear()
  useUndoStore.getState().dismissSnackbar()
})

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

const contentInStore = () => {
  const { notes, activeId } = useNoteStore.getState()
  return notes.get(activeId!)!.content
}
const contentInDb = async () => (await db.notes.get(useNoteStore.getState().activeId!))!.content

describe('useNoteStore', () => {
  describe('load', () => {
    it('seeds an empty note on first load and marks it active', async () => {
      await useNoteStore.getState().load()
      const state = useNoteStore.getState()
      expect(state.activeId).not.toBeNull()
      expect(state.notes.size).toBe(1)
      expect(state.notes.get(state.activeId!)!.content).toBe('')

      const rows = await db.notes.toArray()
      expect(rows).toHaveLength(1)
    })

    it('does not reseed when a note already exists', async () => {
      const now = new Date()
      const id = await db.notes.add({ content: 'hello', createdAt: now, modifiedAt: now })
      await useNoteStore.getState().load()
      const state = useNoteStore.getState()
      expect(state.activeId).toBe(id)
      expect(state.notes.get(id)!.content).toBe('hello')
      expect(await db.notes.count()).toBe(1)
    })
  })

  describe('setContent', () => {
    it('updates state immediately and debounces the persistence write', async () => {
      await useNoteStore.getState().load()
      const id = useNoteStore.getState().activeId!

      useNoteStore.getState().setContent(id, 'draft-1')
      expect(useNoteStore.getState().notes.get(id)!.content).toBe('draft-1')

      // Persistence is debounced 500ms; before the debounce fires the repo still holds ''.
      await useNoteStore.getState().flush()
      const persisted = await db.notes.get(id)
      expect(persisted!.content).toBe('draft-1')
      expect(useNoteStore.getState().lastSavedAt).toBeInstanceOf(Date)
    })

    it('coalesces rapid edits into a single persistence call', async () => {
      await useNoteStore.getState().load()
      const id = useNoteStore.getState().activeId!
      const updateSpy = vi.spyOn(noteRepository, 'saveContent')

      // Fake only the debounce timer — Dexie / fake-indexeddb keep their real
      // scheduling. A real-time wait raced the persist under load: a stalled
      // worker fires the debounce and the wait together, before the persist's
      // own repo read resolves.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      useNoteStore.getState().setContent(id, 'one')
      useNoteStore.getState().setContent(id, 'two')
      useNoteStore.getState().setContent(id, 'three')

      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1)
      expect(updateSpy).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      // Wait for the write to start, then for it to land.
      await vi.waitFor(() => expect(updateSpy).toHaveBeenCalled())
      await updateSpy.mock.results[0]?.value
      expect(updateSpy).toHaveBeenCalledTimes(1)
      const persisted = await db.notes.get(id)
      expect(persisted!.content).toBe('three')
    })
  })

  describe('flush', () => {
    it('writes pending changes immediately', async () => {
      await useNoteStore.getState().load()
      const id = useNoteStore.getState().activeId!

      useNoteStore.getState().setContent(id, 'pending')
      await useNoteStore.getState().flush()

      const persisted = await db.notes.get(id)
      expect(persisted!.content).toBe('pending')
    })
  })

  describe('the page hidden or closed', () => {
    it.each([
      ['pagehide', () => window.dispatchEvent(new Event('pagehide'))],
      ['visibilitychange to hidden', () => {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
        document.dispatchEvent(new Event('visibilitychange'))
      }],
    ])('%s starts the pending save in the handler, before the debounce', async (_name, hide) => {
      await useNoteStore.getState().load()
      const id = useNoteStore.getState().activeId!
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const save = vi.spyOn(noteRepository, 'saveContent')
      useNoteStore.getState().setContent(id, 'typed just before closing')
      hide()
      expect(save).toHaveBeenCalledTimes(1)
      expect(save).toHaveBeenCalledWith(id, 'typed just before closing', expect.any(Date))
      await save.mock.results[0]?.value
      expect(await contentInDb()).toBe('typed just before closing')
      // The debounce has nothing left to save.
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)
      expect(save).toHaveBeenCalledTimes(1)
    })

    it('a page shown again saves nothing', async () => {
      await useNoteStore.getState().load()
      const save = vi.spyOn(noteRepository, 'saveContent')
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('pagehide'))
      expect(save).not.toHaveBeenCalled()
    })
  })

  describe('concurrent loads', () => {
    it('two loads at once seed one note and agree on it', async () => {
      const seed = vi.spyOn(noteRepository, 'getOrSeedGlobal')
      await Promise.all([useNoteStore.getState().load(), useNoteStore.getState().load()])

      expect(seed).toHaveBeenCalledTimes(1)
      expect(await db.notes.count()).toBe(1)
      expect(useNoteStore.getState().loadInFlight).toBeNull()
    })

    it('the seed is idempotent even without the shared load (e.g. two tabs)', async () => {
      const [a, b] = await Promise.all([noteRepository.getOrSeedGlobal(), noteRepository.getOrSeedGlobal()])

      expect(await db.notes.count()).toBe(1)
      expect(a[0]!.id).toBe(b[0]!.id)
    })

    it('a load after the store resets reads again', async () => {
      await useNoteStore.getState().load()
      const seed = vi.spyOn(noteRepository, 'getOrSeedGlobal')
      useNoteStore.setState(useNoteStore.getInitialState(), true)

      await useNoteStore.getState().load()
      expect(seed).toHaveBeenCalledTimes(1)
      expect(useNoteStore.getState().activeId).not.toBeNull()
    })

    it('a failed load is reported and leaves no load in flight', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.spyOn(noteRepository, 'getOrSeedGlobal').mockRejectedValueOnce(new Error('IDB unavailable'))

      await expect(useNoteStore.getState().load()).resolves.toBeUndefined()
      expect(useNoteStore.getState().loadInFlight).toBeNull()
      expect(useUndoStore.getState().snackbar?.description).toBe("Couldn't load notes. Reload the page to try again.")

      await useNoteStore.getState().load()
      expect(useNoteStore.getState().activeId).not.toBeNull()
    })
  })

  describe('a save racing new keystrokes', () => {
    it('text typed while a save is in flight is neither replaced in the store nor lost in the database', async () => {
      await useNoteStore.getState().load()
      const id = useNoteStore.getState().activeId!
      const written = deferred()
      const release = deferred()
      const realSave = noteRepository.saveContent.bind(noteRepository)
      const saveSpy = vi.spyOn(noteRepository, 'saveContent').mockImplementationOnce(async (...args) => {
        const ok = await realSave(...args)
        written.resolve()
        await release.promise
        return ok
      })

      useNoteStore.getState().setContent(id, 'first')
      const firstSave = useNoteStore.getState().flush()
      await written.promise
      useNoteStore.getState().setContent(id, 'first and more')
      release.resolve()
      await firstSave

      // The finished save of 'first' doesn't put the older text back.
      expect(contentInStore()).toBe('first and more')
      expect(useNoteStore.getState().pending?.content).toBe('first and more')

      await useNoteStore.getState().flush()
      expect(await contentInDb()).toBe('first and more')
      expect(useNoteStore.getState().pending).toBeNull()
      expect(saveSpy).toHaveBeenCalledTimes(2)
    })

    it('a save started while another is in flight waits for it, so the newer text lands last', async () => {
      await useNoteStore.getState().load()
      const id = useNoteStore.getState().activeId!
      const release = deferred()
      const realSave = noteRepository.saveContent.bind(noteRepository)
      vi.spyOn(noteRepository, 'saveContent').mockImplementationOnce(async (...args) => {
        await release.promise
        return realSave(...args)
      })

      useNoteStore.getState().setContent(id, 'older')
      const first = useNoteStore.getState().flush()
      useNoteStore.getState().setContent(id, 'newer')
      const second = useNoteStore.getState().flush()
      release.resolve()
      await Promise.all([first, second])

      expect(await contentInDb()).toBe('newer')
      expect(contentInStore()).toBe('newer')
    })
  })

  describe('a failed save', () => {
    it('keeps the text, says so once, never rejects, and saves it with the next change', async () => {
      await useNoteStore.getState().load()
      const id = useNoteStore.getState().activeId!
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const saveSpy = vi.spyOn(noteRepository, 'saveContent')
        .mockRejectedValueOnce(new Error('QuotaExceededError'))
        .mockRejectedValueOnce(new Error('QuotaExceededError'))

      useNoteStore.getState().setContent(id, 'draft')
      await expect(useNoteStore.getState().flush()).resolves.toBeUndefined()
      expect(contentInStore()).toBe('draft')
      expect(useNoteStore.getState().pending?.content).toBe('draft')
      expect(useNoteStore.getState().saveFailed).toBe(true)
      expect(useUndoStore.getState().snackbar).toEqual({
        description: "Couldn't save your notes. They'll be saved with your next change.",
        notice: true,
      })
      expect(await contentInDb()).toBe('')

      // Still failing: no second notice.
      useUndoStore.getState().dismissSnackbar()
      useNoteStore.getState().setContent(id, 'draft 2')
      await useNoteStore.getState().flush()
      expect(useUndoStore.getState().snackbar).toBeNull()

      useNoteStore.getState().setContent(id, 'draft 3')
      await useNoteStore.getState().flush()
      expect(await contentInDb()).toBe('draft 3')
      expect(useNoteStore.getState().pending).toBeNull()
      expect(useNoteStore.getState().saveFailed).toBe(false)
      expect(saveSpy).toHaveBeenCalledTimes(3)
    })

    it('a failed debounced save is not an unhandled rejection', async () => {
      await useNoteStore.getState().load()
      const id = useNoteStore.getState().activeId!
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const saveSpy = vi.spyOn(noteRepository, 'saveContent').mockRejectedValueOnce(new Error('boom'))
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      useNoteStore.getState().setContent(id, 'draft')
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(useNoteStore.getState().saveFailed).toBe(true))
      expect(saveSpy).toHaveBeenCalledTimes(1)
      expect(contentInStore()).toBe('draft')
    })
  })

  describe('load while text is unsaved', () => {
    it('keeps the unsaved text in the store, and the save still writes it', async () => {
      await useNoteStore.getState().load()
      const id = useNoteStore.getState().activeId!
      useNoteStore.getState().setContent(id, 'typed')

      await useNoteStore.getState().load()
      expect(contentInStore()).toBe('typed')
      await useNoteStore.getState().flush()
      expect(await contentInDb()).toBe('typed')
    })
  })
})

describe('useNoteStore.holdForDataReplace', () => {
  it('saves the text typed before it, and no save starts while it holds', async () => {
    await useNoteStore.getState().load()
    const id = useNoteStore.getState().activeId!
    useNoteStore.getState().setContent(id, 'typed before')
    const release = await useNoteStore.getState().holdForDataReplace()
    expect(useNoteStore.getState().pending).toBeNull()
    expect(await contentInDb()).toBe('typed before')

    // Typed during the replace: stays pending, not written.
    useNoteStore.getState().setContent(id, 'typed during')
    await useNoteStore.getState().flush()
    expect(await contentInDb()).toBe('typed before')
    expect(useNoteStore.getState().pending?.content).toBe('typed during')

    // The reload drops it (as `refreshAllStores` does); release writes nothing.
    useNoteStore.getState().discardPending()
    release()
    await useNoteStore.getState().flush()
    expect(await contentInDb()).toBe('typed before')
    expect(useNoteStore.getState().replaceHolds).toBe(0)
  })

  it('a replace that failed (no reload) saves the text typed meanwhile on release', async () => {
    await useNoteStore.getState().load()
    const id = useNoteStore.getState().activeId!
    const release = await useNoteStore.getState().holdForDataReplace()
    useNoteStore.getState().setContent(id, 'typed during')
    release()
    release()
    await useNoteStore.getState().flush()
    expect(await contentInDb()).toBe('typed during')
    expect(useNoteStore.getState().replaceHolds).toBe(0)
  })

  it('holds nest: text typed during an outer hold survives an inner one and is saved when the last is released', async () => {
    await useNoteStore.getState().load()
    const id = useNoteStore.getState().activeId!
    const releaseOuter = await useNoteStore.getState().holdForDataReplace()
    useNoteStore.getState().setContent(id, 'typed during the outer hold')
    const releaseInner = await useNoteStore.getState().holdForDataReplace()
    expect(useNoteStore.getState().pending?.content).toBe('typed during the outer hold')
    releaseInner()
    await useNoteStore.getState().flush()
    expect(await contentInDb()).toBe('')
    releaseOuter()
    await useNoteStore.getState().flush()
    expect(await contentInDb()).toBe('typed during the outer hold')
  })
})

describe('useNoteStore.holdForDataReplace when the save before it fails', () => {
  it('drops the text (the replace goes ahead) and says the save failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await useNoteStore.getState().load()
    const id = useNoteStore.getState().activeId!
    useNoteStore.getState().setContent(id, 'typed before')
    vi.spyOn(noteRepository, 'saveContent').mockRejectedValueOnce(new Error('disk full'))

    const release = await useNoteStore.getState().holdForDataReplace()

    expect(useNoteStore.getState().pending).toBeNull()
    expect(await contentInDb()).toBe('')
    expect(useUndoStore.getState().snackbar?.description).toMatch(/^Couldn't save your notes/)
    release()
    await useNoteStore.getState().flush()
    expect(await contentInDb()).toBe('')
  })
})
