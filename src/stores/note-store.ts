import { create } from 'zustand'
import { noteRepository } from '../data'
import type { PersistedNote } from '../models'
import { reportLoadFailure } from './store-helpers'
import { useUndoStore } from './undo-store'

/**
 * Single-row note store. Holds the one global "outside-tasks" note — shown in
 * every notes widget.
 *
 * Content edits debounce through `setContent` → a save. Saves run one at a
 * time and each writes the latest text; the text stays pending until a save
 * of it (or of newer text) succeeds, so a failed save is retried with the
 * next change (or `flush`). Task notes bypass the store entirely via
 * `NotesBody`'s optional `source` adapter prop.
 */

export const SAVE_DEBOUNCE_MS = 500

/** Text typed but not saved yet. `seq` orders edits: a higher one is newer. */
interface PendingSave {
  id: number
  content: string
  seq: number
}

interface NoteState {
  notes: Map<number, PersistedNote>
  activeId: number | null
  lastSavedAt: Date | null
  /** The latest edit not saved yet (kept after a failed save). */
  pending: PendingSave | null
  /** The last save failed; the text is kept and saved with the next change. */
  saveFailed: boolean
  /** The load in flight: concurrent `load()` calls share it. */
  loadInFlight: Promise<void> | null
  /** Load (and seed if missing) the global note. */
  load: () => Promise<void>
  setContent: (id: number, content: string) => void
  /** Saves pending text now. Never rejects; a failure keeps the text pending. */
  flush: () => Promise<void>
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
let editSeq = 0
/** The save in progress, if any; the next save starts after it. */
let saveQueue: Promise<void> = Promise.resolve()

/** Saves the pending text, if any. Never rejects. */
async function saveOnce(): Promise<void> {
  const snap = useNoteStore.getState().pending
  if (!snap) return
  const savedAt = new Date()
  try {
    const exists = await noteRepository.saveContent(snap.id, snap.content, savedAt)
    useNoteStore.setState((s) => {
      // Newer text typed during the save stays pending for the next save.
      const pending = s.pending?.seq === snap.seq ? null : s.pending
      const note = s.notes.get(snap.id)
      if (!exists || !note) return { pending, saveFailed: false }
      // The store's text may already be newer than what was saved: keep it.
      const notes = new Map(s.notes)
      notes.set(snap.id, { ...note, modifiedAt: savedAt })
      return { pending, notes, lastSavedAt: savedAt, saveFailed: false }
    })
  } catch (e) {
    console.error('Failed to save notes:', e)
    if (!useNoteStore.getState().saveFailed) {
      useUndoStore.getState().notify("Couldn't save your notes. They'll be saved with your next change.")
    }
    useNoteStore.setState({ saveFailed: true })
  }
}

/** Queues a save after the one in progress. */
function persistPending(): Promise<void> {
  saveQueue = saveQueue.then(saveOnce)
  return saveQueue
}

export const useNoteStore = create<NoteState>((set, get) => ({
  notes: new Map(),
  activeId: null,
  lastSavedAt: null,
  pending: null,
  saveFailed: false,
  loadInFlight: null,

  load() {
    const inFlight = get().loadInFlight
    if (inFlight) return inFlight
    // Started a tick later, so `promise` is set before the `finally` reads it.
    const promise: Promise<void> = Promise.resolve().then(async () => {
      try {
        const globals = await noteRepository.getOrSeedGlobal()
        const active = globals[0]
        if (!active) return
        const map = new Map<number, PersistedNote>()
        for (const g of globals) map.set(g.id, g)
        // Text typed but not saved yet stays what the editor shows (its
        // save is still coming).
        const pending = get().pending
        const unsaved = pending ? map.get(pending.id) : undefined
        if (pending && unsaved) map.set(pending.id, { ...unsaved, content: pending.content })
        set({ notes: map, activeId: active.id, lastSavedAt: active.modifiedAt })
      } catch (e) {
        reportLoadFailure('notes', e)
      } finally {
        if (get().loadInFlight === promise) set({ loadInFlight: null })
      }
    })
    set({ loadInFlight: promise })
    return promise
  },

  setContent(id: number, content: string) {
    const existing = get().notes.get(id)
    if (!existing) return
    const map = new Map(get().notes)
    map.set(id, { ...existing, content })
    set({ notes: map, pending: { id, content, seq: ++editSeq } })

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
