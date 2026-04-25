import type { ProjectGroupBy } from '../models'

/**
 * Sentinel block key used by `SortableTaskList` for the synthetic
 * ungrouped block (the headerless rows above the named groups). Exported
 * so `resolveCrossGroupMutation` and the SortableContext mounting code
 * agree on a single string.
 */
export const UNGROUPED_GROUP_KEY = '__ungrouped'

/**
 * Build the dnd-kit SortableContext id for a grouped block inside a
 * project. The block key alone (e.g. `status-1`, `person-2`,
 * `__ungrouped`) is project-scoped — two ProjectNodes on the same canvas
 * could otherwise emit colliding SortableContext ids. Prefixing with the
 * project id keeps each project's group containers globally unique.
 */
export function blockContextId(projectId: number, blockKey: string): string {
  return `p${projectId}:${blockKey}`
}

/**
 * Inverse of {@link blockContextId}. Returns `null` when the id wasn't
 * emitted by `blockContextId` (e.g. the auto-generated id of the flat
 * non-grouped SortableContext, or any other dnd-kit id from a different
 * surface).
 */
export function parseBlockContextId(
  id: string | number | null | undefined,
): { projectId: number; blockKey: string } | null {
  if (typeof id !== 'string') return null
  if (!id.startsWith('p')) return null
  const colon = id.indexOf(':')
  if (colon <= 1) return null
  const projectId = Number(id.slice(1, colon))
  if (!Number.isFinite(projectId)) return null
  return { projectId, blockKey: id.slice(colon + 1) }
}

/**
 * Field-level mutation implied by dragging a row from one visual group
 * to another inside the SAME project. The drag's sortOrder/projectId
 * placement is resolved separately by `drop-resolver` + `task-placement`;
 * this mutation is dispatched in addition, by `useCanvasDnD.handleDragEnd`,
 * once a cross-group hop is detected.
 *
 * - `status` carries the new statusId, or `undefined` when the target is
 *   the synthetic ungrouped bucket (i.e. clear the status).
 * - `people` / `org` / `tag` carry **replace** semantics: remove the
 *   source assignment if any (`removeId`), add the target assignment if
 *   any (`addId`). Either side may be `null` to cover drags from the
 *   "(no people)" / "(no org)" / "(no tag)" synthetic bucket or drags
 *   into it.
 */
export type CrossGroupMutation =
  | { kind: 'status'; todoId: number; statusId: number | undefined }
  | { kind: 'people'; todoId: number; removeId: number | null; addId: number | null }
  | { kind: 'org'; todoId: number; removeId: number | null; addId: number | null }
  | { kind: 'tag'; todoId: number; removeId: number | null; addId: number | null }

const PREFIX_BY_GROUP = {
  status: 'status-',
  people: 'person-',
  org: 'org-',
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
 *   - Either bucket key is missing — the over target wasn't a sortable
 *     row (e.g. dropped on the project zone), so the target group can't
 *     be resolved.
 *   - Source and target are the same group — pure reorder, no field
 *     change.
 *   - `groupBy` is a date dimension (`date` / `scheduled` / `deadline`).
 *     Date buckets are derived, not assigned (Q5 in the lists-consistency
 *     plan); the visual reorder still happens, but the date itself is
 *     never rewritten.
 *   - The bucket key doesn't parse against its expected prefix
 *     (defensive — protects against id-shape mismatches between caller
 *     and `task-grouping`).
 *   - Both sides resolve to "no id" under a many-to-many dimension
 *     (ungrouped → ungrouped — already caught by the same-key check
 *     unless one side is `null`/missing).
 */
export function resolveCrossGroupMutation(
  groupBy: ProjectGroupBy,
  sourceKey: string | null | undefined,
  targetKey: string | null | undefined,
  todoId: number,
): CrossGroupMutation | null {
  if (sourceKey == null || targetKey == null) return null
  if (sourceKey === targetKey) return null
  if (groupBy === 'date' || groupBy === 'scheduled' || groupBy === 'deadline') return null

  if (groupBy === 'status') {
    if (targetKey === UNGROUPED_GROUP_KEY) {
      return { kind: 'status', todoId, statusId: undefined }
    }
    const sid = parseId(targetKey, PREFIX_BY_GROUP.status)
    if (sid == null) return null
    return { kind: 'status', todoId, statusId: sid }
  }

  if (groupBy === 'people' || groupBy === 'org' || groupBy === 'tag') {
    const prefix = PREFIX_BY_GROUP[groupBy]
    const removeId = sourceKey === UNGROUPED_GROUP_KEY ? null : parseId(sourceKey, prefix)
    const addId = targetKey === UNGROUPED_GROUP_KEY ? null : parseId(targetKey, prefix)
    if (removeId == null && addId == null) return null
    return { kind: groupBy, todoId, removeId, addId }
  }

  return null
}
