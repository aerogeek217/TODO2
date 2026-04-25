import type { PersistedTodoItem } from '../models'

/** Minimal shape every entity registry shares: an id and a name. */
export interface RegistryEntity {
  id?: number
  name: string
}

export interface ManyBucket<E extends RegistryEntity> {
  entity: E
  todos: PersistedTodoItem[]
}

export interface BucketByManyResult<E extends RegistryEntity> {
  /** Per-entity buckets with at least one todo. Order follows the caller-supplied entity list (or `compare` when set). */
  buckets: ManyBucket<E>[]
  /** Todos with no assignment in `assignedMap` after dedup. */
  unassigned: PersistedTodoItem[]
}

export interface BucketByManyOptions<E extends RegistryEntity> {
  /**
   * Bucket order. When omitted the buckets follow the entity list order. When
   * present it overrides — used for alphabetic tag sorting and similar cases.
   */
  compare?: (a: E, b: E) => number
}

/**
 * Bucket todos by a many-to-many assignment. A todo with N entries in
 * `assignedMap` lands in N buckets (deduped by entity id). Todos with no
 * assignment go into `unassigned`. Generalises the people/org/tag bucketing
 * pattern used by `dashboard-lists` and `task-grouping`.
 *
 * Buckets are emitted in entity-list order (or `compare` order when set);
 * empty buckets are dropped. The caller maps `entity` to its own
 * key/label/accent shape.
 */
export function bucketByMany<E extends RegistryEntity>(
  todos: readonly PersistedTodoItem[],
  entities: readonly E[],
  assignedMap: ReadonlyMap<number, readonly E[]> | undefined,
  options: BucketByManyOptions<E> = {},
): BucketByManyResult<E> {
  const indexById = new Map<number, E>()
  for (const e of entities) {
    if (e.id != null) indexById.set(e.id, e)
  }
  const buckets = new Map<number, PersistedTodoItem[]>()
  const unassigned: PersistedTodoItem[] = []

  for (const t of todos) {
    const assigned = assignedMap?.get(t.id) ?? []
    if (assigned.length === 0) { unassigned.push(t); continue }
    const seen = new Set<number>()
    let hit = false
    for (const e of assigned) {
      if (e.id == null) continue
      if (seen.has(e.id)) continue
      seen.add(e.id)
      // Skip entities that aren't in the registry — they may have been deleted
      // since the assignment was written. Treat as unassigned-equivalent.
      if (!indexById.has(e.id)) continue
      let arr = buckets.get(e.id)
      if (!arr) { arr = []; buckets.set(e.id, arr) }
      arr.push(t)
      hit = true
    }
    if (!hit) unassigned.push(t)
  }

  const ordered = options.compare
    ? [...entities].sort(options.compare)
    : entities
  const out: ManyBucket<E>[] = []
  for (const e of ordered) {
    if (e.id == null) continue
    const arr = buckets.get(e.id)
    if (arr && arr.length > 0) out.push({ entity: e, todos: arr })
  }
  return { buckets: out, unassigned }
}
