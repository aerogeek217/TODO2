import type { TrendShow } from '../../../models/glance-widgets'
import { trendBucketDays, trendCumulative, type TrendStats } from '../../../services/stats/trend'
import { escapeHtml } from '../../../utils/html'

/** A glance widget's lines as text, for its tab menu's Copy. */
export interface GlanceSummary {
  plain: string
  /** The body (unwrapped) — the clipboard path adds the font wrapper. */
  html: string
}

/** One `Label count` of a summary line. */
export interface SummaryPart {
  label: string
  count: string
}

// ── A glance widget's lines (its tab menu's Copy) ────────────────────────────
// Each starts with the widget's title and its headline count, then the
// line its count makes, or its parts.

/** What Created vs completed's Copy reads. */
export interface TrendLinesInput {
  /** Its title. */
  name: string
  /** `Last 14 days`. */
  rangeLabel: string
  show: TrendShow
  /** `null` until the history has been read. */
  trend: TrendStats | null
  /** The first day (index) whose counts are exact; a bar or point before it is marked ≈. */
  exactFrom: number
  /** Each bar's name in words (`Thu 8`, `Week of Sep 28`). */
  bucketLabels: readonly string[]
  signedNet: (n: number) => string
}

/**
 * Created vs completed's lines, as the presentation shown reads: its name
 * and range, then its totals, then a line per bar (per week on the weekly
 * ranges), a bar the log can't count exactly marked ≈ —
 * Bars: `Completed 5 · Created 8 · Net +3`, `Thu 8 2 created · 1 completed`;
 * Burndown: `Open at the start 34 · Open now 21 · Change −13`, `Thu 8 30 open`;
 * Cumulative: `Open at the start 34 · Created 8 · Completed 5`, `Thu 8 36 created · 2 completed` (running totals).
 */
export function trendLines({ name, rangeLabel, show, trend, exactFrom, bucketLabels, signedNet }: TrendLinesInput): SummaryPart[][] {
  const head: SummaryPart[] = [{ label: name, count: rangeLabel }]
  if (!trend) return [head]
  const buckets = trendBucketDays(trend.window)
  const label = (i: number) => {
    const days = buckets[i]
    return `${bucketLabels[i] ?? ''}${days && days.first < exactFrom ? ' ≈' : ''}`
  }
  if (show === 'burndown') {
    return [
      head,
      [
        { label: 'Open at the start', count: String(trend.openAtStart) },
        { label: 'Open now', count: String(trend.openSeries.at(-1) ?? trend.openAtStart) },
        { label: 'Change', count: signedNet(trend.net) },
      ],
      ...buckets.map(({ last }, i) => [{ label: label(i), count: `${trend.openSeries[last] ?? 0} open` }]),
    ]
  }
  if (show === 'cumulative') {
    const cumulative = trendCumulative(trend)
    return [
      head,
      [
        { label: 'Open at the start', count: String(trend.openAtStart) },
        { label: 'Created', count: String(trend.created) },
        { label: 'Completed', count: String(trend.completed) },
      ],
      ...buckets.map(({ last }, i) => [{ label: label(i), count: `${cumulative.created[last] ?? 0} created · ${cumulative.completed[last] ?? 0} completed` }]),
    ]
  }
  return [
    head,
    [
      { label: 'Completed', count: String(trend.completed) },
      { label: 'Created', count: String(trend.created) },
      { label: 'Net', count: signedNet(trend.net) },
    ],
    ...trend.buckets.map((b, i) => [{ label: label(i), count: `${b.createdIds.length} created · ${b.completedIds.length} completed` }]),
  ]
}

/** A Number: `Overdue 3`, then its sub-line (when it has one). */
export function numberLines(label: string, count: string, sub: string): SummaryPart[][] {
  return [[{ label, count }], ...(sub ? [[{ label: sub, count: '' }]] : [])]
}

/**
 * Summary lines as text, for the clipboard: a line per `lines` entry (an
 * empty one skipped), its parts `Label count` joined by ` · ` — the label
 * bold in the HTML; a part with an empty count is its label alone.
 */
export function summaryOf(lines: readonly SummaryPart[][]): GlanceSummary {
  const kept = lines.filter((parts) => parts.length > 0)
  const text = (p: SummaryPart) => (p.count ? `${p.label} ${p.count}` : p.label)
  const html = (p: SummaryPart) => (p.count ? `<b>${escapeHtml(p.label)}</b> ${escapeHtml(p.count)}` : `<b>${escapeHtml(p.label)}</b>`)
  return {
    plain: kept.map((parts) => parts.map(text).join(' · ')).join('\n'),
    html: kept.map((parts) => `<p>${parts.map(html).join(' · ')}</p>`).join(''),
  }
}
