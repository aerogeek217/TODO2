import { useMemo, type MouseEvent } from 'react'
import { DEFAULT_NUMBER_BREAKDOWN, isTileMetric, type NumberMetric } from '../../../models/glance-widgets'
import type { NumberTab } from '../../../models/workspace-layout'
import { useClosedThisWeek, useMetricHistory, useStatsBase, useTileStats } from '../../../hooks/use-glance-data'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { HISTORY_AGAINST, hasHistory, historyDelta } from '../../../services/stats/metric-history'
import { numberBreakdown, type BreakdownEntry } from '../../../services/stats/number-breakdown'
import { DashGlyph } from '../../shared/DashGlyph'
import { closedSubLine, countOf, deltaLabel, metricSubLine } from './glance-copy'
import { glanceDrill, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import { numberLines } from './glance-summary'
import type { GlanceDrill, OnGlanceDrill } from './glance-types'
import { GlanceFrame } from './GlanceFrame'
import { Sparkline } from './Sparkline'
import { closedThisWeekDrill, NUMBER_DEFS, numberColors, metricDrill } from './number-defs'
import styles from './NumberWidget.module.css'

/** The large face's breakdown lists this many people / tags; the rest fold into one line. */
export const BREAKDOWN_SHOWN = 5

/**
 * The large face's breakdown: a line per person / tag with a bar of its
 * share and its count (each opens its tasks), the rest as `N more`.
 */
function Breakdown({ entries, by, total, title, onDrill }: {
  entries: readonly BreakdownEntry[]
  by: 'people' | 'tags'
  total: number
  title: string
  onDrill?: OnGlanceDrill
}) {
  if (entries.length === 0) return null
  const shown = entries.slice(0, BREAKDOWN_SHOWN)
  const rest = entries.length - shown.length
  const max = Math.max(1, ...shown.map((e) => e.ids.length))
  return (
    <div className={styles.breakdown} role="list" aria-label={`${title} by ${by === 'tags' ? 'tag' : 'person'}`} data-testid="number-breakdown">
      {shown.map((e) => {
        const content = (
          <>
            <i className={styles.breakdownDot} style={{ background: e.color ?? 'var(--color-text-muted)' }} aria-hidden="true" />
            <span className={styles.breakdownName}>{e.label}</span>
            <span className={styles.breakdownBar} aria-hidden="true"><span style={{ width: `${Math.round((e.ids.length / max) * 100)}%` }} /></span>
            <span className={styles.breakdownCount}>{e.ids.length}</span>
          </>
        )
        const label = `${e.label}: ${e.ids.length} of ${total}`
        return onDrill ? (
          <button
            key={e.key}
            type="button"
            role="listitem"
            className={styles.breakdownRow}
            data-breakdown={e.key}
            aria-label={`${label}. Show tasks`}
            onClick={() => onDrill(breakdownDrill(title, by, e))}
          >
            {content}
          </button>
        ) : (
          <div key={e.key} role="listitem" className={styles.breakdownRow} data-breakdown={e.key} aria-label={label}>{content}</div>
        )
      })}
      {rest > 0 && <span className={styles.breakdownMore}>{rest} more</span>}
    </div>
  )
}

/** One breakdown line's tasks for the task dialog. */
function breakdownDrill(title: string, by: 'people' | 'tags', entry: BreakdownEntry): GlanceDrill {
  const which = entry.key === 'none'
    ? (by === 'tags' ? 'with no tag' : 'with nobody assigned')
    : (by === 'tags' ? `tagged ${entry.label}` : `assigned to ${entry.label}`)
  return {
    title: `${title} · ${entry.label}`,
    glyph: by === 'tags' ? 'tag' : 'people',
    description: `${title}: the ones ${which}.`,
    source: { kind: 'todos', todoIds: entry.ids },
  }
}

/**
 * The Number widget (D25 N): one count — a tile metric's, or Closed
 * this week — over the screen filter (`shown of total`). By its face (D25
 * R): small is the label and the count (a fit row's, ~76px); medium adds
 * its sub-line and, for Open, Overdue, Due today and Closed this week, a
 * 14-day line with the change since yesterday (Closed this week: since the
 * same point of last week); large draws it bigger and
 * adds the breakdown its config picks (by person or tag). Lit in its
 * colour when the count asks for action (D18). A click opens its tasks,
 * as the tile does — at the small face too (the cell's full-widget
 * popover stays for the keyboard).
 */
export function NumberWidget({ tab, onResult, onDrill }: GlanceWidgetProps<NumberTab>) {
  const metric: NumberMetric = tab.config.metric
  const breakdownBy = tab.config.breakdown ?? DEFAULT_NUMBER_BREAKDOWN
  const base = useStatsBase()
  const tiles = useTileStats(base)
  const closed = useClosedThisWeek(base)
  const history = useMetricHistory(base)
  const [faceRef, face] = useWidgetFace()

  const def = NUMBER_DEFS[metric]
  const shownIds = isTileMetric(metric) ? tiles.shown[metric].ids : closed.shown.ids
  const shown = shownIds.length
  const total = isTileMetric(metric) ? tiles.total[metric].ids.length : closed.total.ids.length
  const sub = isTileMetric(metric)
    ? metricSubLine(metric, tiles.shown, { today: base.ctx.today, trendNet: history?.trend.net ?? null, trendRange: '14d' })
    : closedSubLine(closed.shown.weekStart, base.ctx.today)
  const series = history && hasHistory(metric) ? history.history.series[metric] : null
  const against = hasHistory(metric) ? HISTORY_AGAINST[metric] : 'yesterday'
  const delta = series ? historyDelta(series, against) : null
  const deltaText = delta == null ? null : deltaLabel(delta, against, base.ctx.today)
  const colors = numberColors(metric, shown)
  const count = countOf(shown, total)
  const large = face === 'large'
  const small = face === 'small'
  const breakdown = useMemo(
    () => (large ? numberBreakdown(shownIds, breakdownBy, base.ctx) : []),
    [large, shownIds, breakdownBy, base.ctx],
  )

  const lines = useMemo(() => numberLines(def.label, count, sub), [def.label, count, sub])
  useReportLines(onResult, lines)

  const drill = glanceDrill(onDrill, base.filtered)
  const content = (
    <>
      <span className={styles.label} style={{ color: colors.label }}>
        <DashGlyph name={def.glyph} size={12} color={colors.glyph} /><span className={styles.labelText}>{def.label}</span>
      </span>
      <span className={styles.figures}>
        <span className={styles.count} style={{ color: colors.count }} data-testid="number-count">
          {shown}
          {shown !== total && <span className={styles.of}>of {total}</span>}
        </span>
        {series && !small && (
          <span className={styles.history}>
            <Sparkline series={series} width={large ? 120 : 64} height={large ? 36 : 22} className={styles.spark} />
            {deltaText != null && <span className={styles.delta} data-testid="number-delta">{deltaText}</span>}
          </span>
        )}
      </span>
      {sub && !small && <span className={styles.sub}>{sub}</span>}
    </>
  )
  const name = `${def.label}: ${count}.${sub && !small ? ` ${sub}.` : ''}${deltaText != null && !small ? ` ${deltaText}.` : ''}`
  const common = {
    className: `${styles.number}${large ? ` ${styles.large}` : ''}`,
    'data-number-metric': metric,
    'data-lit': colors.lit ? 'true' : undefined,
  }
  const open = (e: MouseEvent) => {
    // Its own drill: not the cell's full-widget popover.
    e.preventDefault()
    drill?.(isTileMetric(metric) ? metricDrill(metric, { tiles, ctx: base.ctx }) : closedThisWeekDrill(closed.shown, base.ctx.today))
  }
  return (
    <GlanceFrame tab={tab} faceRef={faceRef} face={face}>
      <div className={`${styles.body}${large && breakdown.length > 0 ? ` ${styles.bodyWithBreakdown}` : ''}`}>
        {drill ? (
          <button type="button" {...common} aria-label={`${name} Show tasks`} onClick={open}>
            {content}
          </button>
        ) : (
          <div {...common} role="group" aria-label={name}>{content}</div>
        )}
        {large && breakdownBy !== 'none' && <Breakdown entries={breakdown} by={breakdownBy} total={shown} title={def.title} onDrill={drill} />}
      </div>
    </GlanceFrame>
  )
}
