import { create } from 'zustand'
import { noteRepository } from '../data'
import type { PersistedNote } from '../models'

/**
 * Single-row note store. Holds the one global "outside-tasks" note — shown in
 * the dashboard Notes tile, the rail Notes slot, and every canvas
 * `FloatingNote` placement (placements are in `floating-note-store`; they all
 * view *this* content).
 *
 * Content edits debounce through `setContent` → `persistPending`. Task notes
 * bypass the store entirely via `NotesBody`'s optional `source` adapter prop.
 */

const SAVE_DEBOUNCE_MS = 500

interface NoteState {
  notes: Map<number, PersistedNote>
  activeId: number | null
  lastSavedAt: Date | null
  /** Load (and seed if missing) the global note. */
  load: () => Promise<void>
  setContent: (id: number, content: string) => void
  flush: () => Promise<void>
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
    return { notes: map, lastSavedAt: next.modifiedAt }
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
      const map = new Map<number, PersistedNote>()
      map.set(active.id, active)
      for (const g of globals) {
        if (g.id !== active.id) map.set(g.id, g)
      }
      set({ notes: map, activeId: active.id, lastSavedAt: active.modifiedAt })
    } catch (e) {
      console.error('Failed to load notes:', e)
    }
  },

  setContent(id: number, content: string) {
    const existing = get().notes.get(id)
    if (!existing) return
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
}))
