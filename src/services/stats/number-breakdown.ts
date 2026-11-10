import type { PersistedTodoItem, StatusIconKey } from '../../models'
import type { NumberBreakdown } from '../../models/glance-widgets'
import { computeBreakdown, type PriorityGroupKey } from './breakdown'
import type { StatsContext } from './stats-context'

/** What leads a status or priority line: the status's glyph, the priority group's ring (people, tags and the none line have a dot). */
export type BreakdownEntryMark =
  | { kind: 'status'; icon?: StatusIconKey }
  | { kind: 'priority'; group: PriorityGroupKey }

/** One line of a Number's breakdown: a person, a tag, a status or a priority group (or none of them) and its share of the count. */
export interface BreakdownEntry {
  /** The person's or tag's id as text, a status's `status-<id>`, a priority group's `priority-<group>`; `none` for the tasks with none. */
  key: string
  label: string
  /** The person's, tag's or status's colour; absent for a priority group and `none`. */
  color?: string
  /** The counted tasks it holds, in the count's order. */
  ids: number[]
  /** A status's glyph or a priority group's ring (absent: a dot). */
  mark?: BreakdownEntryMark
}

/**
 * A Number's tasks (`ids`, in its order) broken down (D25 R, its large face):
 * by their people or their tags, an entry per person / tag holding any, by
 * count descending, ties by name; a task with several counts for each — the
 * tasks with nobody (`Unassigned`) / no tag (`No tag`) last, when there are
 * any. By status or priority, the Breakdown chart's split
 * (`computeBreakdown`): each status in Settings' order then `No status`, the
 * Priority sort's groups (Focus, Urgent + Important, Urgent, Important) then
 * `No priority`. Pure; empty for `none`.
 */
export function numberBreakdown(
  ids: readonly number[],
  by: NumberBreakdown,
  ctx: StatsContext,
  todoById: ReadonlyMap<number, PersistedTodoItem>,
): BreakdownEntry[] {
  switch (by) {
    case 'none': return []
    case 'people':
    case 'tags': return ownerBreakdown(ids, by, ctx)
    case 'status':
    case 'priority': return splitBreakdown(ids, by, ctx, todoById)
  }
}

function ownerBreakdown(
  ids: readonly number[],
  by: 'people' | 'tags',
  ctx: Pick<StatsContext, 'assignedPeopleMap' | 'assignedTagsMap'>,
): BreakdownEntry[] {
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

/** By status or priority: the Breakdown chart's rows over the counted tasks, each line's ids back in the count's order. */
function splitBreakdown(
  ids: readonly number[],
  by: 'status' | 'priority',
  ctx: StatsContext,
  todoById: ReadonlyMap<number, PersistedTodoItem>,
): BreakdownEntry[] {
  const tasks = ids.flatMap((id) => {
    const t = todoById.get(id)
    return t ? [t] : []
  })
  const order = new Map(ids.map((id, i) => [id, i]))
  const { rows } = computeBreakdown(tasks, ctx, { splitBy: by, oldestBy: 'created', show: 'count', columns: [] })
  return rows.map((row) => {
    const e = row.entity
    const mark: BreakdownEntryMark | undefined = e.kind === 'status' ? { kind: 'status', ...(e.status.icon ? { icon: e.status.icon } : {}) }
      : e.kind === 'priority' ? { kind: 'priority', group: e.group }
        : undefined
    return {
      key: row.key,
      label: row.label,
      ...(row.color ? { color: row.color } : {}),
      ids: [...row.ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
      ...(mark ? { mark } : {}),
    }
  })
}
