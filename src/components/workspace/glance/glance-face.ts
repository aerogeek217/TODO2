import type { NextDaysColumn } from '../../../services/stats/next-seven-days'
import type { StatusBreakdownEntry } from '../../../services/stats/status-breakdown'

/** What the glance widgets' small faces (D25 R) headline, where it takes more than a count. */

/** The small face's number: the tasks due or to follow up today or in the six days after it (each once; Late apart). */
export function nextDaysCount(cols: readonly NextDaysColumn[]): number {
  const ids = new Set<number>()
  for (const c of cols) {
    if (c.date == null) continue
    for (const id of c.dueIds) ids.add(id)
    for (const id of c.followupIds) ids.add(id)
  }
  return ids.size
}

/** The small face's entry: the status with the most open tasks (the first of a tie); `undefined` with none open. */
export function topStatus(entries: readonly StatusBreakdownEntry[]): StatusBreakdownEntry | undefined {
  let top: StatusBreakdownEntry | undefined
  for (const e of entries) if (e.count > 0 && (!top || e.count > top.count)) top = e
  return top
}
