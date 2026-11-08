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
import type { FilterCriteria } from '../utils/filter-criteria'
import type { FilterExpr, IdAtomKind } from '../models/filter-expression'
import { normalizeExpression, topLevelIdPicks, topLevelTerms } from '../utils/filter-expression'
import { withExpression } from '../utils/predicate-expression'
import { startOfDay } from '../utils/date'
import { isNegated, withIdFilter, type NegatableClauses } from '../utils/filter-negation'
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
  /**
   * The screen filter `evalPredicate` composes in, if any (the chips with
   * the top bar's lens): its People / Tags "is" picks narrow the groups as
   * the list's own do (`groupRestrictions`).
   */
  screenFilter?: FilterCriteria
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
 * nothing". An expression the same way: the pick takes the place of its
 * top-level `and` terms on the field (`@a`, `@a or @b`, `not @a` — what a
 * chip on it says) and joins as one more term (`and (@a or @b)`); a term
 * mixing fields stays.
 */
export function applyRuntimeFilter(
  predicate: TodoPredicate,
  spec: RuntimeFilterSpec,
  values: readonly number[],
): TodoPredicate {
  if (values.length === 0) return predicate
  if (predicate.expression) {
    const kind: IdAtomKind = spec.field
    const pick: FilterExpr = { kind: 'or', items: values.map((id): FilterExpr => ({ kind, id })) }
    const kept = topLevelTerms(normalizeExpression(predicate.expression)).filter((term) => !isIdTermOn(term, kind))
    return withExpression(predicate, normalizeExpression({ kind: 'and', items: [...kept, pick] }))
  }
  switch (spec.field) {
    case 'person': return withIdFilter(predicate, 'personIds', [...values], false)
    case 'status': return withIdFilter(predicate, 'statusIds', [...values], false)
    case 'tag': return withIdFilter(predicate, 'tags', [...values], false)
  }
}

/** Whether `term` names only `kind` ids, as one chip would: an atom or an `or` of atoms of that kind, or `not` one. */
function isIdTermOn(term: FilterExpr, kind: IdAtomKind): boolean {
  const inner = term.kind === 'not' ? term.item : term
  const atoms = inner.kind === 'or' ? inner.items : [inner]
  return atoms.length > 0 && atoms.every((a) => a.kind === kind)
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
  const predicate = membership.kind === 'custom' ? membership.predicate : undefined
  const sections = buildListSections(
    members,
    {
      groupBy: def.grouping,
      sortBy: def.sort,
      sortDirection: def.sortDirection,
      personRestrictions: groupRestrictions('personIds', predicate, ctx.screenFilter),
      tagRestrictions: groupRestrictions('tags', predicate, ctx.screenFilter),
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

/**
 * The person / tag picks that narrow a list's groups, so a multi-assignee
 * task doesn't emit sections for people nothing picked: the "is" pick of
 * the list's effective predicate (prompt pick merged in), of the screen
 * filter's chips and of its lens — every filter a member passes. An "is
 * not" pick doesn't narrow: its members have none of the picked people /
 * tags, so their groups never show anyway. Of an expression only the
 * top-level `and` terms narrow them, each "is" term a pick of its own
 * (`@a and @b` is two, intersected — cr33 F12): a pick inside an `or` may
 * not be what a member has. The
 * 0 pick (Unassigned / No tags) keeps the trailing section, as in
 * `buildListSections`, which intersects several.
 */
export function groupRestrictions(
  field: 'personIds' | 'tags',
  predicate: (NegatableClauses & { expression?: FilterExpr }) | undefined,
  screen: FilterCriteria | undefined,
): number[][] {
  const out: number[][] = []
  const kind = field === 'personIds' ? 'person' : 'tag'
  for (const c of [predicate, screen, screen?.lens]) {
    if (!c) continue
    // An expression narrows by its top-level "is" terms only (as `topLevelPredicate`, its own clauses aside).
    if (c.expression) {
      out.push(...topLevelIdPicks(c.expression, kind))
      continue
    }
    const ids = c[field]
    if (ids == null || isNegated(c, field)) continue
    const picks = [...ids]
    if (picks.length > 0) out.push(picks)
  }
  return out
}

/** Whether `t` is a member of a list with `membership`. */
export function matchesMembership(m: ListMembership, t: PersistedTodoItem, evalPredicate: PredicateEvaluator): boolean {
  switch (m.kind) {
    case 'custom': return evalPredicate(m.predicate, t)
  }
}
