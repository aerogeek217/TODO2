import type {
  PersistedTodoItem,
  TodoPredicate,
  Person,
  Project,
  Status,
  Tag,
} from '../models'
import type {
  ListMembership,
  PersistedListDefinition,
  RuntimeFilterSpec,
} from '../models/list-definition'
import type { WeekStart } from '../utils/effective-date'
import { startOfDay } from '../utils/date'
import { bySortOrder } from '../utils/sort-order'
import { buildListSections, listSortComparator, type Section } from './list-sections'

export interface DashboardListsContext {
  today: Date
  /** Settings-driven week boundary used by every relative-date bucketer. */
  weekStartsOn: WeekStart
  /**
   * Evaluator for `{kind:'custom', predicate}` membership; closes over
   * assignment maps + statuses. Omitted → custom def matches no todos
   * with a once-per-build warning.
   */
  evalPredicate?: (predicate: TodoPredicate, todo: PersistedTodoItem) => boolean
  /** For tag grouping. Missing → every task lands in "No Tag". */
  assignedTagsMap?: Map<number, Tag[]>
  /** For people grouping. Missing → "Unassigned". */
  assignedPeopleMap?: Map<number, Person[]>
  /** Registries used to label and order categorical sections. */
  people?: Person[]
  projects?: Project[]
  statuses?: Status[]
  /**
   * Per-definition runtime-filter picks keyed by def id. Missing key → list
   * returns `todos: []` + `runtimeFilterUnset: true` (surface renders a
   * "Pick a {label}…" placeholder). Empty array → no-op (predicate passes
   * through unchanged) — matches "user cleared all chips" UX.
   */
  runtimeFilterValues?: ReadonlyMap<number, number[]>
}

export interface DashboardList {
  id: number
  key: string
  label: string
  /** Every member once, in the list's sort order. */
  todos: PersistedTodoItem[]
  /**
   * The list's sections from the shared builder (`buildListSections`): one
   * `all` section when ungrouped, none when the list is empty or its runtime
   * prompt is unanswered.
   */
  sections: Section[]
  /** True when the def declares a `runtimeFilter` but the caller has no pick yet. */
  runtimeFilterUnset?: true
}

/**
 * Narrow `field` to `values` (OR-combined). Empty `values` is a no-op so
 * "user cleared all chips" doesn't short-circuit to "match nothing".
 */
export function applyRuntimeFilter(
  predicate: TodoPredicate,
  spec: RuntimeFilterSpec,
  values: number[],
): TodoPredicate {
  if (values.length === 0) return predicate
  switch (spec.field) {
    case 'person': return { ...predicate, personIds: values }
    case 'project': return { ...predicate, projectIds: values }
    case 'status': return { ...predicate, statusIds: values }
    case 'tag': return { ...predicate, tags: values }
  }
}

export function buildDashboardLists(
  definitions: PersistedListDefinition[],
  todos: PersistedTodoItem[],
  ctx: DashboardListsContext,
): DashboardList[] {
  const ordered = [...definitions].sort(bySortOrder)
  const result: DashboardList[] = []
  for (const def of ordered) {
    let effectiveDef = def
    let runtimeFilterUnset: true | undefined
    if (def.runtimeFilter) {
      const pick = ctx.runtimeFilterValues?.get(def.id)
      if (pick == null) {
        runtimeFilterUnset = true
      } else if (def.membership.kind === 'custom') {
        effectiveDef = {
          ...def,
          membership: {
            kind: 'custom',
            predicate: applyRuntimeFilter(def.membership.predicate, def.runtimeFilter, pick),
          },
        }
      }
    }
    const members = runtimeFilterUnset
      ? []
      : todos.filter((t) => interpretMembership(effectiveDef.membership, t, ctx))
    // The effective predicate's person / tag picks narrow the visible groups
    // so a multi-assignee task doesn't emit sections for non-picked people.
    const predicate = effectiveDef.membership.kind === 'custom' ? effectiveDef.membership.predicate : undefined
    const sections = buildListSections(
      members,
      {
        groupBy: def.grouping,
        sortBy: def.sort,
        restrictToPersonIds: predicate?.personIds,
        restrictToTagIds: predicate?.tags,
      },
      {
        today: startOfDay(ctx.today),
        weekStartsOn: ctx.weekStartsOn,
        people: ctx.people ?? [],
        statuses: ctx.statuses ?? [],
        projects: ctx.projects ?? [],
        assignedPeopleMap: ctx.assignedPeopleMap ?? new Map(),
        assignedTagsMap: ctx.assignedTagsMap ?? new Map(),
      },
    )
    const sorted = [...members].sort(listSortComparator(def.sort))
    result.push({
      id: def.id,
      key: `def-${def.id}`,
      label: def.name,
      todos: sorted,
      sections,
      ...(runtimeFilterUnset ? { runtimeFilterUnset } : {}),
    })
  }
  return result
}

let warnedMissingEvaluator = false
export function interpretMembership(m: ListMembership, t: PersistedTodoItem, ctx: DashboardListsContext): boolean {
  if (!ctx.evalPredicate) {
    if (!warnedMissingEvaluator) {
      warnedMissingEvaluator = true
      console.warn('dashboard-lists: custom-membership list found but ctx.evalPredicate was not supplied; matching zero todos.')
    }
    return false
  }
  return ctx.evalPredicate(m.predicate, t)
}
