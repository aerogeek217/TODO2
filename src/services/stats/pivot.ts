import type { PersistedTodoItem } from '../../models'
import type { PivotDim } from '../../models/chart-widgets'
import type { TabBadgeRanges } from '../../models/list-definition'
import { DEFAULT_TAB_BADGES, tabBadgeRangeHit } from '../../utils/tab-badges'
import { computeBreakdown, type BreakdownColumnKeep, type BreakdownRow } from './breakdown'
import type { RowRestrictions } from './row-restrictions'
import type { StatsContext } from './stats-context'

/**
 * A Pivot's heat table (D26 P8, board Z1), pure: the tasks it's given
 * split by two things at once — each axis split as a Breakdown splits
 * (`computeBreakdown`: its rows in its default order, the none row last),
 * each cell the tasks both its row and its column hold. A task in several
 * rows or columns (people, tags) counts in each. A people or tags axis puts
 * first the ones with the most open tasks due or due a follow-up (inside
 * `ranges`, overdue included — a Breakdown's default columns), then the
 * most open.
 */

/** One axis's heads: a Breakdown row without its counts. */
export type PivotHead = Pick<BreakdownRow, 'key' | 'label' | 'entity' | 'color' | 'ids'>

export interface PivotStats {
  rows: PivotHead[]
  cols: PivotHead[]
  /** The tasks of each cell, by `cellKey(row, col)`; a missing key is empty. */
  cells: ReadonlyMap<string, number[]>
  /** The largest cell's count (the heat's top). */
  max: number
  /** Every task counted, each once. */
  ids: number[]
}

/** A cell's key in `PivotStats.cells`. */
export function cellKey(row: string, col: string): string {
  return `${row}|${col}`
}

export interface PivotOptions {
  rows: PivotDim
  cols: PivotDim
  /** The `@` / `#` picks narrowing a people / tags axis. */
  restrictions?: { people?: RowRestrictions; tags?: RowRestrictions }
  /** The Due / Follow-up ranges a people / tags axis orders by (Settings › Tasks'; default the app's defaults). */
  ranges?: TabBadgeRanges
}

/** The open tasks due, and due a follow-up, inside `ranges` (overdue included): what orders a people / tags axis. */
function orderColumns(tasks: readonly PersistedTodoItem[], ranges: TabBadgeRanges, today: Date): BreakdownColumnKeep[] {
  const due = new Set<number>()
  const followup = new Set<number>()
  for (const t of tasks) {
    if (t.isCompleted) continue
    if (tabBadgeRangeHit(t.dueDate, ranges.due, today) != null) due.add(t.id)
    if (tabBadgeRangeHit(t.nextFollowupAt, ranges.followup, today) != null) followup.add(t.id)
  }
  return [{ id: 'due', keep: due }, { id: 'followup', keep: followup }]
}

function axis(tasks: readonly PersistedTodoItem[], ctx: StatsContext, dim: PivotDim, opts: PivotOptions, columns: readonly BreakdownColumnKeep[]) {
  const restrictions = dim === 'people' ? opts.restrictions?.people : dim === 'tags' ? opts.restrictions?.tags : undefined
  return computeBreakdown(tasks, ctx, { splitBy: dim, show: 'count', oldestBy: 'created', columns, restrictions })
}

const head = ({ key, label, entity, color, ids }: BreakdownRow): PivotHead => ({ key, label, entity, ...(color ? { color } : {}), ids })

export function computePivot(tasks: readonly PersistedTodoItem[], ctx: StatsContext, opts: PivotOptions): PivotStats {
  const columns = orderColumns(tasks, opts.ranges ?? DEFAULT_TAB_BADGES, ctx.today)
  const rowStats = axis(tasks, ctx, opts.rows, opts, columns)
  const colStats = axis(tasks, ctx, opts.cols, opts, columns)
  const rows = rowStats.rows.map(head)
  const cols = colStats.rows.map(head)
  const cells = new Map<string, number[]>()
  let max = 0
  for (const r of rows) {
    const inRow = new Set(r.ids)
    for (const c of cols) {
      const ids = c.ids.filter((id) => inRow.has(id))
      if (ids.length === 0) continue
      cells.set(cellKey(r.key, c.key), ids)
      max = Math.max(max, ids.length)
    }
  }
  // Counted: in some row and some column (a pick can leave a task out of an axis).
  const inCols = new Set(colStats.ids)
  return { rows, cols, cells, max, ids: rowStats.ids.filter((id) => inCols.has(id)) }
}
