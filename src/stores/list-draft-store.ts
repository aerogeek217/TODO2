import { useMemo } from 'react'
import { create } from 'zustand'
import type { PersistedListDefinition } from '../models/list-definition'
import { defsEqual } from '../utils/list-def-equal'
import { useListDefinitionStore } from './list-definition-store'

/**
 * Unsaved edits to list definitions ("drafts"), made from list widgets.
 *
 * A draft belongs to the list definition, not to a widget: every widget
 * showing the list renders the draft and shows it as unsaved, and saving
 * writes the definition for all of them. Drafts live in memory only — a
 * reload drops them (the workspace asks before the page unloads).
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

  async save(id) {
    const draft = get().drafts[id]
    const saved = savedDef(id)
    if (!draft) return
    if (!saved) {
      set({ drafts: without(get().drafts, id) })
      return
    }
    // The update applies to the store before it persists, so dropping the
    // draft right after never shows the old definition in between.
    const pending = useListDefinitionStore.getState().update({ ...draft, name: draft.name.trim() || saved.name })
    set({ drafts: without(get().drafts, id) })
    try {
      await pending
    } catch {
      // The list store logged it and rolled back; keep the edits unsaved.
      set({ drafts: { ...get().drafts, [id]: draft } })
    }
  },

  discard(id) {
    if (!(id in get().drafts)) return
    set({ drafts: without(get().drafts, id) })
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

/** The list as shown: its unsaved draft, else the saved definition. */
export function useEffectiveListDefinition(id: number | undefined): PersistedListDefinition | undefined {
  const saved = useListDefinitionStore((s) => (id != null ? s.listDefinitions.find((d) => d.id === id) : undefined))
  const draft = useListDraftStore((s) => (id != null ? s.drafts[id] : undefined))
  return saved ? (draft ?? saved) : undefined
}

/** Whether the list has unsaved edits. */
export function useIsListDirty(id: number | undefined): boolean {
  const hasSaved = useListDefinitionStore((s) => id != null && s.listDefinitions.some((d) => d.id === id))
  const hasDraft = useListDraftStore((s) => id != null && s.drafts[id] != null)
  return hasSaved && hasDraft
}

/** Ids of the lists with unsaved edits, now. */
export function getUnsavedListIds(): number[] {
  return draftListIds(useListDraftStore.getState().drafts, useListDefinitionStore.getState().listDefinitions)
}

/** Ids of the lists with unsaved edits, kept current. */
export function useUnsavedListIds(): number[] {
  const drafts = useListDraftStore((s) => s.drafts)
  const defs = useListDefinitionStore((s) => s.listDefinitions)
  return useMemo(() => draftListIds(drafts, defs), [drafts, defs])
}
