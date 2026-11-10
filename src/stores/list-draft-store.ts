import { create } from 'zustand'
import type { PersistedListDefinition } from '../models/list-definition'
import { defsEqual } from '../utils/list-def-equal'
import { registerModuleReset } from '../utils/module-reset'
import { clearListDrafts, readListDrafts } from '../data/draft-storage'
import { useListDefinitionStore } from './list-definition-store'

/**
 * Edit list's draft: the list as the open Edit list has it, not saved yet —
 * its live preview. Every widget showing the list draws it (`listAsShown`)
 * while Edit list is open, as a widget editor's copy is drawn
 * (`widget-preview-store`); Edit list's Save writes it for good as one undo
 * step (`list-definition-store.editList`) and Discard drops it. In memory
 * only — never kept in the browser, gone on a reload, a data replace
 * (`refresh-all`) or the list's deletion. One list at a time in practice
 * (one Edit list is open), keyed by list id.
 */
interface ListDraftState {
  /** Edited definitions by id. Never equal to the saved definition. */
  drafts: Readonly<Record<number, PersistedListDefinition>>

  /**
   * Applies `fn` to the list's current version (its draft, else the saved
   * definition). An edit that makes it equal to the saved definition drops
   * the draft. Unknown id → no-op.
   */
  edit: (id: number, fn: (def: PersistedListDefinition) => PersistedListDefinition) => void
  /** Drops the draft (none → no-op). */
  discard: (id: number) => void
}

function savedDef(id: number): PersistedListDefinition | undefined {
  return useListDefinitionStore.getState().listDefinitions.find((d) => d.id === id)
}

function without(drafts: Readonly<Record<number, PersistedListDefinition>>, id: number): Record<number, PersistedListDefinition> {
  const next = { ...drafts }
  delete next[id]
  return next
}

export const useListDraftStore = create<ListDraftState>((set, get) => ({
  drafts: {},

  edit(id, fn) {
    const saved = savedDef(id)
    if (!saved) return
    const next = fn(get().drafts[id] ?? saved)
    set({ drafts: defsEqual(next, saved) ? without(get().drafts, id) : { ...get().drafts, [id]: next } })
  },

  discard(id) {
    if (!(id in get().drafts)) return
    set({ drafts: without(get().drafts, id) })
  },
}))

/**
 * The list as it shows: Edit list's draft while one is open on it, else the
 * saved definition — `undefined` for a list that isn't saved (any more).
 * Every reader of a list's definition for display goes through this (or
 * `useEffectiveListDefinition`), so the preview reads the same everywhere.
 */
export function listAsShown(
  saved: PersistedListDefinition | undefined,
  drafts: Readonly<Record<number, PersistedListDefinition | undefined>>,
): PersistedListDefinition | undefined {
  return saved ? (drafts[saved.id] ?? saved) : undefined
}

/** `listAsShown` of list `id`, now. */
export function listAsShownNow(id: number): PersistedListDefinition | undefined {
  return listAsShown(savedDef(id), useListDraftStore.getState().drafts)
}

/** The page load's application of the drafts an older build kept, while it runs (shared by concurrent callers). */
let applyingKept: Promise<void> | null = null
let appliedKept = false
registerModuleReset(() => {
  applyingKept = null
  appliedKept = false
})

/**
 * Once per page load (the workspace calls it when it opens): the unsaved
 * list edits a build before list autosave kept in the browser
 * (`data/draft-storage`). Each is written for good — one undo step with
 * the snackbar, `Applied unsaved changes to list “X”` — while its list is
 * still as it was saved when the edits were made; the rest are dropped.
 * Then the kept drafts are forgotten.
 */
export function applyKeptListDrafts(): Promise<void> {
  if (applyingKept) return applyingKept
  if (appliedKept) return Promise.resolve()
  applyingKept = (async () => {
    const kept = readListDrafts()
    clearListDrafts()
    appliedKept = true
    if (kept.size === 0) return
    await useListDefinitionStore.getState().ensureLoaded()
    for (const [id, { draft, base }] of kept) {
      const saved = savedDef(id)
      if (!saved || !defsEqual(saved, base) || defsEqual(draft, saved)) continue
      await useListDefinitionStore.getState().editList(id, () => draft, `Applied unsaved changes to list “${saved.name}”`)
    }
  })().finally(() => { applyingKept = null })
  return applyingKept
}
