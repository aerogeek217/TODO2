/**
 * v78's Number conversion (D26 P5, `numbers`): what each v77 metric
 * becomes — its name, colour (the dark theme's token value at v77, a hex),
 * filter, lighting and comparison. Its own module with no imports, so the
 * dev seed (`scripts/dev-seed`) and the tests build converted Numbers
 * without the upgrade pipeline. Frozen: it goes on meaning this whatever
 * later builds do.
 */

type Obj = Record<string, unknown>

/** The v77 Number metrics. */
export const V77_NUMBER_METRICS = [
  'open', 'focus', 'urgent', 'overdue', 'followupDue', 'dueToday', 'dueNext7', 'noFollowup', 'closedThisWeek',
] as const
export type V77NumberMetric = (typeof V77_NUMBER_METRICS)[number]

export function isV77Metric(v: unknown): v is V77NumberMetric {
  return (V77_NUMBER_METRICS as readonly unknown[]).includes(v)
}

/** The dark theme's colours (`tokens.css` at v77), as the metrics used them. */
const DARK = {
  danger: '#ee7d77',
  overdue: '#e86bf0',
  followup: '#f5c842',
  muted: '#8f8a83',
} as const

const rel = (token: string) => ({ kind: 'relative', token })
const range = (start: Obj | null, end: Obj | null) => ({ match: 'range', start, end })

/** A stored predicate with `patch` over no filter (every open task). */
function predicate(patch: Obj = {}): Obj {
  return { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null, ...patch }
}

interface MetricNumber {
  name: string
  /** A hex; absent = Auto. */
  color?: string
  filter: Obj
  lit: boolean
  compare: 'yesterday' | 'lastWeek'
}

/** What each metric becomes. */
const METRIC_NUMBERS: Record<V77NumberMetric, MetricNumber> = {
  open: { name: 'Open', filter: predicate(), lit: false, compare: 'yesterday' },
  focus: { name: 'Focus', filter: predicate({ markers: [{ values: ['focus'] }] }), lit: false, compare: 'yesterday' },
  urgent: { name: 'Urgent', color: DARK.danger, filter: predicate({ markers: [{ values: ['urgent'] }] }), lit: true, compare: 'yesterday' },
  overdue: { name: 'Overdue', color: DARK.overdue, filter: predicate({ dates: { deadline: range(null, rel('yesterday')) } }), lit: true, compare: 'yesterday' },
  followupDue: { name: 'Follow-up due', color: DARK.followup, filter: predicate({ dates: { followup: range(null, rel('today')) } }), lit: true, compare: 'yesterday' },
  dueToday: { name: 'Due today', color: DARK.overdue, filter: predicate({ dates: { deadline: range(rel('today'), rel('today')) } }), lit: true, compare: 'yesterday' },
  dueNext7: { name: 'Due in the next 7 days', color: DARK.overdue, filter: predicate({ dates: { deadline: range(rel('today'), { kind: 'offset', days: 6 }) } }), lit: false, compare: 'yesterday' },
  noFollowup: { name: 'No follow-up date', color: DARK.muted, filter: predicate({ dates: { followup: { match: 'unset' } } }), lit: false, compare: 'yesterday' },
  closedThisWeek: { name: 'Closed this week', filter: predicate({ dates: { completed: range(rel('start-of-week'), rel('today')) } }), lit: false, compare: 'lastWeek' },
}

/** The v78 Number config of a v77 metric (`breakdown` kept when given). */
export function numberConfigOfMetric(metric: V77NumberMetric, breakdown?: unknown): Obj {
  const m = METRIC_NUMBERS[metric]
  return {
    name: m.name,
    ...(m.color ? { color: m.color } : {}),
    filter: structuredClone(m.filter),
    show: 'count',
    litWhen: m.lit ? 'above' : 'never',
    ...(m.lit ? { litAt: 0 } : {}),
    compare: m.compare,
    ...(breakdown !== undefined ? { breakdown } : {}),
  }
}
