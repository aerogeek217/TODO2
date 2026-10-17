import type {
  PersistedTodoItem,
  TodoPredicate,
  Person,
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
import { buildListSections, listSortComparator, type Section } from './list-sections'
import type { ListRanks } from '../utils/list-order'
import type { UrgentDueWithinDays } from '../utils/urgency'

/** Whether a task passes a predicate (closes over assignment maps, statuses, the screen filter). */
export type PredicateEvaluator = (predicate: TodoPredicate, todo: PersistedTodoItem) => boolean

export interface ListBuildContext {
  today: Date
  /** Settings-driven week boundary used by every relative-date bucketer. */
  weekStartsOn: WeekStart
  /** Decides membership: the list's predicate (prompt picks merged in) against each task. */
  evalPredicate: PredicateEvaluator
  /** For tag grouping. Missing → every task lands in "No Tag". */
  assignedTagsMap?: Map<number, Tag[]>
  /** For people grouping. Missing → "Unassigned". */
  assignedPeopleMap?: Map<number, Person[]>
  /** Registries used to label and order categorical sections. */
  people?: Person[]
  statuses?: Status[]
  /**
   * The list's prompt pick. Undefined on a list with a prompt → no members
   * + `runtimeFilterUnset: true` (the surface asks "Pick a {label}…"). An
   * empty array narrows nothing (the user cleared every chip).
   */
  runtimeFilterValue?: readonly number[]
  /**
   * The list's manual order (`listOrders`). Given → a manual list sorts by
   * these ranks (none yet → oldest first); omitted → by `sortOrder`.
   */
  ranks?: ListRanks
  /** The app's urgent range, for the Priority sort; absent = flags only. */
  urgentRange?: UrgentDueWithinDays
}

/** A list definition run over the tasks: its members and sections. */
export interface ListContents {
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
  values: readonly number[],
): TodoPredicate {
  if (values.length === 0) return predicate
  switch (spec.field) {
    case 'person': return { ...predicate, personIds: [...values] }
    case 'status': return { ...predicate, statusIds: [...values] }
    case 'tag': return { ...predicate, tags: [...values] }
  }
}

/**
 * Runs one list definition over `todos`: its members (membership through
 * `ctx.evalPredicate`, prompt pick merged in), sorted, and its sections.
 */
export function buildList(
  def: PersistedListDefinition,
  todos: readonly PersistedTodoItem[],
  ctx: ListBuildContext,
): ListContents {
  let membership = def.membership
  let runtimeFilterUnset: true | undefined
  if (def.runtimeFilter) {
    const pick = ctx.runtimeFilterValue
    if (pick == null) {
      runtimeFilterUnset = true
    } else if (membership.kind === 'custom') {
      membership = { kind: 'custom', predicate: applyRuntimeFilter(membership.predicate, def.runtimeFilter, pick) }
    }
  }
  const members = runtimeFilterUnset
    ? []
    : todos.filter((t) => matchesMembership(membership, t, ctx.evalPredicate))
  // The effective predicate's person / tag picks narrow the visible groups
  // so a multi-assignee task doesn't emit sections for non-picked people.
  const predicate = membership.kind === 'custom' ? membership.predicate : undefined
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
      assignedPeopleMap: ctx.assignedPeopleMap ?? new Map(),
      assignedTagsMap: ctx.assignedTagsMap ?? new Map(),
      manualRanks: ctx.ranks,
      urgentRange: ctx.urgentRange,
    },
  )
  const sorted = [...members].sort(listSortComparator(def.sort, {
    manualRanks: ctx.ranks,
    today: startOfDay(ctx.today),
    urgentRange: ctx.urgentRange,
  }))
  return {
    id: def.id,
    key: `def-${def.id}`,
    label: def.name,
    todos: sorted,
    sections,
    ...(runtimeFilterUnset ? { runtimeFilterUnset } : {}),
  }
}

/** Whether `t` is a member of a list with `membership`. */
export function matchesMembership(m: ListMembership, t: PersistedTodoItem, evalPredicate: PredicateEvaluator): boolean {
  switch (m.kind) {
    case 'custom': return evalPredicate(m.predicate, t)
  }
}
