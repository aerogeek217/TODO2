/**
 * Serializable predicate DSL for list membership.
 * Intentionally small in v21 (only enough to express the four seeds). A later
 * plan will extend this with AND/OR nodes, per-field date filters, etc.
 */
export type ListMembership =
  | { kind: 'today' }
  | { kind: 'upcoming' }
  | { kind: 'deadlines' }
  | { kind: 'someday' }

export type ListSort =
  | { kind: 'effective-date-asc' }
  | { kind: 'deadline-asc' }
  | { kind: 'sort-order' }

export type ListGrouping =
  | { kind: 'none' }
  | { kind: 'relative-effective' }
  | { kind: 'relative-deadline' }

export type SeededListKey = 'today' | 'upcoming' | 'deadlines' | 'someday'

export interface ListDefinition {
  id?: number
  name: string
  sortOrder: number
  membership: ListMembership
  sort: ListSort
  grouping: ListGrouping
  /** Marker so later UI can warn before deletion of a seeded row. NOT enforced. */
  seededKey?: SeededListKey
}

export type PersistedListDefinition = ListDefinition & { id: number }
