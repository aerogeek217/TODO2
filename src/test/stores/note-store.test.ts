import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../../data/database'
import { useNoteStore } from '../../stores/note-store'
import { noteRepository } from '../../data/note-repository'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  useNoteStore.setState({ notes: new Map(), activeId: null, lastSavedAt: null })
})

describe('useNoteStore', () => {
  describe('load', () => {
    it('seeds an empty note on first load and marks it active', async () => {
      await useNoteStore.getState().load()
      const state = useNoteStore.getState()
      expect(state.activeId).not.toBeNull()
      expect(state.notes.size).toBe(1)
      expect(state.notes.get(state.activeId!)!.content).toBe('')

      const rows = await noteRepository.getAll()
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
      const persisted = await noteRepository.getById(id)
      expect(persisted!.content).toBe('draft-1')
      expect(useNoteStore.getState().lastSavedAt).toBeInstanceOf(Date)
    })

    it('coalesces rapid edits into a single persistence call', async () => {
      await useNoteStore.getState().load()
      const id = useNoteStore.getState().activeId!
      const updateSpy = vi.spyOn(noteRepository, 'update')

      useNoteStore.getState().setContent(id, 'one')
      useNoteStore.getState().setContent(id, 'two')
      useNoteStore.getState().setContent(id, 'three')

      await wait(650)
      expect(updateSpy).toHaveBeenCalledTimes(1)
      const persisted = await noteRepository.getById(id)
      expect(persisted!.content).toBe('three')
      updateSpy.mockRestore()
    })
  })

  describe('flush', () => {
    it('writes pending changes immediately', async () => {
      await useNoteStore.getState().load()
      const id = useNoteStore.getState().activeId!

      useNoteStore.getState().setContent(id, 'pending')
      await useNoteStore.getState().flush()

      const persisted = await noteRepository.getById(id)
      expect(persisted!.content).toBe('pending')
    })
  })
})
