import type { TrendStats } from '../../../services/stats/trend'
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

/** Created vs completed: `Created vs completed Last 14 days`, then `Completed 5 · Created 8 · Net +3`. */
export function trendLines(trend: TrendStats | null, rangeLabel: string, signedNet: (n: number) => string): SummaryPart[][] {
  if (!trend) return [[{ label: 'Created vs completed', count: rangeLabel }]]
  return [
    [{ label: 'Created vs completed', count: rangeLabel }],
    [
      { label: 'Completed', count: String(trend.completed) },
      { label: 'Created', count: String(trend.created) },
      { label: 'Net', count: signedNet(trend.net) },
    ],
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
