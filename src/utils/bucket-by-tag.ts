import type { PersistedTodoItem, Tag } from '../models'

/**
 * Untagged-fallback bucket key + label, shared between
 * `ListView.buildTagSections` (ListView grouping) and
 * `dashboard-lists.bucketByTag` (custom-list interpreter). Surfaces are
 * expected to use these constants so the "no tag" group renders identically
 * across views.
 */
export const UNTAGGED_BUCKET_KEY = 'no-tag'
export const UNTAGGED_BUCKET_LABEL = 'No tag'

export interface TagBucket {
  tag: Tag
  todos: PersistedTodoItem[]
}

export interface BucketByTagResult {
  /** Per-tag buckets with at least one todo, sorted alphabetically by tag name. */
  tagged: TagBucket[]
  /** Todos with no tag assignments. Empty when every todo is tagged. */
  untagged: PersistedTodoItem[]
}

/**
 * Bucket todos by their tag assignments. A todo with N tags lands in N
 * buckets (mirrors the people/org many-to-many pattern). Repeated tag
 * entries on a single todo are deduped. Untagged todos go into the trailing
 * `untagged` collection. Buckets sort alphabetically by tag name via
 * `localeCompare`.
 *
 * The caller maps `tagged` / `untagged` to its own section/group shape and
 * picks any extra fields (accent color, label prefix). Both call sites
 * should use {@link UNTAGGED_BUCKET_KEY} / {@link UNTAGGED_BUCKET_LABEL}
 * for the "no tag" bucket so the surfaces stay aligned.
 */
export function bucketByTag(
  todos: readonly PersistedTodoItem[],
  assignedTagsMap: Map<number, Tag[]> | undefined,
): BucketByTagResult {
  const buckets = new Map<number, TagBucket>()
  const untagged: PersistedTodoItem[] = []

  for (const t of todos) {
    const assigned = assignedTagsMap?.get(t.id) ?? []
    if (assigned.length === 0) { untagged.push(t); continue }
    const seen = new Set<number>()
    for (const tg of assigned) {
      const id = tg.id!
      if (seen.has(id)) continue
      seen.add(id)
      let entry = buckets.get(id)
      if (!entry) {
        entry = { tag: tg, todos: [] }
        buckets.set(id, entry)
      }
      entry.todos.push(t)
    }
  }

  const tagged = [...buckets.values()].sort((a, b) =>
    a.tag.name.localeCompare(b.tag.name),
  )
  return { tagged, untagged }
}
