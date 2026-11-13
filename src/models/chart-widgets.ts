/**
 * The chart widgets' settings (D26 P8, board Z1): a filter, then what it is
 * split by. **Breakdown** (`breakdown`) splits the tasks a filter keeps by
 * one thing — people, tags, status, priority, due date or age — and
 * replaced People, Tags and Status, which are its presets now. Each config
 * here, its defaults, and the pickers that read it from untrusted input (a
 * stored layout, an import).
 */

import {
  isNumberColor,
  isNumberLitAt,
  NUMBER_LIT_WHEN,
  NUMBER_NAME_MAX,
  numberIsLit,
  readStoredName,
  type NumberLitWhen,
  type NumberPredicateRead,
  type PickedConfig,
} from './glance-widgets'
import type { TabBadgeRange, TabBadgeRanges } from './list-definition'
import { emptyPredicate, type TodoPredicate } from './filter-predicate'

type Obj = Record<string, unknown>

function includes<T extends string | number>(list: readonly T[], v: unknown): v is T {
  return (list as readonly unknown[]).includes(v)
}

/** The longest chart name kept (as a Number's). */
export const CHART_NAME_MAX = NUMBER_NAME_MAX

function isChartName(v: unknown): v is string {
  return typeof v === 'string' && v.length <= CHART_NAME_MAX
}

// ── Breakdown ───────────────────────────────────────────────────────────────

/**
 * What a Breakdown splits its tasks by: their people, their tags, their
 * status, their priority (the Priority sort's groups: Focus, Urgent +
 * Important, Urgent, Important, No priority), their due date (Overdue,
 * Today, the next 7 days, later, none) or their age (since created).
 */
export const BREAKDOWN_SPLITS = ['people', 'tags', 'status', 'priority', 'due', 'age'] as const
export type BreakdownSplit = (typeof BREAKDOWN_SPLITS)[number]

/** How the split is drawn: a bar per row, a donut, or one stacked bar. */
export const BREAKDOWN_STYLES = ['bars', 'donut', 'stacked'] as const
export type BreakdownStyle = (typeof BREAKDOWN_STYLES)[number]

/** What each row shows: its task count, or how old its oldest task is (`oldestBy`). */
export const BREAKDOWN_SHOWS = ['count', 'oldest'] as const
export type BreakdownShow = (typeof BREAKDOWN_SHOWS)[number]

/**
 * The date `oldest` ages a task by: its last follow-up (a task never
 * followed up: its creation), its creation, its last change, or its due
 * date (how late it is).
 */
export const BREAKDOWN_OLDEST_BY = ['lastFollowup', 'created', 'modified', 'due'] as const
export type BreakdownOldestBy = (typeof BREAKDOWN_OLDEST_BY)[number]

/** `oldest` without an `oldestBy`: by the last follow-up. */
export const DEFAULT_BREAKDOWN_OLDEST_BY: BreakdownOldestBy = 'lastFollowup'

/**
 * A Breakdown (D26 P8): the tasks a filter keeps — composed with the top
 * bar's filter, as a Number's — split by one thing.
 */
export interface BreakdownConfig {
  /** Its title (may be blank while it's being typed: the tab then reads `Breakdown`). */
  name: string
  /** What it splits: a Graphical or expression filter, as a list's (an empty one keeps every open task). */
  filter: TodoPredicate
  splitBy: BreakdownSplit
  style: BreakdownStyle
  show: BreakdownShow
  /** The date `oldest` ages by; stored only with `oldest` (absent = `lastFollowup`). */
  oldestBy?: BreakdownOldestBy
  /** The none row (Unassigned / No tags / No status / No priority / No due date) shows. */
  showNone: boolean
  /**
   * Its count columns (board BC): up to `BREAKDOWN_COLUMNS_MAX`, each a
   * name, a colour and a filter; a row's cell counts that row's tasks the
   * filter keeps. A new Breakdown writes its two defaults here
   * (`defaultBreakdownColumns`), and v79 wrote them on every stored one
   * (from the older `badges`). Absent (a hand-made file): the two defaults
   * in Settings › Tasks' ranges (`breakdownColumns`) — written as `columns`
   * once they are edited.
   */
  columns?: BreakdownColumn[]
}

/**
 * A Breakdown's count column (board BC): its heading, the colour its counts
 * fill with while above 0, and the filter (Graphical or an expression, as a
 * Number's) that picks which of a row's tasks it counts.
 */
export interface BreakdownColumn {
  /** Unique among its Breakdown's columns (a sort names it); never a fixed heading's key (`BREAKDOWN_FIXED_SORT_KEYS`). */
  id: string
  name: string
  /** A hex. */
  color: string
  filter: TodoPredicate
  /** When a count fills solid in its colour (a Number's rule, D18): never, above or below `litAt`; else it is outlined. */
  litWhen: NumberLitWhen
  /** The threshold of `above` / `below` (a whole number); absent with `never`. */
  litAt?: number
}

/** The most count columns a Breakdown holds. */
export const BREAKDOWN_COLUMNS_MAX = 4

/** The default columns' ids (`defaultBreakdownColumns`, and what a config without `columns` reads as): Due and Follow-up. */
export const DUE_COLUMN_ID = 'due'
export const FOLLOWUP_COLUMN_ID = 'followup'
/** The Due column's colour: the due date's magenta (the dark theme's `--color-overdue`). */
export const DUE_COLUMN_COLOR = '#e86bf0'
/** The Follow-up column's colour: the follow-up yellow (the dark theme's `--color-followup`). */
export const FOLLOWUP_COLUMN_COLOR = '#f5c842'

/** A date range on `field` from any day before up to `end` days from today (overdue included). */
function byFilter(field: 'deadline' | 'followup', end: number): TodoPredicate {
  return {
    ...emptyPredicate(),
    dates: { [field]: { match: 'range', start: null, end: { kind: 'offset', days: end } } },
  }
}

/**
 * A date's one column from its range, lit above 0: with a day count N, the
 * tasks with the date up to today + N (overdue included); `overdue`, only
 * the late ones (up to yesterday); `off`, none.
 */
function rangeColumn(range: TabBadgeRange, field: 'deadline' | 'followup', id: string, name: string, color: string): BreakdownColumn[] {
  if (range === 'off') return []
  return [{ id, name, color, filter: byFilter(field, range === 'overdue' ? -1 : range), litWhen: 'above', litAt: 0 }]
}

/**
 * A new Breakdown's count columns, written as its `columns` when it is
 * created (Add widget, every preset; Change widget): **Due** (due by today
 * + N, overdue included) and **Follow-up** (the next follow-up likewise),
 * each lit above 0 in its colour, in Settings › Tasks' ranges of the moment
 * — a range `off` drops its column, `overdue` counts only its late tasks —;
 * ordinary columns from then on, no longer following Settings.
 */
export function defaultBreakdownColumns(app: TabBadgeRanges): BreakdownColumn[] {
  return [
    ...rangeColumn(app.due, 'deadline', DUE_COLUMN_ID, 'Due', DUE_COLUMN_COLOR),
    ...rangeColumn(app.followup, 'followup', FOLLOWUP_COLUMN_ID, 'Follow-up', FOLLOWUP_COLUMN_COLOR),
  ]
}

/** A Breakdown's count columns: its own, else the defaults in Settings' ranges (`defaultBreakdownColumns`). */
export function breakdownColumns(config: Pick<BreakdownConfig, 'columns'>, app: TabBadgeRanges): readonly BreakdownColumn[] {
  return config.columns ?? defaultBreakdownColumns(app)
}

/** Whether a column's count `n` fills solid (its `litWhen` rule, as a Number's). */
export function columnIsLit(column: Pick<BreakdownColumn, 'litWhen' | 'litAt'>, n: number): boolean {
  return numberIsLit(column, n)
}

/** An id none of `columns` has (never a fixed heading's key). */
export function newBreakdownColumnId(columns: readonly Pick<BreakdownColumn, 'id'>[]): string {
  const used = new Set(columns.map((c) => c.id))
  let id: string
  do id = `col-${Math.random().toString(36).slice(2, 8)}`
  while (used.has(id))
  return id
}

/** The Add widget presets of a Breakdown (D26 P8; Waiting on went with count columns, board BC). */
export const BREAKDOWN_PRESETS = ['people', 'tags', 'status', 'custom'] as const
export type BreakdownPreset = (typeof BREAKDOWN_PRESETS)[number]

export const BREAKDOWN_PRESET_LABELS: Record<BreakdownPreset, string> = {
  people: 'People',
  tags: 'Tags',
  status: 'Status',
  custom: 'Custom',
}

/** A new Breakdown's name. */
export const DEFAULT_BREAKDOWN_NAME = 'Breakdown'

/** A new Breakdown: its filter as given, split by people, bars, counts, the none row shown. */
export function newBreakdownConfig(filter: TodoPredicate, patch: Partial<BreakdownConfig> = {}): BreakdownConfig {
  return { name: DEFAULT_BREAKDOWN_NAME, filter, splitBy: 'people', style: 'bars', show: 'count', showNone: true, ...patch }
}

/**
 * The fixed headings a Breakdown's rows sort by: the name and Open (or
 * Oldest). Every other heading is a count column (the fixed Priority
 * column went; v79 removed the sorts stored by it).
 */
export const BREAKDOWN_FIXED_SORT_KEYS = ['name', 'open'] as const

/**
 * A heading a Breakdown's rows sort by: a fixed one (`BREAKDOWN_FIXED_SORT_KEYS`)
 * or a count column's id. A sort by a column it no longer has reads as the
 * split's default order.
 */
export type BreakdownSortKey = string

/**
 * A heading a Breakdown is sorted by (view state, one per split): counts
 * largest first and names A–Z, or the reverse (`reversed`).
 */
export interface BreakdownSort {
  by: BreakdownSortKey
  reversed?: true
}

/**
 * A stored sort as the headings read it, given the Breakdown's column ids:
 * a fixed heading or one of its columns as stored; a column it no longer
 * has (removed in the editor): `undefined`, the split's default order. (The
 * older derived columns' keys and the Priority column's, v79 rewrote.)
 */
export function liveBreakdownSort(sort: BreakdownSort | undefined, columnIds: readonly string[]): BreakdownSort | undefined {
  if (!sort) return undefined
  return (BREAKDOWN_FIXED_SORT_KEYS as readonly string[]).includes(sort.by) || columnIds.includes(sort.by) ? sort : undefined
}

/** A Breakdown tab's view state: each split's sort, saved at once (absent = the split's default order), and its lens switch. */
export interface BreakdownViewState {
  sorts?: Partial<Record<BreakdownSplit, BreakdownSort>>
  /** The top bar's lens doesn't apply here (the widget's lens switch, saved at once; absent = it applies). */
  ignoreLens?: boolean
}

const COLUMN_ID = /^[A-Za-z0-9_-]{1,40}$/

/** A count column's stored id (or a sort key naming one): short word characters, never a fixed heading's key. */
export function isBreakdownColumnId(v: unknown): v is string {
  return typeof v === 'string' && COLUMN_ID.test(v) && !includes(BREAKDOWN_FIXED_SORT_KEYS, v)
}

/** A stored sort key: a fixed heading's, or a column id. */
function isSortKey(v: unknown): v is BreakdownSortKey {
  return includes(BREAKDOWN_FIXED_SORT_KEYS, v) || isBreakdownColumnId(v)
}

const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

/**
 * Where a stored Breakdown config goes wrong (its scalar fields — the
 * filter is the caller's: `data/predicate-shape`): the bad key, or `null`.
 */
export function breakdownConfigProblem(raw: Obj): string | null {
  if (!isChartName(raw.name)) return 'name'
  if (!includes(BREAKDOWN_SPLITS, raw.splitBy)) return 'splitBy'
  if (!includes(BREAKDOWN_STYLES, raw.style)) return 'style'
  if (!includes(BREAKDOWN_SHOWS, raw.show)) return 'show'
  if (raw.oldestBy !== undefined && (raw.show !== 'oldest' || !includes(BREAKDOWN_OLDEST_BY, raw.oldestBy))) return 'oldestBy'
  if (!isBool(raw.showNone)) return 'showNone'
  if (raw.columns !== undefined && columnsProblem(raw.columns)) return 'columns'
  return null
}

/** Whether a stored column list goes wrong in its scalar fields (its filters are the caller's): too many, a bad or repeated id, a bad name or colour. */
function columnsProblem(raw: unknown): boolean {
  if (!Array.isArray(raw) || raw.length > BREAKDOWN_COLUMNS_MAX) return true
  const ids = new Set<string>()
  for (const c of raw as unknown[]) {
    if (typeof c !== 'object' || c === null || Array.isArray(c)) return true
    const { id, name, color, litWhen, litAt } = c as Obj
    if (!isBreakdownColumnId(id) || ids.has(id) || !isChartName(name) || !isNumberColor(color)) return true
    if (!includes(NUMBER_LIT_WHEN, litWhen) || (litWhen === 'never' ? litAt !== undefined : !isNumberLitAt(litAt))) return true
    ids.add(id)
  }
  return false
}

/** A stored Breakdown's column filters by their path in its config (`columns.0.filter`, …): the caller checks each as a predicate. */
export function breakdownColumnFilters(raw: Obj): Array<[string, unknown]> {
  if (!Array.isArray(raw.columns)) return []
  return (raw.columns as unknown[]).map((c, i): [string, unknown] => [`columns.${i}.filter`, typeof c === 'object' && c !== null ? (c as Obj).filter : undefined])
}

/**
 * A Breakdown's config read from untrusted input, `filter` already picked:
 * a bad or missing field gets its default (`fixed`) — the name
 * `Breakdown`, split by people, bars, counts, the none row shown —; a name
 * past the limit is cut to it (`shortened`, `readStoredName`); an
 * `oldestBy` that isn't one (or without `oldest`), or a `badges` /
 * `checkins` an earlier build stored (v79 rewrote them), is dropped
 * (`fixed`).
 */
export function pickBreakdownConfig(raw: Obj, filter: PickedConfig<TodoPredicate>, readPredicate: NumberPredicateRead): PickedConfig<BreakdownConfig> {
  let fixed = filter.fixed
  const pick = <V,>(v: unknown, ok: (v: unknown) => v is V, fallback: V): V => {
    if (ok(v)) return v
    fixed = true
    return fallback
  }
  const named = readStoredName(raw.name, CHART_NAME_MAX)
  if (!named) fixed = true
  const config: BreakdownConfig = {
    name: named ? named.name : DEFAULT_BREAKDOWN_NAME,
    filter: filter.config,
    splitBy: pick(raw.splitBy, (v): v is BreakdownSplit => includes(BREAKDOWN_SPLITS, v), 'people'),
    style: pick(raw.style, (v): v is BreakdownStyle => includes(BREAKDOWN_STYLES, v), 'bars'),
    show: pick(raw.show, (v): v is BreakdownShow => includes(BREAKDOWN_SHOWS, v), 'count'),
    showNone: pick(raw.showNone, isBool, true),
  }
  if (config.show === 'oldest' && includes(BREAKDOWN_OLDEST_BY, raw.oldestBy)) config.oldestBy = raw.oldestBy
  else if (raw.oldestBy !== undefined) fixed = true
  // What earlier builds stored and v79 rewrote (`badges` as `columns`) or removed (`checkins`): one left is dropped.
  if (raw.badges !== undefined || raw.checkins !== undefined) fixed = true
  if (Array.isArray(raw.columns)) {
    const picked = pickColumns(raw.columns as unknown[], readPredicate)
    config.columns = picked.config
    if (picked.fixed) fixed = true
  } else if (raw.columns !== undefined) fixed = true
  return named?.cut ? { config, fixed, shortened: true } : { config, fixed }
}

/**
 * Count columns read from untrusted input: the first `BREAKDOWN_COLUMNS_MAX`,
 * each filter read as a Number's; a bad or repeated id gets a new one, a bad
 * name a blank one, a bad colour the Due magenta, a bad rule above 0 (`fixed`
 * on any change).
 */
function pickColumns(raw: readonly unknown[], readPredicate: NumberPredicateRead): PickedConfig<BreakdownColumn[]> {
  let fixed = raw.length > BREAKDOWN_COLUMNS_MAX
  const columns: BreakdownColumn[] = []
  for (const c of raw.slice(0, BREAKDOWN_COLUMNS_MAX)) {
    const col = (typeof c === 'object' && c !== null && !Array.isArray(c) ? c : {}) as Obj
    const filter = readPredicate(col.filter)
    const fresh = isBreakdownColumnId(col.id) && !columns.some((k) => k.id === col.id)
    const id = fresh ? (col.id as string) : newBreakdownColumnId(columns)
    const name = isChartName(col.name) ? col.name : ''
    const color = isNumberColor(col.color) ? col.color : DUE_COLUMN_COLOR
    const litWhen: NumberLitWhen = includes(NUMBER_LIT_WHEN, col.litWhen) ? col.litWhen : 'above'
    const column: BreakdownColumn = { id, name, color, filter: filter.config, litWhen }
    if (litWhen !== 'never') column.litAt = isNumberLitAt(col.litAt) ? col.litAt : 0
    if (filter.fixed || !fresh || name !== col.name || color !== col.color || litWhen !== col.litWhen || column.litAt !== col.litAt) fixed = true
    columns.push(column)
  }
  return { config: columns, fixed }
}

function isBreakdownSort(v: unknown): v is BreakdownSort {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const { by, reversed, ...rest } = v as Obj
  return Object.keys(rest).length === 0 && isSortKey(by) && (reversed === undefined || reversed === true)
}

/** Where a stored Breakdown view state goes wrong: the bad key, or `null`. */
export function breakdownViewProblem(raw: Obj): string | null {
  if (raw.ignoreLens !== undefined && typeof raw.ignoreLens !== 'boolean') return 'ignoreLens'
  const sorts = raw.sorts
  if (sorts === undefined) return null
  if (typeof sorts !== 'object' || sorts === null || Array.isArray(sorts)) return 'sorts'
  for (const [split, sort] of Object.entries(sorts as Obj)) {
    if (!includes(BREAKDOWN_SPLITS, split) || !isBreakdownSort(sort)) return `sorts.${split}`
  }
  return null
}

/** A Breakdown's view state read from untrusted input: each known split's valid sort and the lens switch (`fixed` when one is dropped). */
export function pickBreakdownView(raw: Obj | undefined): PickedConfig<BreakdownViewState | undefined> {
  if (raw === undefined) return { config: undefined, fixed: false }
  let fixed = Object.keys(raw).some((k) => k !== 'sorts' && k !== 'ignoreLens')
  const view: BreakdownViewState = {}
  if (typeof raw.ignoreLens === 'boolean') view.ignoreLens = raw.ignoreLens
  else if (raw.ignoreLens !== undefined) fixed = true
  const sorts = raw.sorts
  if (typeof sorts === 'object' && sorts !== null && !Array.isArray(sorts)) {
    const kept: Partial<Record<BreakdownSplit, BreakdownSort>> = {}
    for (const [split, sort] of Object.entries(sorts as Obj)) {
      if (includes(BREAKDOWN_SPLITS, split) && isBreakdownSort(sort)) kept[split] = sort.reversed ? { by: sort.by, reversed: true } : { by: sort.by }
      else fixed = true
    }
    if (Object.keys(kept).length > 0) view.sorts = kept
  } else if (sorts !== undefined) fixed = true
  return { config: Object.keys(view).length > 0 ? view : undefined, fixed }
}

/** What an Add widget preset starts a Breakdown with: People, Tags and Status split every open task by theirs (as the widgets they replaced); Custom is a new Breakdown. */
export function breakdownPreset(preset: BreakdownPreset): Partial<BreakdownConfig> {
  switch (preset) {
    case 'people': return { name: 'People', splitBy: 'people' }
    case 'tags': return { name: 'Tags', splitBy: 'tags' }
    case 'status': return { name: 'Status', splitBy: 'status' }
    case 'custom': return {}
  }
}

// ── Pivot ───────────────────────────────────────────────────────────────────

/** What a Pivot's rows and columns split by: any Breakdown split. */
export type PivotDim = BreakdownSplit

/**
 * A Pivot (D26 P8, board Z1): the tasks a filter keeps split by two things
 * at once — a heat table of rows × columns with their totals.
 */
export interface PivotConfig {
  /** Its title (may be blank while typed: the tab then reads `Pivot`). */
  name: string
  filter: TodoPredicate
  rows: PivotDim
  cols: PivotDim
}

export const DEFAULT_PIVOT_NAME = 'Pivot'

/** A new Pivot: people × status. */
export function newPivotConfig(filter: TodoPredicate): PivotConfig {
  return { name: DEFAULT_PIVOT_NAME, filter, rows: 'people', cols: 'status' }
}

/**
 * The fixed headings a Pivot's rows sort by: the name (its corner heading)
 * and Total. Every other heading is a column, by its head's key
 * (`person-12`, `status-3`, `due-overdue`, `none`, …).
 */
export const PIVOT_FIXED_SORT_KEYS = ['name', 'total'] as const

/**
 * A heading a Pivot's rows are sorted by (view state, item 8): its key —
 * a fixed one (`PIVOT_FIXED_SORT_KEYS`) or a column head's — counts largest
 * first and names A–Z, or the reverse (`reversed`), as a Breakdown's. A
 * sort by a column the Pivot no longer shows reads as the natural order.
 */
export type PivotSort = BreakdownSort

/** A Pivot tab's view state: its rows' sort (absent = the natural order) and its lens switch, each saved at once. */
export interface PivotViewState {
  sort?: PivotSort
  /** The top bar's lens doesn't apply here (the widget's lens switch, saved at once; absent = it applies). */
  ignoreLens?: boolean
}

/** A stored Pivot sort: a fixed heading's key or a column head's (short word characters), `reversed` only as `true`. */
function isPivotSort(v: unknown): v is PivotSort {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const { by, reversed, ...rest } = v as Obj
  return Object.keys(rest).length === 0 && typeof by === 'string' && COLUMN_ID.test(by) && (reversed === undefined || reversed === true)
}

/** Where a stored Pivot view state goes wrong: the bad key, or `null`. */
export function pivotViewProblem(raw: Obj): string | null {
  if (raw.ignoreLens !== undefined && typeof raw.ignoreLens !== 'boolean') return 'ignoreLens'
  if (raw.sort !== undefined && !isPivotSort(raw.sort)) return 'sort'
  return null
}

/** A Pivot's view state read from untrusted input: its valid sort and lens switch (`fixed` when anything is dropped). */
export function pickPivotView(raw: Obj | undefined): PickedConfig<PivotViewState | undefined> {
  if (raw === undefined) return { config: undefined, fixed: false }
  let fixed = Object.keys(raw).some((k) => k !== 'sort' && k !== 'ignoreLens')
  const view: PivotViewState = {}
  if (typeof raw.ignoreLens === 'boolean') view.ignoreLens = raw.ignoreLens
  else if (raw.ignoreLens !== undefined) fixed = true
  if (isPivotSort(raw.sort)) view.sort = raw.sort.reversed ? { by: raw.sort.by, reversed: true } : { by: raw.sort.by }
  else if (raw.sort !== undefined) fixed = true
  return { config: Object.keys(view).length > 0 ? view : undefined, fixed }
}

const isSplit = (v: unknown): v is BreakdownSplit => includes(BREAKDOWN_SPLITS, v)

/** Where a stored Pivot config goes wrong (the filter is the caller's): the bad key, or `null`. */
export function pivotConfigProblem(raw: Obj): string | null {
  if (!isChartName(raw.name)) return 'name'
  if (!isSplit(raw.rows)) return 'rows'
  if (!isSplit(raw.cols)) return 'cols'
  return null
}

/** A Pivot's config from untrusted input, `filter` picked: a bad field gets its default (people × status, `fixed`); a name past the limit is cut to it (`shortened`). */
export function pickPivotConfig(raw: Obj, filter: PickedConfig<TodoPredicate>): PickedConfig<PivotConfig> {
  let fixed = filter.fixed
  const pick = <V,>(v: unknown, ok: (v: unknown) => v is V, fallback: V): V => {
    if (ok(v)) return v
    fixed = true
    return fallback
  }
  const named = readStoredName(raw.name, CHART_NAME_MAX)
  if (!named) fixed = true
  const config: PivotConfig = {
    name: named ? named.name : DEFAULT_PIVOT_NAME,
    filter: filter.config,
    rows: pick(raw.rows, isSplit, 'people'),
    cols: pick(raw.cols, isSplit, 'status'),
  }
  return named?.cut ? { config, fixed, shortened: true } : { config, fixed }
}
