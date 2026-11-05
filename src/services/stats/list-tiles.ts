import type { PersistedTodoItem } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'
import { admitsCompleted, type FilterCriteria } from '../../utils/filter-criteria'
import { createPredicateEvaluator, createScreenComposedEvaluator } from '../../utils/filter-match'
import type { WeekStart } from '../../utils/effective-date'
import type { TodoNameLookups } from '../../utils/filter'
import type { MarkerSettings } from '../../utils/markers'
import { matchesMembership } from '../build-list'

/** A list tile's count: the list's members under the screen filter, of all its members. */
export interface ListTileCount {
  id: number
  name: string
  /** Members passing the screen filter too (what a List widget for the list shows). */
  shown: number
  /**
   * Members by the list's own filter alone (the `of N`), completed ones too
   * while the screen filter lets completed tasks through. Equals `shown`
   * without a screen filter.
   */
  total: number
}

export interface ListTileOptions {
  /** The top-bar filter; omitted or inactive = no narrowing. */
  screen?: FilterCriteria
  /** Assignments + status names (tag clauses need `assignedTagsMap` loaded). */
  lookups: TodoNameLookups
  today: Date
  weekStartsOn: WeekStart
  markerSettings: MarkerSettings
}

/**
 * Whether a list can be a tile: lists that ask for a value at render time
 * (a runtime prompt) can't, since a tile has nowhere to ask.
 */
export function isListTileEligible(def: Pick<PersistedListDefinition, 'runtimeFilter'>): boolean {
  return def.runtimeFilter == null
}

/**
 * Counts for the given list tiles, in the given order, as a List widget for
 * the list counts them (`useBuiltList`): `shown` through the list's predicate
 * composed with the screen filter (`createScreenComposedEvaluator` —
 * narrowing clauses AND, completion ORed, so the screen's Show completed or a
 * Completed range brings the list's completed members in), `total` by the
 * list's own clauses under that same completion gate. Lists with a runtime
 * prompt are skipped (see `isListTileEligible`).
 */
export function computeListTileCounts(
  definitions: readonly PersistedListDefinition[],
  todos: readonly PersistedTodoItem[],
  opts: ListTileOptions,
): ListTileCount[] {
  const { screen, lookups, today, weekStartsOn, markerSettings } = opts
  const settings = { ...markerSettings, weekStartsOn }
  const listOnly = createPredicateEvaluator(lookups, today, settings)
  const composed = screen ? createScreenComposedEvaluator(screen, lookups, today, settings) : listOnly
  const screenAdmitsCompleted = screen != null && admitsCompleted(screen)
  const out: ListTileCount[] = []
  for (const def of definitions) {
    if (!isListTileEligible(def)) continue
    const own = def.membership.predicate
    // The list's own clauses under the composed completion gate (as `composeScreenFilter`).
    const base = screenAdmitsCompleted && !own.showCompleted
      ? { ...def.membership, predicate: { ...own, showCompleted: true } }
      : def.membership
    let total = 0
    let shown = 0
    for (const t of todos) {
      // Shown ⊆ total: the composed gate admits completed tasks only where `base` does.
      if (!matchesMembership(base, t, listOnly)) continue
      total++
      if (matchesMembership(def.membership, t, composed)) shown++
    }
    out.push({ id: def.id, name: def.name, shown, total })
  }
  return out
}
