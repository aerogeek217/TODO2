/**
 * The chart widgets' settings (D26 P8, board Z1): a filter, then what it is
 * split by. **Breakdown** (`breakdown`) splits the tasks a filter keeps by
 * one thing — people, tags, status, priority, due date or age — and
 * replaced People, Tags and Status, which are its presets now. Each config
 * here, its defaults, and the pickers that read it from untrusted input (a
 * stored layout, an import).
 */

import { NUMBER_NAME_MAX, type PickedConfig } from './glance-widgets'
import type { ListTabBadges } from './list-definition'
import type { TodoPredicate } from './filter-predicate'

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
   * The Due and Follow-up columns' ranges, as a list's own tab badges
   * (`ListDefinition.tabBadges`: `off`, or its ranges); absent = Settings ›
   * Tasks' ranges.
   */
  badges?: ListTabBadges
}

/** The Add widget presets of a Breakdown (D26 P8 / Z3). */
export const BREAKDOWN_PRESETS = ['people', 'tags', 'status', 'waiting', 'custom'] as const
export type BreakdownPreset = (typeof BREAKDOWN_PRESETS)[number]

export const BREAKDOWN_PRESET_LABELS: Record<BreakdownPreset, string> = {
  people: 'People',
  tags: 'Tags',
  status: 'Status',
  waiting: 'Waiting on',
  custom: 'Custom',
}

/** The status Waiting on filters by: the dev seed's name, matched without case. */
export const WAITING_STATUS_NAME = 'Waiting'

/** A new Breakdown's name. */
export const DEFAULT_BREAKDOWN_NAME = 'Breakdown'

/** A new Breakdown: its filter as given, split by people, bars, counts, the none row shown. */
export function newBreakdownConfig(filter: TodoPredicate, patch: Partial<BreakdownConfig> = {}): BreakdownConfig {
  return { name: DEFAULT_BREAKDOWN_NAME, filter, splitBy: 'people', style: 'bars', show: 'count', showNone: true, ...patch }
}

/** The headings a Breakdown's rows sort by: the name, Open (or Oldest), Priority, Due, Follow-up. */
export const BREAKDOWN_SORT_KEYS = ['name', 'open', 'priority', 'due', 'followup'] as const
export type BreakdownSortKey = (typeof BREAKDOWN_SORT_KEYS)[number]

/**
 * A heading a Breakdown is sorted by (view state, one per split): counts
 * largest first and names A–Z, or the reverse (`reversed`).
 */
export interface BreakdownSort {
  by: BreakdownSortKey
  reversed?: true
}

/** A Breakdown tab's view state: each split's sort, saved at once (absent = the split's default order). */
export interface BreakdownViewState {
  sorts?: Partial<Record<BreakdownSplit, BreakdownSort>>
}

const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

/** A stored badge override: `off`, or a pair of ranges (`off`, `overdue` or a day count 0 – 365). */
export function isBadgeOverride(v: unknown): v is ListTabBadges {
  if (v === 'off') return true
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const { due, followup, ...rest } = v as Obj
  return Object.keys(rest).length === 0 && isBadgeRange(due) && isBadgeRange(followup)
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
  return null
}

/**
 * A Breakdown's config read from untrusted input, `filter` already picked:
 * a bad or missing field gets its default (`fixed`) — the name
 * `Breakdown`, split by people, bars, counts, the none row shown —; an
 * `oldestBy` that isn't one (or without `oldest`), a non-true `checkins`
 * or a bad badge override is dropped (`fixed`).
 */
export function pickBreakdownConfig(raw: Obj, filter: PickedConfig<TodoPredicate>): PickedConfig<BreakdownConfig> {
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
  return { config, fixed }
}

function isBreakdownSort(v: unknown): v is BreakdownSort {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const { by, reversed, ...rest } = v as Obj
  return Object.keys(rest).length === 0 && includes(BREAKDOWN_SORT_KEYS, by) && (reversed === undefined || reversed === true)
}

/** Where a stored Breakdown view state goes wrong: the bad key, or `null`. */
export function breakdownViewProblem(raw: Obj): string | null {
  const sorts = raw.sorts
  if (sorts === undefined) return null
  if (typeof sorts !== 'object' || sorts === null || Array.isArray(sorts)) return 'sorts'
  for (const [split, sort] of Object.entries(sorts as Obj)) {
    if (!includes(BREAKDOWN_SPLITS, split) || !isBreakdownSort(sort)) return `sorts.${split}`
  }
  return null
}

/** A Breakdown's view state read from untrusted input: each known split's valid sort (`fixed` when one is dropped). */
export function pickBreakdownView(raw: Obj | undefined): PickedConfig<BreakdownViewState | undefined> {
  if (raw === undefined) return { config: undefined, fixed: false }
  const sorts = raw.sorts
  if (sorts === undefined) return { config: undefined, fixed: Object.keys(raw).length > 0 }
  if (typeof sorts !== 'object' || sorts === null || Array.isArray(sorts)) return { config: undefined, fixed: true }
  let fixed = Object.keys(raw).some((k) => k !== 'sorts')
  const kept: Partial<Record<BreakdownSplit, BreakdownSort>> = {}
  for (const [split, sort] of Object.entries(sorts as Obj)) {
    if (includes(BREAKDOWN_SPLITS, split) && isBreakdownSort(sort)) kept[split] = sort.reversed ? { by: sort.by, reversed: true } : { by: sort.by }
    else fixed = true
  }
  return { config: Object.keys(kept).length > 0 ? { sorts: kept } : undefined, fixed }
}

/** A preset's config and, when it needs a pick first, the filter field its editor opens on. */
export interface BreakdownPresetSeed {
  config: Partial<BreakdownConfig>
  /** Waiting on with no status named Waiting: its editor opens the Status picker. */
  startField?: 'status'
}

/**
 * What an Add widget preset starts a Breakdown with: People, Tags and
 * Status split every open task by theirs (as the widgets they replaced);
 * Waiting on (board Z3) keeps the tasks of the status named Waiting
 * (`WAITING_STATUS_NAME`), split by people, each row's oldest by its last
 * follow-up, with the check-in envelope — with no such status, its filter
 * starts empty and its editor opens the Status picker; Custom is a new
 * Breakdown.
 */
export function breakdownPreset(
  preset: BreakdownPreset,
  statuses: readonly { id?: number; name: string }[],
  filter: () => TodoPredicate,
): BreakdownPresetSeed {
  switch (preset) {
    case 'people': return { config: { name: 'People', splitBy: 'people' } }
    case 'tags': return { config: { name: 'Tags', splitBy: 'tags' } }
    case 'status': return { config: { name: 'Status', splitBy: 'status' } }
    case 'custom': return { config: {} }
    case 'waiting': {
      const waiting = statuses.find((s) => s.id != null && s.name.trim().toLowerCase() === WAITING_STATUS_NAME.toLowerCase())
      const config: Partial<BreakdownConfig> = {
        name: BREAKDOWN_PRESET_LABELS.waiting,
        splitBy: 'people',
        show: 'oldest',
        oldestBy: 'lastFollowup',
        checkins: true,
        filter: waiting?.id != null ? { ...filter(), statusIds: [waiting.id] } : filter(),
      }
      return waiting ? { config } : { config, startField: 'status' }
    }
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
