import { create } from 'zustand'
import { noteRepository } from '../data'
import type { PersistedNote } from '../models'
import { undoable } from '../services/undoable'
import { optimistic } from './store-helpers'

/**
 * Multi-row note store. `notes` is keyed by id and mixes two populations:
 *   • The single global note (canvasId == null) — `activeId` points at it;
 *     drives `NotesBody` on the dashboard tile / rail slot.
 *   • Canvas floating notes (canvasId != null) — loaded per-canvas and
 *     rendered as `FloatingNoteNode` on the canvas (sticky-notes merge).
 *
 * Content edits go through `setContent(id, ...)` with a debounced write; the
 * dashboard editor and floating-note editors share this path. Placement /
 * color edits are optimistic with repository-first persistence.
 */

const SAVE_DEBOUNCE_MS = 500
const DEFAULT_WIDTH = 240
const DEFAULT_HEIGHT = 200
const DEFAULT_COLOR = '#FFF3B0'

interface NoteState {
  notes: Map<number, PersistedNote>
  activeId: number | null
  lastSavedAt: Date | null
  /** Load (and seed if missing) the global note. */
  load: () => Promise<void>
  /** Load all floating notes for a canvas into the store. */
  loadByCanvas: (canvasId: number) => Promise<void>
  setContent: (id: number, content: string) => void
  flush: () => Promise<void>
  addFloating: (canvasId: number, x: number, y: number, color?: string) => Promise<number>
  updatePosition: (id: number, x: number, y: number) => Promise<void>
  updateSize: (id: number, width: number, height: number) => Promise<void>
  updateColor: (id: number, color: string | undefined) => Promise<void>
  remove: (id: number) => Promise<void>
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
let pendingSave: { id: number; content: string } | null = null

async function persistPending(): Promise<void> {
  if (!pendingSave) return
  const { id, content } = pendingSave
  pendingSave = null
  const existing = await noteRepository.getById(id)
  if (!existing) return
  const next: PersistedNote = {
    ...existing,
    content,
    modifiedAt: new Date(),
  }
  await noteRepository.update(next)
  useNoteStore.setState((s) => {
    const map = new Map(s.notes)
    map.set(id, next)
    const updates: Partial<NoteState> = { notes: map }
    if (next.canvasId == null) updates.lastSavedAt = next.modifiedAt
    return updates as NoteState
  })
}

export const useNoteStore = create<NoteState>((set, get) => ({
  notes: new Map(),
  activeId: null,
  lastSavedAt: null,

  async load() {
    try {
      const globals = await noteRepository.getGlobal()
      let active: PersistedNote | undefined = globals[0]
      if (!active) {
        const now = new Date()
        const id = await noteRepository.add({
          content: '',
          createdAt: now,
          modifiedAt: now,
        })
        active = { id, content: '', createdAt: now, modifiedAt: now }
      }
      const map = new Map(get().notes)
      // Re-insert with the active note first for stable iteration order.
      map.set(active.id, active)
      for (const g of globals) {
        if (g.id !== active.id) map.set(g.id, g)
      }
      set({ notes: map, activeId: active.id, lastSavedAt: active.modifiedAt })
    } catch (e) {
      console.error('Failed to load notes:', e)
    }
  },

  async loadByCanvas(canvasId: number) {
    try {
      const rows = await noteRepository.getByCanvas(canvasId)
      const map = new Map(get().notes)
      // Drop any previously-loaded notes for this canvas that have since been
      // removed from the db (keeps the map in sync across canvas switches).
      for (const [id, n] of map) {
        if (n.canvasId === canvasId && !rows.some((r) => r.id === id)) {
          map.delete(id)
        }
      }
      for (const r of rows) map.set(r.id, r)
      set({ notes: map })
    } catch (e) {
      console.error('Failed to load canvas notes:', e)
    }
  },

  setContent(id: number, content: string) {
    const existing = get().notes.get(id)
    if (!existing) return
    // Optimistic state write — editor sees its own input reflected immediately.
    const optimisticNote: PersistedNote = { ...existing, content }
    const map = new Map(get().notes)
    map.set(id, optimisticNote)
    set({ notes: map })

    pendingSave = { id, content }
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      void persistPending()
    }, SAVE_DEBOUNCE_MS)
  },

  async flush() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = undefined
    }
    await persistPending()
  },

  async addFloating(canvasId: number, x: number, y: number, color?: string) {
    const now = new Date()
    const id = await noteRepository.add({
      content: '',
      canvasId,
      x,
      y,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      color: color ?? DEFAULT_COLOR,
      createdAt: now,
      modifiedAt: now,
    })
    const note = await noteRepository.getById(id)
    if (note) {
      const map = new Map(get().notes)
      map.set(id, note)
      set({ notes: map })
    }
    return id
  },

  async updatePosition(id: number, x: number, y: number) {
    const prev = get().notes.get(id)
    if (!prev) return
    const prevX = prev.x ?? 0
    const prevY = prev.y ?? 0
    return optimistic(
      set,
      () => {
        const map = new Map(get().notes)
        map.set(id, { ...prev, x, y })
        set({ notes: map })
      },
      () => noteRepository.updatePosition(id, x, y),
      () => {
        const map = new Map(get().notes)
        const cur = map.get(id)
        if (cur) map.set(id, { ...cur, x: prevX, y: prevY })
        set({ notes: map })
      },
      'Failed to update note position',
    )
  },

  async updateSize(id: number, width: number, height: number) {
    const prev = get().notes.get(id)
    if (!prev) return
    const next: PersistedNote = { ...prev, width, height, modifiedAt: new Date() }
    return optimistic(
      set,
      () => {
        const map = new Map(get().notes)
        map.set(id, next)
        set({ notes: map })
      },
      () => noteRepository.update(next),
      () => {
        const map = new Map(get().notes)
        map.set(id, prev)
        set({ notes: map })
      },
      'Failed to update note size',
    )
  },

  async updateColor(id: number, color: string | undefined) {
    const prev = get().notes.get(id)
    if (!prev) return
    const next: PersistedNote = { ...prev, color, modifiedAt: new Date() }
    return optimistic(
      set,
      () => {
        const map = new Map(get().notes)
        map.set(id, next)
        set({ notes: map })
      },
      () => noteRepository.update(next),
      () => {
        const map = new Map(get().notes)
        map.set(id, prev)
        set({ notes: map })
      },
      'Failed to update note color',
    )
  },

  async remove(id: number) {
    const note = get().notes.get(id)
    if (!note) return
    await noteRepository.remove(id)
    const map = new Map(get().notes)
    map.delete(id)
    const nextActive = get().activeId === id ? null : get().activeId
    set({ notes: map, activeId: nextActive })
    // Only floating notes get undo; the global note is auto-reseeded.
    if (note.canvasId != null) {
      undoable(
        'Delete note',
        async () => {
          await noteRepository.remove(id)
          const m = new Map(useNoteStore.getState().notes)
          m.delete(id)
          useNoteStore.setState({ notes: m })
        },
        async () => {
          await noteRepository.add(note)
          const m = new Map(useNoteStore.getState().notes)
          m.set(id, note)
          useNoteStore.setState({ notes: m })
        },
        true,
      )
    }
  },
}))
