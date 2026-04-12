import { create } from 'zustand'
import type { StickyNote } from '../models'
import { stickyNoteRepository } from '../data'
import { undoable } from '../services/undoable'
import { mutate, optimistic } from './store-helpers'

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
    return mutate(set, async () => {
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
    }, 'Failed to add sticky note')
  },

  async update(note: StickyNote) {
    const prev = get().notes.find((n) => n.id === note.id)
    if (!prev) return
    const snapshot = { ...prev }
    return optimistic(
      set,
      () => set({
        notes: get().notes.map((n) => (n.id === note.id ? { ...note } : n)),
      }),
      () => stickyNoteRepository.update(note),
      () => set({
        notes: get().notes.map((n) => (n.id === note.id ? snapshot : n)),
      }),
      'Failed to update sticky note',
    )
  },

  async updatePosition(id: number, x: number, y: number) {
    const prev = get().notes.find((n) => n.id === id)
    if (!prev) return
    const prevX = prev.x
    const prevY = prev.y
    return optimistic(
      set,
      () => set({
        notes: get().notes.map((n) => (n.id === id ? { ...n, x, y } : n)),
      }),
      () => stickyNoteRepository.updatePosition(id, x, y),
      () => set({
        notes: get().notes.map((n) => (n.id === id ? { ...n, x: prevX, y: prevY } : n)),
      }),
      'Failed to update sticky note position',
    )
  },

  async updateText(id: number, text: string) {
    const note = get().notes.find((n) => n.id === id)
    if (!note) return
    const prevText = note.text
    const updated = { ...note, text, modifiedAt: new Date() }
    return optimistic(
      set,
      () => set({
        notes: get().notes.map((n) => (n.id === id ? updated : n)),
      }),
      () => stickyNoteRepository.update(updated),
      () => set({
        notes: get().notes.map((n) => (n.id === id ? { ...n, text: prevText } : n)),
      }),
      'Failed to update sticky note text',
    )
  },

  async updateTitle(id: number, title: string) {
    const note = get().notes.find((n) => n.id === id)
    if (!note) return
    const prevTitle = note.title
    const updated = { ...note, title: title || undefined, modifiedAt: new Date() }
    return optimistic(
      set,
      () => set({
        notes: get().notes.map((n) => (n.id === id ? updated : n)),
      }),
      () => stickyNoteRepository.update(updated),
      () => set({
        notes: get().notes.map((n) => (n.id === id ? { ...n, title: prevTitle } : n)),
      }),
      'Failed to update sticky note title',
    )
  },

  async updateColor(id: number, color: string | undefined) {
    const note = get().notes.find((n) => n.id === id)
    if (!note) return
    const prevColor = note.color
    const updated = { ...note, color, modifiedAt: new Date() }
    return optimistic(
      set,
      () => set({
        notes: get().notes.map((n) => (n.id === id ? updated : n)),
      }),
      () => stickyNoteRepository.update(updated),
      () => set({
        notes: get().notes.map((n) => (n.id === id ? { ...n, color: prevColor } : n)),
      }),
      'Failed to update sticky note color',
    )
  },

  async remove(id: number) {
    return mutate(set, async () => {
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
    }, 'Failed to delete sticky note')
  },
}))
