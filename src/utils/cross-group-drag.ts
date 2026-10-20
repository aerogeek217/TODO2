import type { TodoGroupBy } from '../models'
import type { PriorityFlags } from './priority-groups'

/**
 * Sentinel group key for the synthetic ungrouped bucket (tasks with no
 * value on the grouped field), so callers and `resolveCrossGroupMutation`
 * agree on a single string.
 */
export const UNGROUPED_GROUP_KEY = '__ungrouped'

/**
 * Field-level mutation implied by dragging a row from one visual group
 * to another in a grouped list widget (`ListWidget` applies it with
 * `services/cross-group-mutation` once a cross-group hop is detected; any
 * manual-order rank is written separately).
 *
 * - `status` carries the new statusId, or `undefined` when the target is
 *   the synthetic ungrouped bucket (i.e. clear the status).
 * - `people` / `tag` carry **replace** semantics: remove the
 *   source assignment if any (`removeId`), add the target assignment if
 *   any (`addId`). Either side may be `null` to cover drags from the
 *   "(no people)" / "(no tag)" synthetic bucket or drags into it.
 * - `priority` carries the marker flags to write and the undo step's words
 *   (`utils/priority-groups.resolvePriorityDrop`, which also refuses drops).
 */
export type CrossGroupMutation =
  | { kind: 'status'; todoId: number; statusId: number | undefined }
  | { kind: 'people'; todoId: number; removeId: number | null; addId: number | null }
  | { kind: 'tag'; todoId: number; removeId: number | null; addId: number | null }
  | { kind: 'priority'; todoId: number; flags: PriorityFlags; description: string }

const PREFIX_BY_GROUP = {
  status: 'status-',
  people: 'person-',
  tag: 'tag-',
} as const

function parseId(key: string, prefix: string): number | null {
  if (!key.startsWith(prefix)) return null
  const n = Number(key.slice(prefix.length))
  return Number.isFinite(n) ? n : null
}

/**
 * Resolve the field-mutation a cross-group drag implies, or `null` when
 * none should fire. The drag's reorder/placement is handled separately
 * by the caller — this helper only owns the grouped-field semantics.
 *
 * Returns `null` when:
 *   - Either bucket key is missing — the target group can't be resolved.
 *   - Source and target are the same group — pure reorder, no field
 *     change.
 *   - `groupBy` is a date dimension (`deadline` / `followup`).
 *     Date buckets are derived, not assigned; the date itself is never
 *     rewritten.
 *   - `groupBy` is `priority`: its drops read the task and can be refused
 *     (`utils/priority-groups.resolvePriorityDrop`).
 *   - The bucket key doesn't parse against its expected prefix
 *     (defensive — protects against id-shape mismatches between caller
 *     and `task-grouping`).
 *   - Both sides resolve to "no id" under a many-to-many dimension
 *     (ungrouped → ungrouped — already caught by the same-key check
 *     unless one side is `null`/missing).
 */
export function resolveCrossGroupMutation(
  groupBy: TodoGroupBy,
  sourceKey: string | null | undefined,
  targetKey: string | null | undefined,
  todoId: number,
): CrossGroupMutation | null {
  if (sourceKey == null || targetKey == null) return null
  if (sourceKey === targetKey) return null
  if (groupBy === 'deadline' || groupBy === 'followup') return null

  if (groupBy === 'status') {
    if (targetKey === UNGROUPED_GROUP_KEY) {
      return { kind: 'status', todoId, statusId: undefined }
    }
    const sid = parseId(targetKey, PREFIX_BY_GROUP.status)
    if (sid == null) return null
    return { kind: 'status', todoId, statusId: sid }
  }

  if (groupBy === 'people' || groupBy === 'tag') {
    const prefix = PREFIX_BY_GROUP[groupBy]
    const removeId = sourceKey === UNGROUPED_GROUP_KEY ? null : parseId(sourceKey, prefix)
    const addId = targetKey === UNGROUPED_GROUP_KEY ? null : parseId(targetKey, prefix)
    if (removeId == null && addId == null) return null
    return { kind: groupBy, todoId, removeId, addId }
  }

  return null
}
