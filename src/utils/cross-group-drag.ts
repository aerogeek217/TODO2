import type { TodoGroupBy } from '../models'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'

/**
 * Sentinel group key for the synthetic ungrouped bucket (tasks with no
 * value on the grouped field), so callers and `resolveCrossGroupMutation`
 * agree on a single string.
 */
export const UNGROUPED_GROUP_KEY = '__ungrouped'

/**
 * Field-level mutation implied by dragging a row from one visual group
 * to another in a grouped list widget (`ListWidget` dispatches it once a
 * cross-group hop is detected; any manual-order rank is written separately).
 *
 * - `status` carries the new statusId, or `undefined` when the target is
 *   the synthetic ungrouped bucket (i.e. clear the status).
 * - `people` / `tag` carry **replace** semantics: remove the
 *   source assignment if any (`removeId`), add the target assignment if
 *   any (`addId`). Either side may be `null` to cover drags from the
 *   "(no people)" / "(no tag)" synthetic bucket or drags into it.
 */
export type CrossGroupMutation =
  | { kind: 'status'; todoId: number; statusId: number | undefined }
  | { kind: 'people'; todoId: number; removeId: number | null; addId: number | null }
  | { kind: 'tag'; todoId: number; removeId: number | null; addId: number | null }

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

/**
 * Apply the field-mutation implied by a cross-group drag. Stateless: reads
 * each store's imperative `getState()` API directly so it can be called from
 * anywhere (including outside React) without threading store deps through the
 * caller. Sister to {@link resolveCrossGroupMutation} which derives the
 * mutation and this which dispatches it.
 */
export async function dispatchCrossGroupMutation(mutation: CrossGroupMutation): Promise<void> {
  switch (mutation.kind) {
    case 'status': {
      await useTodoStore.getState().bulkSetStatus([mutation.todoId], mutation.statusId)
      return
    }
    case 'people': {
      if (mutation.removeId != null) {
        await usePersonStore.getState().unassignPerson(mutation.todoId, mutation.removeId)
      }
      if (mutation.addId != null) {
        await usePersonStore.getState().assignPerson(mutation.todoId, mutation.addId)
      }
      return
    }
    case 'tag': {
      if (mutation.removeId != null) {
        await useTagStore.getState().unassignTag(mutation.todoId, mutation.removeId)
      }
      if (mutation.addId != null) {
        await useTagStore.getState().assignTag(mutation.todoId, mutation.addId)
      }
      return
    }
  }
}
