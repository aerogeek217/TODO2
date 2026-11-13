import type { DataRow, DataSet } from '../../schema-upgrades'
import { isRecord, layoutTabsOf, type Obj, type TabStep } from '../layout-tabs'

/**
 * v79, part 1 — every stored layout in its final shape (widget feedback
 * 2026-11-11, decision 6): what builds after v78 read at load time is
 * written into the row, so the read-time shims could go.
 *
 * Per tab:
 *
 * | kind | before | after |
 * |------|--------|-------|
 * | `eisenhower`, `tagMap`, `statusFlow` | a tab | gone; a cell left without tabs closes (`upgrades/layout-tabs`, the absorb rule) |
 * | `review` | `config.by`, `config.pick`; `viewState.currentId`, `viewState.skipped` | `config: {}`; the view state's other keys (its sort, its lens switch) kept |
 * | `breakdown` | no `columns`, maybe `badges` | `columns` as the read derived them — Due and Follow-up from `badges` and the Settings ranges in this data (`tabBadgeDue` / `tabBadgeFollowup`, the defaults 3 and 0 when absent), a range `off` dropping its column, `overdue` counting only the late tasks —; `badges` gone |
 * | `breakdown` | `checkins` | gone |
 * | `breakdown` | a split's sort by an older derived column (`overdue`, `due-soon` → `due`; `followup-late`, `followup-due` → `followup`) or by a key no column has (the old Priority column's `priority`) | the column that holds its tasks, while the Breakdown has it, in the same direction; else none (the split's default order) |
 * | `number` | `config.ignoreLens: true` | `viewState.ignoreLens: true` unless the view state already says (it wins, as the read had it); the config key gone |
 * | `lens` (a list tab) | `viewState.zoom: 'strips'` | `'lines'` |
 * | `trend` | no `name` / no `show` | `name: 'Created vs completed'`, `show: 'bars'` (its `filter` stays optional: absent reads as the empty filter, so nothing is written) |
 * | any | `icon: { kind: 'emoji', …, show: 'muted' }` | `show` gone (muted is the default) |
 *
 * Per layout: the lens pick an early build kept on the row (`lensId`; the
 * top bar's pick has been a settings row since) goes, and so does a layout
 * icon's `show: 'muted'`.
 *
 * Over the `layouts` table, and kept layout drafts (through the pipeline:
 * each body read as a layout row — with no settings rows there, a Breakdown
 * in a kept draft takes the default ranges; a draft whose base then differs
 * from the stored layout is dropped at launch, never applied). Holds its own
 * copy of every shape it writes, so it goes on meaning this whatever later
 * builds do. Defensive: a tab that isn't an object, or a field that doesn't
 * read, is left for the layout repair; a row already in the v79 shape comes
 * back as the same object (idempotent).
 */

/** The kinds removed after v78 shipped: their tabs go. */
const REMOVED_KINDS: ReadonlySet<unknown> = new Set(['eisenhower', 'tagMap', 'statusFlow'])

// ── Breakdown: count columns from `badges` ────────────────────────────────────

/** A Due / Follow-up range as stored: `off`, `overdue` (only the late tasks) or a day count (overdue up to today + N). */
type Range = 'off' | 'overdue' | number

/** The Settings › Tasks ranges with no rows stored. */
const DEFAULT_RANGES: { due: Range; followup: Range } = { due: 3, followup: 0 }

/** A stored range (a settings value or a badge override's): `undefined` when it isn't one. */
function rangeOf(v: unknown): Range | undefined {
  if (v === 'off' || v === 'overdue') return v
  const days = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN
  return Number.isInteger(days) && days >= 0 && days <= 365 ? days : undefined
}

/** The Settings › Tasks ranges in `settings` (as the settings store read them: each its row, else its default; no rows, the defaults). */
export function appRangesOf(settings: readonly DataRow[] | undefined): { due: Range; followup: Range } {
  const value = (key: string) => settings?.find((r) => isRecord(r) && r.key === key)?.value
  const due = value('tabBadgeDue')
  const followup = value('tabBadgeFollowup')
  if (due === undefined && followup === undefined) return DEFAULT_RANGES
  return {
    due: (due === undefined ? undefined : rangeOf(due)) ?? DEFAULT_RANGES.due,
    followup: (followup === undefined ? undefined : rangeOf(followup)) ?? DEFAULT_RANGES.followup,
  }
}

/** A badge override's range: `off`, `overdue` or a whole day count 0 – 365 (a number, never text). */
function isBadgeRange(v: unknown): v is Range {
  return v === 'off' || v === 'overdue' || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 365)
}

/**
 * A Breakdown's own ranges (`badges`: `off`, or a due and / or follow-up
 * range) over the app's, as the read had them; a `badges` that doesn't read
 * is none (the read dropped it).
 */
function rangesOf(badges: unknown, app: { due: Range; followup: Range }): { due: Range; followup: Range } {
  if (badges === 'off') return { due: 'off', followup: 'off' }
  if (!isRecord(badges)) return app
  const { due, followup, ...rest } = badges
  if (Object.keys(rest).length > 0 || (due === undefined && followup === undefined)) return app
  if ((due !== undefined && !isBadgeRange(due)) || (followup !== undefined && !isBadgeRange(followup))) return app
  return { due: isBadgeRange(due) ? due : app.due, followup: isBadgeRange(followup) ? followup : app.followup }
}

/** No filter, with one date range on `field` from any day before up to `end` days from today. */
function byFilter(field: 'deadline' | 'followup', end: number): Obj {
  return {
    showCompleted: false, personIds: null, statusIds: null, searchText: '', markers: null, tags: null,
    dates: { [field]: { match: 'range', start: null, end: { kind: 'offset', days: end } } },
  }
}

/** One date's column, lit above 0: up to today + N, overdue included; `overdue` only the late ones (up to yesterday); `off` none. */
function rangeColumn(range: Range, field: 'deadline' | 'followup', id: string, name: string, color: string): Obj[] {
  if (range === 'off') return []
  return [{ id, name, color, filter: byFilter(field, range === 'overdue' ? -1 : range), litWhen: 'above', litAt: 0 }]
}

/** The Due and Follow-up columns a Breakdown without `columns` read as (their ids `due` and `followup`, unique within the tab). */
export function derivedColumns(badges: unknown, app: { due: Range; followup: Range }): Obj[] {
  const ranges = rangesOf(badges, app)
  return [
    ...rangeColumn(ranges.due, 'deadline', 'due', 'Due', '#e86bf0'),
    ...rangeColumn(ranges.followup, 'followup', 'followup', 'Follow-up', '#f5c842'),
  ]
}

/** The headings a Breakdown always has. */
const FIXED_SORT_KEYS: ReadonlySet<unknown> = new Set(['name', 'open'])
/** The older derived columns' sort keys → the column that holds their tasks. */
const OLD_SORT_COLUMNS: Readonly<Record<string, string>> = {
  overdue: 'due',
  'due-soon': 'due',
  'followup-late': 'followup',
  'followup-due': 'followup',
}

/** A split's stored sort as the headings read it, given the column ids: kept, moved to the column holding its tasks, or `null` (none). */
function liveSort(sort: Obj, columnIds: ReadonlySet<unknown>): Obj | null {
  if (FIXED_SORT_KEYS.has(sort.by) || columnIds.has(sort.by)) return sort
  const now = typeof sort.by === 'string' && Object.hasOwn(OLD_SORT_COLUMNS, sort.by) ? OLD_SORT_COLUMNS[sort.by] : undefined
  return now != null && columnIds.has(now) ? { ...sort, by: now } : null
}

/** A Breakdown's view state with every split's sort as the headings read it; the same object when none changes. */
function breakdownView(view: unknown, columnIds: ReadonlySet<unknown>): unknown {
  if (!isRecord(view) || !isRecord(view.sorts)) return view
  let changed = false
  const sorts: Obj = {}
  for (const [split, sort] of Object.entries(view.sorts)) {
    // A sort that doesn't read is the layout repair's.
    if (!isRecord(sort) || typeof sort.by !== 'string') {
      sorts[split] = sort
      continue
    }
    const live = liveSort(sort, columnIds)
    if (live !== sort) changed = true
    if (live) sorts[split] = live
  }
  if (!changed) return view
  const { sorts: _s, ...rest } = view
  void _s
  return Object.keys(sorts).length > 0 ? { ...rest, sorts } : rest
}

function breakdownTab(tab: Obj, app: { due: Range; followup: Range }): Obj {
  const config = tab.config
  if (!isRecord(config)) return tab
  let next = tab
  const hasOld = config.columns === undefined || 'badges' in config || 'checkins' in config
  if (hasOld) {
    const { badges, checkins: _c, ...rest } = config
    void _c
    const columns = config.columns === undefined ? derivedColumns(badges, app) : config.columns
    next = { ...next, config: { ...rest, columns } }
  }
  const columns = (next.config as Obj).columns
  const columnIds = new Set(Array.isArray(columns) ? columns.map((c) => (isRecord(c) ? c.id : undefined)) : [])
  const view = breakdownView(next.viewState, columnIds)
  if (view !== next.viewState) {
    const { viewState: _v, ...rest } = next
    void _v
    next = isRecord(view) && Object.keys(view).length > 0 ? { ...rest, viewState: view } : rest
  }
  return next
}

// ── The other kinds ───────────────────────────────────────────────────────────

/** `tab` with `view` as its view state (none when it is empty). */
function withView(tab: Obj, view: Obj): Obj {
  const { viewState: _v, ...rest } = tab
  void _v
  return Object.keys(view).length > 0 ? { ...rest, viewState: view } : rest
}

/** A Review widget: no settings; its view state without the place an earlier build saved. */
function reviewTab(tab: Obj): Obj {
  const config = tab.config
  const view = tab.viewState
  const configOld = isRecord(config) && Object.keys(config).length > 0
  const viewOld = isRecord(view) && ('currentId' in view || 'skipped' in view)
  if (!configOld && !viewOld) return tab
  let next: Obj = configOld ? { ...tab, config: {} } : tab
  if (viewOld) {
    const { currentId: _c, skipped: _s, ...rest } = view
    void _c
    void _s
    next = withView(next, rest)
  }
  return next
}

/** A Number: its config's old lens switch moved to its view state (which wins when it has one). */
function numberTab(tab: Obj): Obj {
  const config = tab.config
  if (!isRecord(config) || !('ignoreLens' in config)) return tab
  const { ignoreLens, ...rest } = config
  const view = isRecord(tab.viewState) ? tab.viewState : {}
  const next = { ...tab, config: rest }
  if (ignoreLens !== true || typeof view.ignoreLens === 'boolean') return next
  return { ...next, viewState: { ...view, ignoreLens: true } }
}

/** A list tab: the removed Strips zoom as Lines. */
function listTab(tab: Obj): Obj {
  const view = tab.viewState
  if (!isRecord(view) || view.zoom !== 'strips') return tab
  return { ...tab, viewState: { ...view, zoom: 'lines' } }
}

/** Created vs completed: its name and Show as written where absent. */
function trendTab(tab: Obj): Obj {
  const config = tab.config
  if (!isRecord(config) || (config.name !== undefined && config.show !== undefined)) return tab
  return { ...tab, config: { ...config, name: config.name ?? 'Created vs completed', show: config.show ?? 'bars' } }
}

/** An icon without `show: 'muted'` (the default); the same value when it has none. */
function iconOf(icon: unknown): unknown {
  if (!isRecord(icon) || icon.kind !== 'emoji' || icon.show !== 'muted') return icon
  const { show: _s, ...rest } = icon
  void _s
  return rest
}

/** `tab` with its icon's `show: 'muted'` gone. */
function withIcon(tab: Obj): Obj {
  const icon = iconOf(tab.icon)
  return icon === tab.icon ? tab : { ...tab, icon }
}

/** The step every tab takes. */
function v79Tab(app: { due: Range; followup: Range }): TabStep {
  return (tab) => {
    if (REMOVED_KINDS.has(tab.kind)) return null
    let next = withIcon(tab)
    switch (next.kind) {
      case 'review': next = reviewTab(next); break
      case 'breakdown': next = breakdownTab(next, app); break
      case 'number': next = numberTab(next); break
      case 'lens': next = listTab(next); break
      case 'trend': next = trendTab(next); break
    }
    return next
  }
}

/** A layout row (or a kept draft's body) in its v79 shape; the row itself when nothing changes. */
export function layoutV79Of(row: DataRow, app: { due: Range; followup: Range } = DEFAULT_RANGES): DataRow {
  let next = layoutTabsOf(row, v79Tab(app))
  if (!isRecord(next)) return next
  if ('lensId' in next) {
    const { lensId: _l, ...rest } = next
    void _l
    next = rest
  }
  const icon = iconOf(next.icon)
  if (icon !== next.icon) next = { ...next, icon }
  return next
}

export function upgradeLayoutsV79(data: DataSet): DataSet {
  const layouts = data.layouts
  if (!layouts) return data
  const app = appRangesOf(data.settings)
  const next = layouts.map((row) => layoutV79Of(row, app))
  if (next.every((row, i) => row === layouts[i])) return data
  return { ...data, layouts: next }
}
