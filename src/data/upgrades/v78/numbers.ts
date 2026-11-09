import type { DataRow, DataSet } from '../../schema-upgrades'
import { isV77Metric, numberConfigOfMetric } from './number-metrics'

/**
 * v78, part 3 (D26 P5) — a Number is a filter: each Number tab's metric
 * becomes the config that counts the same tasks, over the table
 * `layout-table` makes (parts 1 and 2 run first).
 *
 * `{ metric, breakdown? }` becomes `{ name, color?, filter, show: 'count',
 * litWhen, litAt?, compare, breakdown? }`:
 *
 * - **name** — the metric's label as v77 showed it (`Overdue`).
 * - **filter** — a Graphical filter (`TodoPredicate`, its chips) that keeps
 *   the tasks the metric counted, each as the expression prints it:
 *
 *   | metric         | filter                       |
 *   |----------------|------------------------------|
 *   | open           | none (every open task)       |
 *   | overdue        | `overdue`                    |
 *   | dueToday       | `due today`                  |
 *   | dueNext7       | `due within 6 days` (today … today + 6, the metric's 7 days) |
 *   | followupDue    | `followup by today`          |
 *   | noFollowup     | `no followup`                |
 *   | focus          | `/focus`                     |
 *   | urgent         | `/urgent` (flagged, or due within Settings' range) |
 *   | closedThisWeek | `completed this week`        |
 *
 * - **color** — the metric's colour as a hex: the dark theme's token value
 *   (`tokens.css`), copied here so the upgrade owns it. The accent's metrics
 *   (Open, Focus, Closed this week) take none (Auto: neutral, lit in the
 *   accent — the theme's own, as they were).
 * - **litWhen** — `above` 0 for the metrics that lit while above zero
 *   (Urgent, Overdue, Follow-up due, Due today), else `never`.
 * - **compare** — `lastWeek` for Closed this week (its change was against
 *   the same point of last week), else `yesterday`.
 * - **breakdown** — kept as it was.
 *
 * Over the `layouts` table, and kept layout drafts (through the pipeline:
 * each body read as a layout row). Holds its own copy of everything it
 * reads, so it goes on meaning this whatever later builds do. Defensive: a
 * cell or tab that isn't an object, a Number whose metric isn't one of
 * these, is left as it is (the layout repair resets it). A Number without a
 * `metric` is taken as converted already (idempotent).
 */

type Obj = Record<string, unknown>

function isRecord(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A Number tab with its metric converted; `null` when it isn't a v77 Number. */
function convertTab(tab: unknown): Obj | null {
  if (!isRecord(tab) || tab.kind !== 'number' || !isRecord(tab.config)) return null
  const metric = tab.config.metric
  if (!isV77Metric(metric)) return null
  return { ...tab, config: numberConfigOfMetric(metric, tab.config.breakdown) }
}

/** A layout row (or a kept draft's body) with its Numbers converted; the row itself when nothing changes. */
export function layoutNumbersOf(row: DataRow): DataRow {
  if (!isRecord(row) || !Array.isArray(row.cells)) return row
  let changed = false
  const cells = (row.cells as unknown[]).map((cell) => {
    if (!isRecord(cell) || !Array.isArray(cell.tabs)) return cell
    let cellChanged = false
    const tabs = (cell.tabs as unknown[]).map((tab) => {
      const next = convertTab(tab)
      if (!next) return tab
      cellChanged = true
      return next
    })
    if (!cellChanged) return cell
    changed = true
    return { ...cell, tabs }
  })
  return changed ? { ...row, cells } : row
}

export function upgradeNumbers(data: DataSet): DataSet {
  const layouts = data.layouts
  if (!layouts) return data
  const next = layouts.map(layoutNumbersOf)
  if (next.every((row, i) => row === layouts[i])) return data
  return { ...data, layouts: next }
}
