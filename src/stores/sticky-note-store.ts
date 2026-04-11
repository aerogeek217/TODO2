import { create } from 'zustand'
import type { StickyNote } from '../models'
import { stickyNoteRepository } from '../data'
import { undoable } from '../services/undoable'

interface StickyNoteState {
  notes: StickyNote[]
  loading: boolean
  error: string | null

  loadByCanvas: (canvasId: number) => Promise<void>
  add: (canvasId: number, x: number, y: number, color?: string) => Promise<number>
  update: (note: StickyNote) => Promise<void>
  updatePosition: (id: number, x: number, y: number) => Promise<void>
  updateText: (id: number, text: string) => Promise<void>
  updateTitle: (id: number, title: string) => Promise<void>
  updateColor: (id: number, color: string | undefined) => Promise<void>
  remove: (id: number) => Promise<void>
}

export const useStickyNoteStore = create<StickyNoteState>((set, get) => ({
  notes: [],
  loading: false,
  error: null,

  async loadByCanvas(canvasId: number) {
    set({ loading: true, error: null })
    try {
      const notes = await stickyNoteRepository.getByCanvas(canvasId)
      set({ notes })
    } catch (e) {
      console.error('Failed to load sticky notes:', e)
      set({ error: 'Failed to load sticky notes' })
    } finally {
      set({ loading: false })
    }
  },

  async add(canvasId: number, x: number, y: number, color?: string) {
    const now = new Date()
    const id = await stickyNoteRepository.insert({
      canvasId,
      text: '',
      x,
      y,
      width: 240,
      height: 200,
      color: color ?? '#FFF3B0',
      createdAt: now,
      modifiedAt: now,
    })
    const note = await stickyNoteRepository.getById(id)
    if (note) {
      set({ notes: [...get().notes, note] })
    }
    return id
  },

  async update(note: StickyNote) {
    await stickyNoteRepository.update(note)
    set({
      notes: get().notes.map((n) => (n.id === note.id ? { ...note } : n)),
    })
  },

  async updatePosition(id: number, x: number, y: number) {
    await stickyNoteRepository.updatePosition(id, x, y)
    set({
      notes: get().notes.map((n) => (n.id === id ? { ...n, x, y } : n)),
    })
  },

  async updateText(id: number, text: string) {
    const note = get().notes.find((n) => n.id === id)
    if (!note) return
    const updated = { ...note, text, modifiedAt: new Date() }
    await stickyNoteRepository.update(updated)
    set({
      notes: get().notes.map((n) => (n.id === id ? updated : n)),
    })
  },

  async updateTitle(id: number, title: string) {
    const note = get().notes.find((n) => n.id === id)
    if (!note) return
    const updated = { ...note, title: title || undefined, modifiedAt: new Date() }
    await stickyNoteRepository.update(updated)
    set({
      notes: get().notes.map((n) => (n.id === id ? updated : n)),
    })
  },

  async updateColor(id: number, color: string | undefined) {
    const note = get().notes.find((n) => n.id === id)
    if (!note) return
    const updated = { ...note, color, modifiedAt: new Date() }
    await stickyNoteRepository.update(updated)
    set({
      notes: get().notes.map((n) => (n.id === id ? updated : n)),
    })
  },

  async remove(id: number) {
    const note = get().notes.find((n) => n.id === id)
    await stickyNoteRepository.remove(id)
    set({ notes: get().notes.filter((n) => n.id !== id) })
    if (note) {
      undoable(
        'Delete sticky note',
        async () => {
          await stickyNoteRepository.remove(id)
          set({ notes: get().notes.filter((n) => n.id !== id) })
        },
        async () => {
          await stickyNoteRepository.insert(note)
          set({ notes: [...get().notes, note] })
        },
        true,
      )
    }
  },
}))
