import { useMemo } from 'react'
import { isTileMetric, type NumberMetric } from '../../../models/glance-widgets'
import type { NumberTab } from '../../../models/workspace-layout'
import { useElementSize } from '../../../hooks/use-element-size'
import { useClosedThisWeek, useMetricHistory, useStatsBase, useTileStats } from '../../../hooks/use-glance-data'
import { hasHistory, historyDelta } from '../../../services/stats/metric-history'
import { DashGlyph } from '../../shared/DashGlyph'
import { closedSubLine, countOf, deltaLabel, tileSubLine } from './glance-copy'
import { glanceDrill, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import { numberLines } from './glance-summary'
import { GlanceFrame } from './GlanceFrame'
import { Sparkline } from './Sparkline'
import { closedThisWeekDrill, NUMBER_DEFS, tileColors, tileDrill } from './tiles'
import styles from './NumberWidget.module.css'

/** From this body height (and width) the Number draws large: a bigger count and line. */
const LARGE_MIN_HEIGHT_PX = 140
const LARGE_MIN_WIDTH_PX = 200

/**
 * The Number widget (D25 N): one count — a Dashboard tile's, or Closed
 * this week — over the screen filter (`shown of total`), its sub-line, and
 * for Open, Overdue, Due today and Closed this week a 14-day line with the
 * change since yesterday. Lit in its colour when the count asks for
 * action (D18). A click opens its tasks, as the tile does. Centred in its
 * cell, it reads in a fit-height row (~76px) and grows in a bigger cell.
 */
export function NumberWidget({ tab, onResult, onDrill }: GlanceWidgetProps<NumberTab>) {
  const metric: NumberMetric = tab.config.metric
  const base = useStatsBase()
  const tiles = useTileStats(base)
  const closed = useClosedThisWeek(base)
  const history = useMetricHistory(base)
  const [sizeRef, size] = useElementSize()

  const def = NUMBER_DEFS[metric]
  const shown = isTileMetric(metric) ? tiles.shown[metric].ids.length : closed.shown.ids.length
  const total = isTileMetric(metric) ? tiles.total[metric].ids.length : closed.total.ids.length
  const sub = isTileMetric(metric)
    ? tileSubLine(metric, tiles.shown, { today: base.ctx.today, trendNet: history?.trend.net ?? null, trendRange: '14d' })
    : closedSubLine(closed.shown.weekStart, base.ctx.today)
  const series = history && hasHistory(metric) ? history.history.series[metric] : null
  const delta = series ? historyDelta(series) : null
  const colors = tileColors(metric, shown)
  const count = countOf(shown, total)

  const lines = useMemo(() => numberLines(def.label, count, sub), [def.label, count, sub])
  useReportLines(onResult, lines)

  const drill = glanceDrill(onDrill, base.filtered)
  const large = size.height >= LARGE_MIN_HEIGHT_PX && size.width >= LARGE_MIN_WIDTH_PX
  const content = (
    <>
      <span className={styles.label} style={{ color: colors.label }}>
        <DashGlyph name={def.glyph} size={12} color={colors.glyph} />{def.label}
      </span>
      <span className={styles.figures}>
        <span className={styles.count} style={{ color: colors.count }} data-testid="number-count">
          {shown}
          {shown !== total && <span className={styles.of}>of {total}</span>}
        </span>
        {series && (
          <span className={styles.history}>
            <Sparkline series={series} width={large ? 120 : 64} height={large ? 36 : 22} className={styles.spark} />
            {delta != null && <span className={styles.delta} data-testid="number-delta">{deltaLabel(delta)}</span>}
          </span>
        )}
      </span>
      {sub && <span className={styles.sub}>{sub}</span>}
    </>
  )
  const name = `${def.label}: ${count}.${sub ? ` ${sub}.` : ''}${delta != null ? ` ${deltaLabel(delta)}.` : ''}`
  const common = {
    className: `${styles.number}${large ? ` ${styles.large}` : ''}`,
    'data-number-metric': metric,
    'data-lit': colors.lit ? 'true' : undefined,
  }
  return (
    <GlanceFrame tab={tab}>
      <div ref={sizeRef} className={styles.body}>
        {drill ? (
          <button
            type="button"
            {...common}
            aria-label={`${name} Show tasks`}
            onClick={() => drill(isTileMetric(metric) ? tileDrill(metric, { tiles, ctx: base.ctx }) : closedThisWeekDrill(closed.shown, base.ctx.today))}
          >
            {content}
          </button>
        ) : (
          <div {...common} role="group" aria-label={name}>{content}</div>
        )}
      </div>
    </GlanceFrame>
  )
}
