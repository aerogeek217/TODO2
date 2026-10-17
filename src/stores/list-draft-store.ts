import { create } from 'zustand'
import type { PersistedListDefinition } from '../models/list-definition'
import { defsEqual } from '../utils/list-def-equal'
import { registerModuleReset } from '../utils/module-reset'
import { readListDrafts, writeListDrafts, type ListDraftRecord } from '../data/draft-storage'
import { useListDefinitionStore } from './list-definition-store'

/**
 * Unsaved edits to list definitions ("drafts"), made from list widgets.
 *
 * A draft belongs to the list definition, not to a widget: every widget
 * showing the list renders the draft and shows it as unsaved, and saving
 * writes the definition for all of them. Drafts are also kept in the
 * browser (`data/draft-storage`, never the database): `restore()` — when the
 * workspace opens — takes back each one whose list is still as it was saved
 * when the draft was made.
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
  /** Writes the draft over the saved definition and drops it. */
  save: (id: number) => Promise<void>
  /** Drops the draft. */
  discard: (id: number) => void
  /**
   * Takes back the drafts kept from before a reload (the workspace calls it
   * when it opens): those whose saved list still matches what they were made
   * against; the rest are forgotten. Drafts on screen win.
   */
  restore: () => Promise<void>
}

function savedDef(id: number): PersistedListDefinition | undefined {
  return useListDefinitionStore.getState().listDefinitions.find((d) => d.id === id)
}

function without(drafts: Readonly<Record<number, PersistedListDefinition>>, id: number): Record<number, PersistedListDefinition> {
  const next = { ...drafts }
  delete next[id]
  return next
}

/** A `restore()` running (shared by concurrent callers); kept drafts aren't written before one ran. */
let restoring: Promise<void> | null = null
let restored = false
registerModuleReset(() => {
  restoring = null
  restored = false
})

/** Keeps the drafts in the browser, each with the saved list it was made against. */
function keep(drafts: Readonly<Record<number, PersistedListDefinition>>): void {
  if (!restored) return
  const records = new Map<number, ListDraftRecord>()
  for (const [key, draft] of Object.entries(drafts)) {
    const base = savedDef(Number(key))
    if (base) records.set(Number(key), { draft, base })
  }
  writeListDrafts(records)
}

export const useListDraftStore = create<ListDraftState>((set, get) => ({
  drafts: {},

  edit(id, fn) {
    const saved = savedDef(id)
    if (!saved) return
    const next = fn(get().drafts[id] ?? saved)
    set({ drafts: defsEqual(next, saved) ? without(get().drafts, id) : { ...get().drafts, [id]: next } })
    keep(get().drafts)
  },

  async save(id) {
    const draft = get().drafts[id]
    const saved = savedDef(id)
    if (!draft) return
    if (!saved) {
      set({ drafts: without(get().drafts, id) })
      keep(get().drafts)
      return
    }
    // The update applies to the store before it persists, so dropping the
    // draft right after never shows the old definition in between.
    const pending = useListDefinitionStore.getState().update({ ...draft, name: draft.name.trim() || saved.name })
    set({ drafts: without(get().drafts, id) })
    keep(get().drafts)
    try {
      await pending
    } catch {
      // The list store logged it and rolled back; keep the edits unsaved.
      set({ drafts: { ...get().drafts, [id]: draft } })
      keep(get().drafts)
    }
  },

  discard(id) {
    if (!(id in get().drafts)) return
    set({ drafts: without(get().drafts, id) })
    keep(get().drafts)
  },

  restore() {
    restoring ??= (async () => {
      const kept = readListDrafts()
      if (kept.size > 0) await useListDefinitionStore.getState().ensureLoaded()
      const back: Record<number, PersistedListDefinition> = {}
      for (const [id, { draft, base }] of kept) {
        const saved = savedDef(id)
        if (saved && defsEqual(saved, base) && !defsEqual(draft, saved)) back[id] = draft
      }
      restored = true
      set({ drafts: { ...back, ...get().drafts } })
      keep(get().drafts)
    })().finally(() => { restoring = null })
    return restoring
  },
}))

/** The ids of lists with unsaved edits whose definition still exists. */
export function draftListIds(
  drafts: Readonly<Record<number, PersistedListDefinition>>,
  defs: readonly PersistedListDefinition[],
): number[] {
  const live = new Set(defs.map((d) => d.id))
  return Object.keys(drafts).map(Number).filter((id) => live.has(id))
}

/** Ids of the lists with unsaved edits, now. */
export function getUnsavedListIds(): number[] {
  return draftListIds(useListDraftStore.getState().drafts, useListDefinitionStore.getState().listDefinitions)
}
