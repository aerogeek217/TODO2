import type { TodoPredicate } from './filter-predicate'
import type { TodoSortBy, TodoGroupBy, TodoSortDirection } from './todo-sort-group'

/**
 * Serializable predicate DSL for list membership. Post-v24, the only kind is
 * `custom` — the former `today` / `upcoming` / `deadlines` / `someday` kinds
 * were retired in favor of custom predicates authored via `TodoPredicate`. The `kind` discriminator is kept
 * for forward-compat (future kinds like `saved-search` remain cheap to add).
 */
export type ListMembership =
  | { kind: 'custom'; predicate: TodoPredicate }

/**
 * Persisted sort field: a flat
 * `TodoSortBy` literal — the former discriminated union (`{kind:'sort-order'}`
 * / `{kind:'sortBy', by}` / etc.) was flattened in the v46 Dexie migration.
 */
export type ListSort = TodoSortBy

/**
 * Persisted grouping field: a flat
 * `TodoGroupBy` literal — the former discriminated union (`{kind:'none'}` /
 * `{kind:'by-field', by}` / `{kind:'by-tag'}` / etc.) was flattened in the
 * v46 Dexie migration. The former `{kind:'by-sortBy'}` "match the sort"
 * semantic is gone; surfaces that want sort+group coupled set them to the
 * same value explicitly.
 */
export type ListGrouping = TodoGroupBy

/** Which entity a list's runtime-filter (Prompt for) picker narrows on. */
export type RuntimeFilterField = 'person' | 'status' | 'tag'

/**
 * Optional prompt: the list asks for one or more values of `field` at render
 * time, merged into the predicate as an OR on that field (e.g. "Tasks for
 * {assignee}"). Only the field is part of the definition; the picks are
 * temporary and belong to the surface showing the list.
 */
export interface RuntimeFilterSpec {
  field: RuntimeFilterField
}

/**
 * Who a list belongs to: one layout (whose tabs show it, and whose list
 * choosers offer it — `isListedList`). Every list has one; a list without
 * (older data, or a file edited by hand) is offered nowhere until Settings ›
 * Data integrity's cleanup gives it a layout. A v78 database may also hold
 * the retired Eisenhower's hidden list (`RetiredEisenhowerOwner`).
 */
export type ListOwner = LayoutListOwner | RetiredEisenhowerOwner

/** A list's owner: the layout whose tabs show it. The only owner the app gives a list. */
export type LayoutListOwner = { layoutId: number }

/**
 * The owner of the removed Eisenhower's hidden list, which a database or
 * file from before its removal may still hold. Such a list is carried as
 * stored (export, backup, sync file) but never read into the app: the
 * repository leaves it out (`listDefinitionRepository.getAll`), the audit
 * never gives it a layout. Schema v79 deletes it.
 */
export type RetiredEisenhowerOwner = { eisenhower: true }

export interface ListDefinition {
  id?: number
  name: string
  sortOrder: number
  membership: ListMembership
  sort: ListSort
  /**
   * `desc` reverses the sort (see `TodoSortDirection`). Absent or `asc` =
   * the sort's natural order; ignored for a sort without a direction
   * (Manual — `sortHasDirection`).
   */
  sortDirection?: TodoSortDirection
  grouping: ListGrouping
  /** When set, the list exposes a picker at render time; see `RuntimeFilterSpec`. */
  runtimeFilter?: RuntimeFilterSpec
  /** The layout the list belongs to (see `ListOwner`). */
  owner?: ListOwner
  /** `false` hides the list's filter line; absent = shown (only `false` is stored). */
  showFilterLine?: false
  /** Its tab's badges, when not the app's (Settings › Tasks); absent = the app's. */
  tabBadges?: ListTabBadges
  /**
   * `true`: the top bar's lens doesn't apply to this list (its chips still
   * do); absent = it applies (only `true` is stored). Toggled from the
   * list's filter line or its tab menu and saved at once, never a draft
   * edit: a list's Save keeps the saved list's value (`list-draft-store`).
   */
  ignoreLens?: true
}

/**
 * What a tab badge counts of one kind: `off`, `overdue` (overdue only), or a
 * day count (overdue plus that many days ahead; `0` = overdue and today).
 */
export type TabBadgeRange = 'off' | 'overdue' | number

/** A tab badge's two ranges. */
export interface TabBadgeRanges {
  due: TabBadgeRange
  followup: TabBadgeRange
}

/** A list's own tab badges: `off`, or its own ranges. */
export type ListTabBadges = 'off' | TabBadgeRanges

export type PersistedListDefinition = ListDefinition & { id: number }

/** Whether `owner` is the removed Eisenhower's (`RetiredEisenhowerOwner`). */
export function isRetiredEisenhowerOwner(owner: ListOwner | undefined): owner is RetiredEisenhowerOwner {
  // `typeof`: a stored row another build wrote may hold anything here.
  return typeof owner === 'object' && owner !== null && 'eisenhower' in owner && owner.eisenhower === true
}

/** The layout a list belongs to, or `undefined` (the retired Eisenhower's, or a list with no owner). */
export function ownerLayoutId(def: Pick<ListDefinition, 'owner'>): number | undefined {
  const owner = def.owner
  return typeof owner === 'object' && owner !== null && 'layoutId' in owner ? owner.layoutId : undefined
}

/**
 * Whether a list chooser in layout `layoutId` offers `def`: only a list that
 * layout owns — never another layout's, the retired Eisenhower's, or a list without
 * an owner; no layout (`undefined`) offers none. The one rule every chooser
 * goes through (`listedLists`).
 */
export function isListedList(def: Pick<ListDefinition, 'owner'>, layoutId: number | undefined): boolean {
  return layoutId != null && ownerLayoutId(def) === layoutId
}

/** The lists a chooser offers (`isListedList`), in their given order. */
export function listedLists<T extends Pick<ListDefinition, 'owner'>>(defs: readonly T[], layoutId: number | undefined): T[] {
  return defs.filter((d) => isListedList(d, layoutId))
}
