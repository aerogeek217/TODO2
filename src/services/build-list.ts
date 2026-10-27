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
import { isNegated, withIdFilter } from '../utils/filter-negation'
import { buildListSections, listSortComparator, type Section } from './list-sections'
import type { ListRanks } from '../utils/list-order'
import type { UrgentDueWithinDays } from '../utils/urgency'
import type { HotRule } from '../utils/hot'

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
  /** The app's urgent range, for the Priority sort and groups; absent = flags only. */
  urgentRange?: UrgentDueWithinDays
  /** The Hot rule, for the Priority groups; absent = the default rule. */
  hotRule?: HotRule
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
 * Narrow `field` to `values` (OR-combined): the prompt pick takes the place
 * of the list's own clause on that field, and is always "is" (a list's "is
 * not" switch on the field goes with the clause it switched). Empty `values`
 * is a no-op so "user cleared all chips" doesn't short-circuit to "match
 * nothing". The pick merges into the clauses outside the or groups, which
 * stay as they are.
 */
export function applyRuntimeFilter(
  predicate: TodoPredicate,
  spec: RuntimeFilterSpec,
  values: readonly number[],
): TodoPredicate {
  if (values.length === 0) return predicate
  switch (spec.field) {
    case 'person': return withIdFilter(predicate, 'personIds', [...values], false)
    case 'status': return withIdFilter(predicate, 'statusIds', [...values], false)
    case 'tag': return withIdFilter(predicate, 'tags', [...values], false)
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
  // An "is not" pick doesn't: its members have none of the picked people /
  // tags, so their groups never show anyway. Only the clauses outside the
  // or groups narrow them: an or group's pick may not be what a member has.
  const predicate = membership.kind === 'custom' ? membership.predicate : undefined
  const sections = buildListSections(
    members,
    {
      groupBy: def.grouping,
      sortBy: def.sort,
      sortDirection: def.sortDirection,
      restrictToPersonIds: predicate && !isNegated(predicate, 'personIds') ? predicate.personIds : null,
      restrictToTagIds: predicate && !isNegated(predicate, 'tags') ? predicate.tags : null,
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
      hotRule: ctx.hotRule,
    },
  )
  const sorted = [...members].sort(listSortComparator(def.sort, {
    manualRanks: ctx.ranks,
    today: startOfDay(ctx.today),
    urgentRange: ctx.urgentRange,
    direction: def.sortDirection,
    assignedPeopleMap: ctx.assignedPeopleMap,
    statuses: ctx.statuses,
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
