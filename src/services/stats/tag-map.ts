import type { PersistedTodoItem, Tag } from '../../models'
import { daysUntil } from '../../utils/effective-date'
import { keepsNoneRow, restrictedRows, type RowRestrictions } from './row-restrictions'
import { idsByDate, type StatsContext } from './stats-context'

/**
 * A Tag map's tiles (D26 P8, board Z1), pure: a tile per tag on the open
 * tasks it's given — every tag on one (and No tags, for the untagged), or
 * just the picked ones in pick order — each with its open tasks and the
 * late ones among them (due before today), largest first. A task with
 * several tags counts in each — narrowed by the `#` picks as a Breakdown's
 * rows (`row-restrictions`): under `#Atlas` a task of Atlas and Ops counts
 * under Atlas alone, and No tags stays only while every pick has it.
 */

export interface TagMapTile {
  /** `tag-<id>`, or `none` for No tags. */
  key: string
  tag: (Tag & { id: number }) | null
  label: string
  color?: string
  /** Its open tasks, by due date. */
  ids: number[]
  /** The late ones among them. */
  lateIds: number[]
}

/** The share of a tile's tasks that are late (0 – 1). */
export function lateShare(tile: Pick<TagMapTile, 'ids' | 'lateIds'>): number {
  return tile.ids.length > 0 ? tile.lateIds.length / tile.ids.length : 0
}

export function computeTagMap(
  tasks: readonly PersistedTodoItem[],
  ctx: Pick<StatsContext, 'today' | 'assignedTagsMap'>,
  tagIds?: readonly number[],
  restrictions: RowRestrictions = [],
): TagMapTile[] {
  const picked = tagIds ? new Set(tagIds) : null
  const byTag = new Map<number, { tag: Tag & { id: number }; tasks: PersistedTodoItem[] }>()
  const untagged: PersistedTodoItem[] = []
  for (const t of tasks) {
    if (t.isCompleted) continue
    const tags = new Map<number, Tag>()
    for (const tag of ctx.assignedTagsMap.get(t.id) ?? []) if (tag.id != null && !tags.has(tag.id)) tags.set(tag.id, tag)
    if (tags.size === 0) {
      if (!picked && keepsNoneRow(restrictions)) untagged.push(t)
      continue
    }
    for (const id of restrictedRows([...tags.keys()], restrictions)) {
      const tag = tags.get(id)
      if (!tag || (picked && !picked.has(id))) continue
      let entry = byTag.get(id)
      if (!entry) {
        entry = { tag: { ...tag, id }, tasks: [] }
        byTag.set(id, entry)
      }
      entry.tasks.push(t)
    }
  }
  const late = (list: readonly PersistedTodoItem[]) => idsByDate(list.filter((t) => (daysUntil(t.dueDate, ctx.today) ?? 0) < 0), 'deadline')
  const tiles: TagMapTile[] = [...byTag.values()].map(({ tag, tasks: list }) => ({
    key: `tag-${tag.id}`, tag, label: tag.name, color: tag.color, ids: idsByDate(list, 'deadline'), lateIds: late(list),
  }))
  if (untagged.length > 0) tiles.push({ key: 'none', tag: null, label: 'No tags', ids: idsByDate(untagged, 'deadline'), lateIds: late(untagged) })
  // Largest first (a treemap lays them out best so); ties by pick order, else by name.
  const order = new Map((tagIds ?? []).map((id, i) => [id, i]))
  return tiles.sort((a, b) => b.ids.length - a.ids.length
    || (order.get(a.tag?.id ?? -1) ?? 0) - (order.get(b.tag?.id ?? -1) ?? 0)
    || a.label.localeCompare(b.label))
}
