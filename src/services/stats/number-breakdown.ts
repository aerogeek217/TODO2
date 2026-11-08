import type { NumberBreakdown } from '../../models/glance-widgets'
import type { StatsContext } from './stats-context'

/** One line of a Number's breakdown: a person or a tag (or nobody / no tag) and its share of the count. */
export interface BreakdownEntry {
  /** The person's or tag's id as text; `none` for the tasks with nobody / no tag. */
  key: string
  label: string
  /** The person's or tag's colour; absent for `none`. */
  color?: string
  /** The counted tasks it holds, in the count's order. */
  ids: number[]
}

/**
 * A Number's tasks (`ids`, in its order) broken down by their people or
 * their tags (D25 R, its large face): an entry per person / tag holding any,
 * by count descending, ties by name; a task with several counts for each.
 * The tasks with nobody (`Unassigned`) / no tag (`No tag`) come last, when
 * there are any. Pure; empty for `none`.
 */
export function numberBreakdown(
  ids: readonly number[],
  by: NumberBreakdown,
  ctx: Pick<StatsContext, 'assignedPeopleMap' | 'assignedTagsMap'>,
): BreakdownEntry[] {
  if (by === 'none') return []
  const entries = new Map<number, BreakdownEntry>()
  const none: number[] = []
  for (const id of ids) {
    const owners = by === 'people' ? ctx.assignedPeopleMap.get(id) : ctx.assignedTagsMap.get(id)
    const seen = new Set<number>()
    for (const owner of owners ?? []) {
      if (owner.id == null || seen.has(owner.id)) continue
      seen.add(owner.id)
      let entry = entries.get(owner.id)
      if (!entry) {
        entry = {
          key: String(owner.id),
          label: by === 'tags' ? `#${owner.name}` : owner.name,
          ...(owner.color ? { color: owner.color } : {}),
          ids: [],
        }
        entries.set(owner.id, entry)
      }
      entry.ids.push(id)
    }
    if (seen.size === 0) none.push(id)
  }
  const sorted = [...entries.values()].sort((a, b) => b.ids.length - a.ids.length || a.label.localeCompare(b.label))
  if (none.length > 0) sorted.push({ key: 'none', label: by === 'people' ? 'Unassigned' : 'No tag', ids: none })
  return sorted
}
