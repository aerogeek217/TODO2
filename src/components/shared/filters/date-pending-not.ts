import { createContext } from 'react'
import type { DateField } from '../../../models/app-view'
import { registerModuleReset } from '../../../utils/module-reset'

/** Per date type, an Is not chosen before the range has an end: no clause can hold it yet. */
export type PendingNot = Partial<Record<DateField, true>>

/** Keeps a date panel's pending Is not across the panel closing and opening again. */
export interface PendingNotMemory {
  get: () => PendingNot
  set: (pending: PendingNot) => void
}

export function createPendingNotMemory(): PendingNotMemory {
  let pending: PendingNot = {}
  return {
    get: () => pending,
    set: (next) => { pending = next },
  }
}

/**
 * One memory per place a filter's chips edit — the predicate's own clauses
 * (`null`) and each or group (its index) — so an Is not pending on the
 * predicate's own Due never opens a group's Due panel on Is not.
 */
export interface ScopedPendingNot {
  of: (scope: number | null) => PendingNotMemory
  /** Forgets the groups' (their indexes moved: a group went). */
  clearGroups: () => void
}

export function createScopedPendingNot(): ScopedPendingNot {
  const memories = new Map<string, PendingNotMemory>()
  return {
    of: (scope) => {
      const key = scope == null ? 'own' : `group:${scope}`
      let memory = memories.get(key)
      if (!memory) {
        memory = createPendingNotMemory()
        memories.set(key, memory)
      }
      return memory
    },
    clearGroups: () => {
      for (const key of [...memories.keys()]) if (key !== 'own') memories.delete(key)
    },
  }
}

/**
 * The memory of the filter a date panel edits: a filter's chips provide one
 * (`PredicateChips`, which outlive the popover); none = kept while open only.
 */
export const DatePendingNotContext = createContext<PendingNotMemory | null>(null)

/** The top bar's and the phone sheet's: one screen filter. */
export const screenPendingNot = createPendingNotMemory()
registerModuleReset(() => screenPendingNot.set({}))
