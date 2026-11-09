import { useMemo } from 'react'
import type { StatusFlowTab } from '../../../models/workspace-layout'
import { useStatusFlowData } from '../../../hooks/use-chart-data'
import { useStatsBase } from '../../../hooks/use-glance-data'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import type { StatusFlowBand, StatusFlowStats, StatusFlowWeek } from '../../../services/stats/status-flow'
import { formatDateWith } from '../../../utils/date'
import { approximateNote } from './glance-copy'
import { chartDrill } from './chart-drills'
import { ChartPanel } from './chart-parts'
import { glanceDrill, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import type { SummaryPart } from './glance-summary'
import type { OnGlanceDrill } from './glance-types'
import { GlanceFrame } from './GlanceFrame'
import { GlanceSmallFace } from './GlanceSmallFace'
import { Empty } from './section-parts'
import styles from './StatusFlowWidget.module.css'

const bandKey = (band: StatusFlowBand): number | 'none' => band.id ?? 'none'

/** A week's column label: `now` for this week, else how many weeks back (`−3w`). */
function weekLabel(index: number, count: number): string {
  const back = count - 1 - index
  return back === 0 ? 'now' : `−${back}w`
}

/** `week ending Sat 4 Oct` — a week in a sentence (this week: `this week`). */
function weekWords(week: StatusFlowWeek, last: boolean): string {
  return last ? 'this week' : `the week ending ${formatDateWith(week.end, { weekday: 'short', day: 'numeric', month: 'short' })}`
}

/** The largest band of the last week (`undefined` with nothing open). */
function topBand(stats: StatusFlowStats): { band: StatusFlowBand; n: number } | undefined {
  const last = stats.weeks.at(-1)
  let top: { band: StatusFlowBand; n: number } | undefined
  for (const band of stats.bands) {
    const n = last?.byBand.get(bandKey(band))?.length ?? 0
    if (n > 0 && (!top || n > top.n)) top = { band, n }
  }
  return top
}

/** Copy: `Status flow 8 weeks`, then this week's bands, `Doing 5 · Waiting 3`. */
function flowLines(title: string, weeks: number, stats: StatusFlowStats | null): SummaryPart[][] {
  const last = stats?.weeks.at(-1)
  return [
    [{ label: title, count: `${weeks} weeks` }],
    stats && last ? stats.bands.flatMap((b) => {
      const n = last.byBand.get(bandKey(b))?.length ?? 0
      return n > 0 ? [{ label: b.label, count: String(n) }] : []
    }) : [],
  ]
}

/** The columns: a stacked bar per week, a segment per status (bottom up in Settings order), each opening its tasks. */
function FlowBars({ title, stats, onDrill }: { title: string; stats: StatusFlowStats; onDrill?: OnGlanceDrill }) {
  const { weeks, bands, max } = stats
  return (
    <div className={styles.chart} role="group" aria-label={`${title}: open tasks by status, week by week`}>
      {weeks.map((week, i) => {
        const last = i === weeks.length - 1
        return (
          <div key={week.end.getTime()} className={styles.week} data-flow-week={i}>
            <div className={styles.stack} title={`${weekWords(week, last)}: ${week.total} open`}>
              {bands.map((band) => {
                const ids = week.byBand.get(bandKey(band)) ?? []
                if (ids.length === 0) return null
                const style = { height: `${(ids.length / Math.max(1, max)) * 100}%`, background: band.color }
                const label = `${band.label}, ${weekWords(week, last)}: ${ids.length}`
                return onDrill ? (
                  <button
                    key={String(bandKey(band))}
                    type="button"
                    className={styles.segment}
                    style={style}
                    data-segment={`${i}-${String(bandKey(band))}`}
                    aria-label={`${label}. Show tasks`}
                    title={label}
                    onClick={() => onDrill(chartDrill(
                      `${title} · ${band.label} · ${weekLabel(i, weeks.length)}`,
                      'status',
                      `${title}: the open tasks with the status ${band.label} at the end of ${weekWords(week, last)}.`,
                      ids,
                    ))}
                  />
                ) : <span key={String(bandKey(band))} className={styles.segment} style={style} title={label} />
              })}
            </div>
            <span className={styles.label}>{weekLabel(i, weeks.length)}</span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * The Status flow widget (D26 P8, board Z1): the open tasks its filter
 * keeps under the top bar's filter, by status, at each of its last 8, 12
 * or 26 weeks' end — replayed from the status history (`≈` when its filter
 * reads a field the history log didn't hold for the whole window). A
 * segment opens its tasks. Small face: its title and this week's largest
 * status; medium and large: the chart, its key in the header.
 */
export function StatusFlowWidget({ tab, onResult, onDrill }: GlanceWidgetProps<StatusFlowTab>) {
  const config = tab.config
  const base = useStatsBase()
  const { count, flow } = useStatusFlowData(base, config)
  const [faceRef, face] = useWidgetFace()
  const title = config.name.trim() || 'Status flow'
  const stats = flow?.stats ?? null
  const lines = useMemo(() => flowLines(title, config.weeks, stats), [title, config.weeks, stats])
  useReportLines(onResult, lines)
  const drill = glanceDrill(onDrill, count.filtered)
  const approximate = flow && !flow.exactness.exact ? approximateNote(flow.exactness.approximate) : null
  const top = stats ? topBand(stats) : undefined
  const legend = stats && stats.bands.length > 0 && (
    <span className={styles.legend} data-testid="status-flow-legend">
      {stats.bands.map((b) => (
        <span key={String(bandKey(b))} className={styles.key}><i style={{ background: b.color }} />{b.label}</span>
      ))}
    </span>
  )
  return (
    <GlanceFrame tab={tab} faceRef={faceRef} face={face}>
      {face === 'small' ? (
        <GlanceSmallFace
          glyph="status"
          glyphColor="var(--color-accent)"
          title={title}
          entry={top?.band.label}
          value={String(top?.n ?? 0)}
          valueColor={top?.band.color}
          caption={top ? undefined : 'open'}
        />
      ) : (
        <ChartPanel
          tabId={tab.id}
          kind="statusFlow"
          title={title}
          glyph="status"
          sub={`${config.weeks} weeks`}
          extras={legend}
        >
          {!stats ? null : stats.max === 0
            ? <Empty title="No open tasks" hint="The open tasks this flow's filter keeps show here, by status, week by week." />
            : <FlowBars title={title} stats={stats} onDrill={drill} />}
          {approximate && <span className={styles.approx} title={approximate} data-testid="status-flow-approximate">≈ Approximate before the history log began</span>}
        </ChartPanel>
      )}
    </GlanceFrame>
  )
}
