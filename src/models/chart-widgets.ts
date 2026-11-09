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
  /** Each person row has the check-in envelope (people only); stored only when true. */
  checkins?: true
  /**
   * Its count columns (board BC): up to `BREAKDOWN_COLUMNS_MAX`, each a
   * name, a colour and a filter; a row's cell counts that row's tasks the
   * filter keeps. Absent (a config from before them): the two read from
   * `badges` (`breakdownColumns`) — written as `columns` once they are edited.
   */
  columns?: BreakdownColumn[]
  /**
   * What stored the Due and Follow-up columns before count columns
   * (`ChartBadges`): `off`, or its own range for either or both — a range it
   * doesn't hold, like an absent `badges`, is Settings › Tasks' and follows
   * it. Read only while `columns` is absent (`breakdownColumns`); dropped
   * when they are written.
   */
  badges?: ChartBadges
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

/**
 * The columns read from `badges`: their ids, names and colours. A sort
 * stored by the old Due / Follow-up columns (`due`, `followup` — overdue
 * included) reads as the late one (`liveBreakdownSort`), so the soon / due
 * columns have ids of their own.
 */
export const OVERDUE_COLUMN_ID = 'overdue'
export const DUE_COLUMN_ID = 'due-soon'
export const FOLLOWUP_LATE_COLUMN_ID = 'followup-late'
export const FOLLOWUP_COLUMN_ID = 'followup-due'
/** The old Due / Follow-up columns' sort keys → the derived column that keeps their most urgent tasks. */
const LEGACY_SORT_COLUMNS: Readonly<Record<string, string>> = { due: OVERDUE_COLUMN_ID, followup: FOLLOWUP_LATE_COLUMN_ID }
/** The derived due columns' colour: the due date's magenta (the dark theme's `--color-overdue`). */
export const DUE_COLUMN_COLOR = '#e86bf0'
/** The derived follow-up columns' colour: the follow-up yellow (the dark theme's `--color-followup`). */
export const FOLLOWUP_COLUMN_COLOR = '#f5c842'

/** A date range on `field`, from `start` to `end` days from today (`null`: open). */
function rangeFilter(field: 'deadline' | 'followup', start: number | null, end: number): TodoPredicate {
  return {
    ...emptyPredicate(),
    dates: { [field]: { match: 'range', start: start == null ? null : { kind: 'offset', days: start }, end: { kind: 'offset', days: end } } },
  }
}

/** A date's two columns from its old range: late (before today, lit above 0) and, with a day count N, due (today … today + N, never lit). */
function rangeColumns(
  range: TabBadgeRange,
  field: 'deadline' | 'followup',
  late: { id: string; name: string },
  soon: { id: string; name: string },
  color: string,
): BreakdownColumn[] {
  if (range === 'off') return []
  const out: BreakdownColumn[] = [{ ...late, color, filter: rangeFilter(field, null, -1), litWhen: 'above', litAt: 0 }]
  if (range !== 'overdue') out.push({ ...soon, color, filter: rangeFilter(field, 0, range), litWhen: 'never' })
  return out
}

/**
 * The count columns of a config without `columns` (no schema step; a new
 * Breakdown too), from the ranges `badges` says (`chartBadgeRanges`: its
 * own, each one it doesn't hold Settings'): the old Due column as Overdue
 * (lit above 0) and Due soon (today … today + N, never lit), the
 * Follow-up column likewise as Follow-up late and Follow-up due — a range
 * `off` drops both of its columns, `overdue` keeps only the late one,
 * so the solid count still says something is late.
 */
export function derivedBreakdownColumns(badges: ChartBadges | undefined, app: TabBadgeRanges): BreakdownColumn[] {
  const ranges = chartBadgeRanges(badges, app)
  return [
    ...rangeColumns(ranges.due, 'deadline', { id: OVERDUE_COLUMN_ID, name: 'Overdue' }, { id: DUE_COLUMN_ID, name: 'Due soon' }, DUE_COLUMN_COLOR),
    ...rangeColumns(ranges.followup, 'followup', { id: FOLLOWUP_LATE_COLUMN_ID, name: 'Follow-up late' }, { id: FOLLOWUP_COLUMN_ID, name: 'Follow-up due' }, FOLLOWUP_COLUMN_COLOR),
  ]
}

/** A Breakdown's count columns: its own, else the ones its `badges` say (`derivedBreakdownColumns`). */
export function breakdownColumns(config: Pick<BreakdownConfig, 'columns' | 'badges'>, app: TabBadgeRanges): readonly BreakdownColumn[] {
  return config.columns ?? derivedBreakdownColumns(config.badges, app)
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

/**
 * A Breakdown's own Due / Follow-up ranges: `off` (both), or each range on
 * its own (at least one) — the other Settings'. A list's `tabBadges` pair
 * (what P8 stored) is one of these.
 */
export type ChartBadges = 'off' | Partial<TabBadgeRanges>

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

/** The fixed headings a Breakdown's rows sort by: the name, Open (or Oldest), Priority. */
export const BREAKDOWN_FIXED_SORT_KEYS = ['name', 'open', 'priority'] as const

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
 * a fixed heading or one of its columns as stored; the old Due / Follow-up
 * columns' key (`due`, `followup`), while no column has it, as the late
 * column (`Overdue`, `Follow-up late`) in the same direction, so "Most due
 * first" still puts the overdue on top; any other: `undefined`, the
 * split's default order.
 */
export function liveBreakdownSort(sort: BreakdownSort | undefined, columnIds: readonly string[]): BreakdownSort | undefined {
  if (!sort) return undefined
  if ((BREAKDOWN_FIXED_SORT_KEYS as readonly string[]).includes(sort.by) || columnIds.includes(sort.by)) return sort
  const late = LEGACY_SORT_COLUMNS[sort.by]
  return late != null && columnIds.includes(late) ? { ...sort, by: late } : undefined
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

/** A stored badge override: `off`, or a due and / or follow-up range (`off`, `overdue` or a day count 0 – 365). */
export function isBadgeOverride(v: unknown): v is ChartBadges {
  if (v === 'off') return true
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const { due, followup, ...rest } = v as Obj
  if (Object.keys(rest).length > 0 || (due === undefined && followup === undefined)) return false
  return (due === undefined || isBadgeRange(due)) && (followup === undefined || isBadgeRange(followup))
}

/** The ranges a Breakdown counts in: its own (`ChartBadges`), each range it doesn't hold Settings' (`app`). */
export function chartBadgeRanges(own: ChartBadges | undefined, app: TabBadgeRanges): TabBadgeRanges {
  if (own === 'off') return { due: 'off', followup: 'off' }
  return { due: own?.due ?? app.due, followup: own?.followup ?? app.followup }
}

function isBadgeRange(v: unknown): boolean {
  return v === 'off' || v === 'overdue' || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 365)
}

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
  if (raw.checkins !== undefined && raw.checkins !== true) return 'checkins'
  if (raw.badges !== undefined && !isBadgeOverride(raw.badges)) return 'badges'
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
 * `Breakdown`, split by people, bars, counts, the none row shown —; an
 * `oldestBy` that isn't one (or without `oldest`), a non-true `checkins`
 * or a bad badge override is dropped (`fixed`).
 */
export function pickBreakdownConfig(raw: Obj, filter: PickedConfig<TodoPredicate>, readPredicate: NumberPredicateRead): PickedConfig<BreakdownConfig> {
  let fixed = filter.fixed
  const pick = <V,>(v: unknown, ok: (v: unknown) => v is V, fallback: V): V => {
    if (ok(v)) return v
    fixed = true
    return fallback
  }
  const config: BreakdownConfig = {
    name: pick(raw.name, isChartName, DEFAULT_BREAKDOWN_NAME),
    filter: filter.config,
    splitBy: pick(raw.splitBy, (v): v is BreakdownSplit => includes(BREAKDOWN_SPLITS, v), 'people'),
    style: pick(raw.style, (v): v is BreakdownStyle => includes(BREAKDOWN_STYLES, v), 'bars'),
    show: pick(raw.show, (v): v is BreakdownShow => includes(BREAKDOWN_SHOWS, v), 'count'),
    showNone: pick(raw.showNone, isBool, true),
  }
  if (config.show === 'oldest' && includes(BREAKDOWN_OLDEST_BY, raw.oldestBy)) config.oldestBy = raw.oldestBy
  else if (raw.oldestBy !== undefined) fixed = true
  if (raw.checkins === true) config.checkins = true
  else if (raw.checkins !== undefined) fixed = true
  if (isBadgeOverride(raw.badges)) config.badges = raw.badges
  else if (raw.badges !== undefined) fixed = true
  if (Array.isArray(raw.columns)) {
    const picked = pickColumns(raw.columns as unknown[], readPredicate)
    config.columns = picked.config
    if (picked.fixed) fixed = true
  } else if (raw.columns !== undefined) fixed = true
  return { config, fixed }
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

const isSplit = (v: unknown): v is BreakdownSplit => includes(BREAKDOWN_SPLITS, v)

/** Where a stored Pivot config goes wrong (the filter is the caller's): the bad key, or `null`. */
export function pivotConfigProblem(raw: Obj): string | null {
  if (!isChartName(raw.name)) return 'name'
  if (!isSplit(raw.rows)) return 'rows'
  if (!isSplit(raw.cols)) return 'cols'
  return null
}

/** A Pivot's config from untrusted input, `filter` picked: a bad field gets its default (people × status, `fixed`). */
export function pickPivotConfig(raw: Obj, filter: PickedConfig<TodoPredicate>): PickedConfig<PivotConfig> {
  let fixed = filter.fixed
  const pick = <V,>(v: unknown, ok: (v: unknown) => v is V, fallback: V): V => {
    if (ok(v)) return v
    fixed = true
    return fallback
  }
  return {
    config: {
      name: pick(raw.name, isChartName, DEFAULT_PIVOT_NAME),
      filter: filter.config,
      rows: pick(raw.rows, isSplit, 'people'),
      cols: pick(raw.cols, isSplit, 'status'),
    },
    fixed,
  }
}

// ── Tag map ─────────────────────────────────────────────────────────────────

/**
 * A Tag map (D26 P8, board Z1): a tile per tag on the open tasks a filter
 * keeps, sized by its open tasks and coloured by its share that is late.
 */
export interface TagMapConfig {
  /** Its title (blank while typed: the tab then reads `Tag map`). */
  name: string
  filter: TodoPredicate
  /** The tags it maps, in pick order; absent = every tag on a task, and No tags. */
  tagIds?: number[]
}

export const DEFAULT_TAG_MAP_NAME = 'Tag map'

/** A new Tag map: every tag. */
export function newTagMapConfig(filter: TodoPredicate): TagMapConfig {
  return { name: DEFAULT_TAG_MAP_NAME, filter }
}

const isIdList = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x))

/** Where a stored Tag map config goes wrong (the filter is the caller's): the bad key, or `null`. */
export function tagMapConfigProblem(raw: Obj): string | null {
  if (!isChartName(raw.name)) return 'name'
  if (raw.tagIds !== undefined && (!isIdList(raw.tagIds) || new Set(raw.tagIds).size !== raw.tagIds.length)) return 'tagIds'
  return null
}

/** A Tag map's config from untrusted input, `filter` picked: a bad name is reset; the picks keep their numbers once each (`fixed` on any change). */
export function pickTagMapConfig(raw: Obj, filter: PickedConfig<TodoPredicate>): PickedConfig<TagMapConfig> {
  let fixed = filter.fixed
  const name = isChartName(raw.name) ? raw.name : DEFAULT_TAG_MAP_NAME
  if (name !== raw.name) fixed = true
  const config: TagMapConfig = { name, filter: filter.config }
  if (Array.isArray(raw.tagIds)) {
    const ids = [...new Set((raw.tagIds as unknown[]).filter((x): x is number => typeof x === 'number' && Number.isFinite(x)))]
    if (ids.length !== raw.tagIds.length) fixed = true
    config.tagIds = ids
  } else if (raw.tagIds !== undefined) fixed = true
  return { config, fixed }
}
