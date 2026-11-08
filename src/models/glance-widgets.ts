/**
 * The glance widgets' settings (D25 N): a Number's metric and each section
 * widget's options — the choices a tab menu offers, their defaults, and the
 * pickers that read them from untrusted input (a stored layout, an import).
 */

type Obj = Record<string, unknown>

function includes<T extends string | number>(list: readonly T[], v: unknown): v is T {
  return (list as readonly unknown[]).includes(v)
}

// ── Numbers ─────────────────────────────────────────────────────────────────

/** The metrics `services/stats/metrics` counts, in catalog order: every Number metric but Closed this week. */
export const METRIC_IDS = [
  'open', 'focus', 'urgent', 'overdue', 'followupDue', 'dueToday', 'dueNext7', 'noFollowup',
] as const
export type MetricId = (typeof METRIC_IDS)[number]

/** What a Number widget counts: a counted metric, or the tasks closed this week. */
export const NUMBER_METRICS = [...METRIC_IDS, 'closedThisWeek'] as const
export type NumberMetric = (typeof NUMBER_METRICS)[number]

/** A new Number counts the late tasks. */
export const DEFAULT_NUMBER_METRIC: NumberMetric = 'overdue'

/** Each metric's name: its Number's label, its menu choice, its tab title. */
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

export function isMetricId(v: unknown): v is MetricId {
  return includes(METRIC_IDS, v)
}

/** What a Number's large face breaks its tasks down by (D25 R): their people, their tags, or nothing. */
export const NUMBER_BREAKDOWNS = ['none', 'people', 'tags'] as const
export type NumberBreakdown = (typeof NUMBER_BREAKDOWNS)[number]

/** A Number shows no breakdown until one is picked (a config without one reads as this). */
export const DEFAULT_NUMBER_BREAKDOWN: NumberBreakdown = 'none'

/** Each breakdown's menu choice. */
export const NUMBER_BREAKDOWN_LABELS: Record<NumberBreakdown, string> = {
  none: 'None',
  people: 'By person',
  tags: 'By tag',
}

export function isNumberBreakdown(v: unknown): v is NumberBreakdown {
  return includes(NUMBER_BREAKDOWNS, v)
}

// ── Section options ─────────────────────────────────────────────────────────

/** Created vs completed: 14 days (daily bars) or 4 / 12 weeks (weekly bars). */
export const TREND_RANGES = ['14d', '4w', '12w'] as const
export type TrendRange = (typeof TREND_RANGES)[number]

export const DEFAULT_TREND_RANGE: TrendRange = '14d'

/** The sections, in catalog order: each a glance kind. */
export const SECTION_IDS = ['trend', 'status', 'people', 'tags'] as const
export type SectionId = (typeof SECTION_IDS)[number]

// ── The glance widget kinds' configs ────────────────────────────────────────

export interface NumberTabConfig {
  metric: NumberMetric
  /** Its large face's breakdown; absent = `none` (a tab from before P4 has none). */
  breakdown?: NumberBreakdown
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

/**
 * Project pulse: the tags it reads, in pick order (a card per tag). A new
 * tab picks the `Project: …` tags.
 */
export interface TagPicksTabConfig {
  tagIds: number[]
}

/** A config read from untrusted input, and whether a bad or missing value was reset to its default. */
export interface PickedConfig<C> {
  config: C
  fixed: boolean
}

const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const isTrendRange = (v: unknown): v is TrendRange => includes(TREND_RANGES, v)
const isTagId = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
/** A stored tag pick list: an array of numbers (a tag deleted since is kept; it just matches nothing). */
const isTagIds = (v: unknown): v is number[] => Array.isArray(v) && v.every(isTagId)

/** `v` when `ok`, else `fallback` (and `fixed`). */
function pickOne<V>(v: unknown, ok: (v: unknown) => v is V, fallback: V): { value: V; fixed: boolean } {
  return ok(v) ? { value: v, fixed: false } : { value: fallback, fixed: true }
}

/**
 * A Number's config: a known metric, else Overdue (`fixed`); a known
 * breakdown kept, an unknown one dropped (`fixed`: it reads as none).
 */
export function pickNumberConfig(raw: Obj): PickedConfig<NumberTabConfig> {
  const { value, fixed } = pickOne(raw.metric, isNumberMetric, DEFAULT_NUMBER_METRIC)
  if (isNumberBreakdown(raw.breakdown)) return { config: { metric: value, breakdown: raw.breakdown }, fixed }
  return { config: { metric: value }, fixed: fixed || raw.breakdown !== undefined }
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

/**
 * A Project pulse's config: its tag ids that are numbers,
 * each once, in order; not a list = none (`fixed`, as a dropped entry is).
 */
export function pickTagPicksConfig(raw: Obj): PickedConfig<TagPicksTabConfig> {
  const v = raw.tagIds
  if (!Array.isArray(v)) return { config: { tagIds: [] }, fixed: true }
  const tagIds = [...new Set((v as unknown[]).filter(isTagId))]
  return { config: { tagIds }, fixed: !isTagIds(v) }
}

/** Each glance kind's one config field and whether a stored value is one it keeps (the layout check). */
export const GLANCE_CONFIG_FIELDS = {
  number: { key: 'metric', ok: isNumberMetric },
  trend: { key: 'range', ok: isTrendRange },
  people: { key: 'showUnassigned', ok: isBool },
  tags: { key: 'showUntagged', ok: isBool },
  pulse: { key: 'tagIds', ok: isTagIds },
} as const satisfies Record<string, { key: string; ok: (v: unknown) => boolean }>
