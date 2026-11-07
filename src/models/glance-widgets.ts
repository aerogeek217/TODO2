/**
 * The glance widgets' settings (D25 N): a Number's metric and each section
 * widget's options — the choices a tab menu (and the Dashboard's Customize)
 * offers, their defaults, and the pickers that read them from untrusted
 * input (a stored layout, an import). Shared by the glance widget kinds and
 * the Dashboard's sections, which read the same options.
 */

type Obj = Record<string, unknown>

function includes<T extends string | number>(list: readonly T[], v: unknown): v is T {
  return (list as readonly unknown[]).includes(v)
}

// ── Numbers ─────────────────────────────────────────────────────────────────

/** The Dashboard's built-in tiles, in catalog order: every one is a Number metric too. */
export const TILE_METRIC_IDS = [
  'open', 'focus', 'urgent', 'overdue', 'followupDue', 'dueToday', 'dueNext7', 'noFollowup',
] as const
export type TileMetricId = (typeof TILE_METRIC_IDS)[number]

/** What a Number widget counts: a tile's count, or the tasks closed this week. */
export const NUMBER_METRICS = [...TILE_METRIC_IDS, 'closedThisWeek'] as const
export type NumberMetric = (typeof NUMBER_METRICS)[number]

/** A new Number counts the late tasks. */
export const DEFAULT_NUMBER_METRIC: NumberMetric = 'overdue'

/** Each metric's name: its tile's label, its menu choice, its tab title. */
export const NUMBER_METRIC_LABELS: Record<NumberMetric, string> = {
  open: 'Open',
  focus: 'Focus',
  urgent: 'Urgent',
  overdue: 'Overdue',
  followupDue: 'Follow-up due',
  dueToday: 'Due today',
  dueNext7: 'Due in the next 7 days',
  noFollowup: 'No follow-up date',
  closedThisWeek: 'Closed this week',
}

export function isNumberMetric(v: unknown): v is NumberMetric {
  return includes(NUMBER_METRICS, v)
}

export function isTileMetric(v: unknown): v is TileMetricId {
  return includes(TILE_METRIC_IDS, v)
}

// ── Section options ─────────────────────────────────────────────────────────

/** Needs follow-up: how many days ahead (starting today) it looks. */
export const LOOK_AHEAD_CHOICES = [3, 7, 14] as const
export type LookAhead = (typeof LOOK_AHEAD_CHOICES)[number]

/** Created vs completed: 14 days (daily bars) or 4 / 12 weeks (weekly bars). */
export const TREND_RANGES = ['14d', '4w', '12w'] as const
export type TrendRange = (typeof TREND_RANGES)[number]

/** Stale tasks: open tasks not changed in this many days or more. */
export const STALE_DAYS_CHOICES = [7, 14, 30, 60] as const
export type StaleDays = (typeof STALE_DAYS_CHOICES)[number]

/** Recently completed: tasks completed today and the days before it, this many days in all. */
export const RECENT_DAYS_CHOICES = [7, 14, 30] as const
export type RecentDays = (typeof RECENT_DAYS_CHOICES)[number]

export const DEFAULT_LOOK_AHEAD: LookAhead = 7
export const DEFAULT_TREND_RANGE: TrendRange = '14d'
export const DEFAULT_STALE_DAYS: StaleDays = 14
export const DEFAULT_RECENT_DAYS: RecentDays = 7

/** The sections, in catalog order (a Dashboard's section ids). */
export const SECTION_IDS = [
  'followup', 'next7', 'trend', 'status', 'people', 'tags', 'stale', 'recent', 'eisenhower',
] as const
export type SectionId = (typeof SECTION_IDS)[number]

/** Section options; each belongs to one section (others ignore it). */
export interface SectionOptions {
  /** Needs follow-up (default 7). */
  lookAhead?: LookAhead
  /** Created vs completed (default `14d`). */
  range?: TrendRange
  /** People: show the Unassigned row (default `true`). */
  showUnassigned?: boolean
  /** Tags: show the No tag row (default `true`). */
  showUntagged?: boolean
  /** Stale tasks (default 14). */
  staleDays?: StaleDays
  /** Recently completed (default 7). */
  recentDays?: RecentDays
}

/** The section's known options (each section has its own); `undefined` for none. */
export function pickSectionOptions(id: SectionId, raw: unknown): SectionOptions | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Obj
  const out: SectionOptions = {}
  if (id === 'followup' && includes(LOOK_AHEAD_CHOICES, r.lookAhead)) out.lookAhead = r.lookAhead
  if (id === 'trend' && includes(TREND_RANGES, r.range)) out.range = r.range
  if (id === 'people' && typeof r.showUnassigned === 'boolean') out.showUnassigned = r.showUnassigned
  if (id === 'tags' && typeof r.showUntagged === 'boolean') out.showUntagged = r.showUntagged
  if (id === 'stale' && includes(STALE_DAYS_CHOICES, r.staleDays)) out.staleDays = r.staleDays
  if (id === 'recent' && includes(RECENT_DAYS_CHOICES, r.recentDays)) out.recentDays = r.recentDays
  return Object.keys(out).length > 0 ? out : undefined
}

// ── The glance widget kinds' configs ────────────────────────────────────────

export interface NumberTabConfig {
  metric: NumberMetric
}

export interface FollowupTabConfig {
  lookAhead: LookAhead
}

export interface TrendTabConfig {
  range: TrendRange
}

export interface PeopleTabConfig {
  showUnassigned: boolean
}

export interface TagsTabConfig {
  showUntagged: boolean
}

export interface StaleTabConfig {
  staleDays: StaleDays
}

export interface RecentTabConfig {
  recentDays: RecentDays
}

/** A config read from untrusted input, and whether a bad or missing value was reset to its default. */
export interface PickedConfig<C> {
  config: C
  fixed: boolean
}

const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const isLookAhead = (v: unknown): v is LookAhead => includes(LOOK_AHEAD_CHOICES, v)
const isTrendRange = (v: unknown): v is TrendRange => includes(TREND_RANGES, v)
const isStaleDays = (v: unknown): v is StaleDays => includes(STALE_DAYS_CHOICES, v)
const isRecentDays = (v: unknown): v is RecentDays => includes(RECENT_DAYS_CHOICES, v)

/** `v` when `ok`, else `fallback` (and `fixed`). */
function pickOne<V>(v: unknown, ok: (v: unknown) => v is V, fallback: V): { value: V; fixed: boolean } {
  return ok(v) ? { value: v, fixed: false } : { value: fallback, fixed: true }
}

/** A Number's config: a known metric, else Overdue (`fixed`). */
export function pickNumberConfig(raw: Obj): PickedConfig<NumberTabConfig> {
  const { value, fixed } = pickOne(raw.metric, isNumberMetric, DEFAULT_NUMBER_METRIC)
  return { config: { metric: value }, fixed }
}

/** A Needs follow-up's config: a known look-ahead, else 7 days (`fixed`). */
export function pickFollowupConfig(raw: Obj): PickedConfig<FollowupTabConfig> {
  const { value, fixed } = pickOne(raw.lookAhead, isLookAhead, DEFAULT_LOOK_AHEAD)
  return { config: { lookAhead: value }, fixed }
}

/** A Created vs completed's config: a known range, else 14 days (`fixed`). */
export function pickTrendConfig(raw: Obj): PickedConfig<TrendTabConfig> {
  const { value, fixed } = pickOne(raw.range, isTrendRange, DEFAULT_TREND_RANGE)
  return { config: { range: value }, fixed }
}

/** A People's config: a boolean Unassigned row, else shown (`fixed`). */
export function pickPeopleConfig(raw: Obj): PickedConfig<PeopleTabConfig> {
  const { value, fixed } = pickOne(raw.showUnassigned, isBool, true)
  return { config: { showUnassigned: value }, fixed }
}

/** A Tags' config: a boolean No tag row, else shown (`fixed`). */
export function pickTagsConfig(raw: Obj): PickedConfig<TagsTabConfig> {
  const { value, fixed } = pickOne(raw.showUntagged, isBool, true)
  return { config: { showUntagged: value }, fixed }
}

/** A Stale tasks' config: a known threshold, else 14 days (`fixed`). */
export function pickStaleConfig(raw: Obj): PickedConfig<StaleTabConfig> {
  const { value, fixed } = pickOne(raw.staleDays, isStaleDays, DEFAULT_STALE_DAYS)
  return { config: { staleDays: value }, fixed }
}

/** A Recently completed's config: a known span, else 7 days (`fixed`). */
export function pickRecentConfig(raw: Obj): PickedConfig<RecentTabConfig> {
  const { value, fixed } = pickOne(raw.recentDays, isRecentDays, DEFAULT_RECENT_DAYS)
  return { config: { recentDays: value }, fixed }
}

/** Each glance kind's one config field and whether a stored value is one it keeps (the layout check). */
export const GLANCE_CONFIG_FIELDS = {
  number: { key: 'metric', ok: isNumberMetric },
  followup: { key: 'lookAhead', ok: isLookAhead },
  trend: { key: 'range', ok: isTrendRange },
  people: { key: 'showUnassigned', ok: isBool },
  tags: { key: 'showUntagged', ok: isBool },
  stale: { key: 'staleDays', ok: isStaleDays },
  recent: { key: 'recentDays', ok: isRecentDays },
} as const satisfies Record<string, { key: string; ok: (v: unknown) => boolean }>
