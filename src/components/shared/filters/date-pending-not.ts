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
 * The memory of the filter a date panel edits: a filter's chips provide one
 * (`PredicateChips`, which outlive the popover); none = kept while open only.
 */
export const DatePendingNotContext = createContext<PendingNotMemory | null>(null)

/** The top bar's and the phone sheet's: one screen filter. */
export const screenPendingNot = createPendingNotMemory()
registerModuleReset(() => screenPendingNot.set({}))
