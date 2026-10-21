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
  /** Optional override for the picker label; defaults to the capitalised field. */
  label?: string
}

/**
 * Who a list belongs to: one layout (whose tabs and dashboard tiles show
 * it, and whose list choosers offer it — `isListedList`), or the Eisenhower
 * (the list of tasks it sorts into its panes, offered by no chooser). Every
 * list has one; a list without (older data, or a file edited by hand) is
 * offered nowhere until Settings › Data integrity's cleanup gives it a
 * layout.
 */
export type ListOwner = { layoutId: number } | { eisenhower: true }

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
  /** The layout the list belongs to, or the Eisenhower (see `ListOwner`). */
  owner?: ListOwner
  /** `false` hides the list's filter line; absent = shown (only `false` is stored). */
  showFilterLine?: false
}

export type PersistedListDefinition = ListDefinition & { id: number }

/** The name the Eisenhower's own list gets when it is made. */
export const EISENHOWER_LIST_NAME = 'Eisenhower'

/** Whether `owner` is the Eisenhower's. */
export function isEisenhowerOwner(owner: ListOwner | undefined): owner is { eisenhower: true } {
  // `typeof`: a stored row another build wrote may hold anything here.
  return typeof owner === 'object' && owner !== null && 'eisenhower' in owner && owner.eisenhower === true
}

/** The layout a list belongs to, or `undefined` (the Eisenhower's, or a list with no owner). */
export function ownerLayoutId(def: Pick<ListDefinition, 'owner'>): number | undefined {
  const owner = def.owner
  return typeof owner === 'object' && owner !== null && 'layoutId' in owner ? owner.layoutId : undefined
}

/**
 * Whether a list chooser in layout `layoutId` offers `def`: only a list that
 * layout owns — never the Eisenhower's, another layout's, or a list without
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

/**
 * The Eisenhower's own list among `defs`: the one `sourceId` names when it
 * is owned by the Eisenhower, else the Eisenhower-owned list with the
 * lowest id; `undefined` when there is none.
 */
export function findEisenhowerList<T extends Pick<PersistedListDefinition, 'id' | 'owner'>>(
  defs: readonly T[],
  sourceId: number | null | undefined,
): T | undefined {
  const named = sourceId != null ? defs.find((d) => d.id === sourceId) : undefined
  if (named && isEisenhowerOwner(named.owner)) return named
  let best: T | undefined
  for (const d of defs) if (isEisenhowerOwner(d.owner) && (best === undefined || d.id < best.id)) best = d
  return best
}
