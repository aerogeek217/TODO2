import { create } from 'zustand'
import { noteRepository } from '../data'
import type { PersistedNote } from '../models'

/**
 * Single-note semantics for Phase 3 of the dashboard + canvas master plan.
 * The schema supports multi-note, so the store keys by id from day one;
 * `activeId` points at the currently-edited note (always the first row for
 * the Phase 3 UI — the dashboard NotesPanel auto-seeds one on first load).
 *
 * `setContent` writes optimistically to state, then debounces the repository
 * write by `SAVE_DEBOUNCE_MS`. `modifiedAt` is stamped at save time so rapid
 * typing doesn't churn the timestamp needlessly.
 */

const SAVE_DEBOUNCE_MS = 500

interface NoteState {
  notes: Map<number, PersistedNote>
  activeId: number | null
  lastSavedAt: Date | null
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
      const rows = await noteRepository.getAll()
      let active: PersistedNote | undefined = rows[0]
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
      const sorted = [active, ...rows.filter((r) => r.id !== active!.id)]
      for (const r of sorted) map.set(r.id, r)
      set({ notes: map, activeId: active.id, lastSavedAt: active.modifiedAt })
    } catch (e) {
      console.error('Failed to load notes:', e)
    }
  },

  setContent(id: number, content: string) {
    const existing = get().notes.get(id)
    if (!existing) return
    // Optimistic state write — editor sees its own input reflected immediately.
    const optimistic: PersistedNote = { ...existing, content }
    const map = new Map(get().notes)
    map.set(id, optimistic)
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
