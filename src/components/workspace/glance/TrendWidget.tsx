import { useMemo } from 'react'
import { DEFAULT_TREND_RANGE, type TrendRange } from '../../../models/glance-widgets'
import type { TrendTab } from '../../../models/workspace-layout'
import { useElementSize } from '../../../hooks/use-element-size'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { useStatsBase, useTrendStats } from '../../../hooks/use-glance-data'
import type { StatsContext } from '../../../services/stats/stats-context'
import type { TrendStats } from '../../../services/stats/trend'
import {
  signed, sinceLabel, trendBucketLabel, trendRangeLabel, trendRangeWords,
} from './glance-copy'
import { trendBucketDrill, trendTotalDrill } from './glance-drills'
import { glanceDrill, GLANCE_PANEL_CLASS, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import { trendLines } from './glance-summary'
import { GlanceFrame } from './GlanceFrame'
import { GlanceSmallFace } from './GlanceSmallFace'
import { SECTION_META } from './section-meta'
import { Clickable, Legend, Panel, type SectionProps } from './section-parts'
import styles from './GlanceSections.module.css'

/** What Created vs completed reads. */
export interface TrendSectionData {
  /** `null` until the history has been read. */
  trend: TrendStats | null
  trendRange: TrendRange
  ctx: StatsContext
}

/** Px per task in the trend bars, when they fit. */
const TREND_UNIT_PX = 36

/** Created vs completed: bars per day or week over the range, and the open count's change. */
export function TrendSection({ data, onDrill, style, className }: SectionProps<TrendSectionData>) {
  const [ref, size] = useElementSize()
  const { trend, trendRange, ctx } = data
  const buckets = trend?.buckets ?? []
  const tallest = Math.max(1, ...buckets.map((b) => Math.max(b.createdIds.length, b.completedIds.length)))
  const unit = size.height > 0 ? Math.min(TREND_UNIT_PX, size.height / tallest) : TREND_UNIT_PX
  const columns = { gridTemplateColumns: `repeat(${Math.max(1, buckets.length)}, minmax(0, 1fr))` }
  const granularity = trend?.window.granularity ?? 'day'
  const rangeWords = trendRangeWords(trendRange)
  return (
    <Panel
      def={SECTION_META.trend}
      style={style}
      className={className}
      sub={trendRangeLabel(trendRange)}
      extras={<><Legend color="var(--color-chart-created)" label="Created" /><Legend color="var(--color-accent)" label="Completed" /></>}
    >
      <div className={styles.trend}>
        <div className={styles.trendStats}>
          <Clickable
            as="span"
            className={styles.trendStat}
            data-testid="glance-trend-completed"
            label={`${trend?.completed ?? 0} completed in ${rangeWords}. Show tasks`}
            onClick={onDrill && trend
              ? () => onDrill(trendTotalDrill('completed', rangeWords, buckets.flatMap((b) => b.completedIds)))
              : undefined}
          >
            <b style={{ color: 'var(--color-accent-text)' }}>{trend?.completed ?? 0}</b>completed
          </Clickable>
          <Clickable
            as="span"
            className={styles.trendStat}
            data-testid="glance-trend-created"
            label={`${trend?.created ?? 0} created in ${rangeWords}. Show tasks`}
            onClick={onDrill && trend
              ? () => onDrill(trendTotalDrill('created', rangeWords, buckets.flatMap((b) => b.createdIds)))
              : undefined}
          >
            <b>{trend?.created ?? 0}</b>created
          </Clickable>
          {trend && <span className={styles.trendStat}><b>{signed(trend.net)}</b>{sinceLabel(trend.window.start, ctx.today)}</span>}
        </div>
        <div ref={ref} className={styles.trendChart} style={columns}>
          {buckets.map((b, i) => {
            const label = trendBucketLabel(b.start, granularity)
            const c = b.createdIds.length
            const k = b.completedIds.length
            return (
              <Clickable
                key={i}
                as="div"
                className={styles.trendGroup}
                label={`${label}: ${c} created, ${k} completed. Show tasks`}
                onClick={onDrill && c + k > 0
                  ? () => onDrill(trendBucketDrill(b.start, granularity, ctx.today, { completed: b.completedIds, created: b.createdIds }))
                  : undefined}
              >
                <span className={styles.trendBar} style={{ height: c * unit, background: 'var(--color-chart-created)' }} />
                <span className={styles.trendBar} style={{ height: k * unit, background: 'var(--color-accent)' }} />
              </Clickable>
            )
          })}
        </div>
        <div className={styles.trendAxis} style={columns}>
          {buckets.map((b, i) => (
            <span key={i} data-today={i === buckets.length - 1 ? 'true' : undefined}>{trendBucketLabel(b.start, granularity)}</span>
          ))}
        </div>
      </div>
    </Panel>
  )
}

/** The Created vs completed widget: the section over its range, filling its cell. */
export function TrendWidget({ tab, onResult, onDrill }: GlanceWidgetProps<TrendTab>) {
  const range = tab.config.range ?? DEFAULT_TREND_RANGE
  const base = useStatsBase()
  const trend = useTrendStats(base, range)
  const [faceRef, face] = useWidgetFace()
  const lines = useMemo(() => trendLines(trend, trendRangeLabel(range), signed), [trend, range])
  useReportLines(onResult, lines)
  return (
    <GlanceFrame tab={tab} faceRef={faceRef} face={face}>
      {face === 'small' ? (
        <GlanceSmallFace
          glyph={SECTION_META.trend.glyph}
          glyphColor={SECTION_META.trend.glyphColor}
          title={SECTION_META.trend.title}
          value={trend ? signed(trend.net) : '–'}
          caption={`net · ${trendRangeLabel(range).replace(/^Last /, '')}`}
        />
      ) : <TrendSection
        data={{ trend, trendRange: range, ctx: base.ctx }}
        options={{ range }}
        onDrill={glanceDrill(onDrill, base.filtered)}
        className={GLANCE_PANEL_CLASS}
      />}
    </GlanceFrame>
  )
}
