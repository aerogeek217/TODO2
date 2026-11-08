import type { StatusBreakdownEntry } from '../../../services/stats/status-breakdown'

/** What the glance widgets' small faces (D25 R) headline, where it takes more than a count. */

/** The small face's entry: the status with the most open tasks (the first of a tie); `undefined` with none open. */
export function topStatus(entries: readonly StatusBreakdownEntry[]): StatusBreakdownEntry | undefined {
  let top: StatusBreakdownEntry | undefined
  for (const e of entries) if (e.count > 0 && (!top || e.count > top.count)) top = e
  return top
}
