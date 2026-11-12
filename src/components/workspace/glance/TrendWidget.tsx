import { useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_TREND_RANGE, trendName, trendShow, type TrendShow } from '../../../models/glance-widgets'
import type { TrendTab } from '../../../models/workspace-layout'
import { useElementSize } from '../../../hooks/use-element-size'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { lensHidesFor, trendFilter, useLensHidden, useStatsBase, useTrend, type TrendData } from '../../../hooks/use-glance-data'
import { trendBucketDays, trendCumulative } from '../../../services/stats/trend'
import { TabLensSwitch } from '../LensSwitch'
import {
  approximateNote, signed, sinceLabel, trendBucketLabel, trendBucketWords, trendRangeLabel, trendRangeWords,
} from './glance-copy'
import { trendBucketDrill, trendCumulativeDrill, trendOpenDrill, trendTotalDrill } from './glance-drills'
import { glanceDrill, GLANCE_PANEL_CLASS, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import { trendLines } from './glance-summary'
import type { OnGlanceDrill } from './glance-types'
import { trendAxisStep } from './trend-axis'
import { GlanceFrame } from './GlanceFrame'
import { GlanceSmallFace } from './GlanceSmallFace'
import { Clickable, Legend, Panel } from './section-parts'
import styles from './GlanceSections.module.css'

/** Px per task in the trend bars, when they fit. */
const TREND_UNIT_PX = 36

/** The colours of the lines and bars: created neutral, completed (and the Burndown's open tasks) the accent. */
const CREATED_BAR = 'var(--color-chart-created)'
const CREATED_LINE = 'var(--color-text-secondary)'
const ACCENT = 'var(--color-accent)'

/** What a presentation draws from. */
interface ShowProps {
  data: TrendData
  name: string
  rangeWords: string
  today: Date
  onDrill?: OnGlanceDrill
  /** The medium face: a line chart leaves out its stats row (its lines' end values say them). */
  compact?: boolean
}

/** A bar's or point's column: its days, its name on the axis and in words. */
interface Column {
  first: number
  last: number
  axis: string
  words: string
}

function useColumns(data: TrendData, today: Date): Column[] {
  const { window } = data.stats
  return useMemo(() => trendBucketDays(window).map(({ first, last }, i) => {
    const start = window.bucketStarts[i] ?? window.start
    return { first, last, axis: trendBucketLabel(start, window.granularity), words: trendBucketWords(start, window.granularity, today) }
  }), [window, today])
}

/** The grid the columns take: each its share of the days (a week a week's, the week so far less). */
function columnTemplate(columns: readonly Column[]): string {
  return columns.length === 0 ? '1fr' : columns.map((c) => `minmax(0, ${c.last - c.first + 1}fr)`).join(' ')
}

/** The axis under a chart: every so many columns labelled (`trendAxisStep`), today's in bold. */
function Axis({ columns, width }: { columns: readonly Column[]; width: number }) {
  const step = trendAxisStep(width, columns.length, Math.max(0, ...columns.map((c) => c.axis.length)))
  return (
    <div className={styles.trendAxis} style={{ gridTemplateColumns: columnTemplate(columns) }}>
      {columns.map((c, i) => (
        <span key={i} data-today={i === columns.length - 1 ? 'true' : undefined}>
          {(columns.length - 1 - i) % step === 0 ? c.axis : null}
        </span>
      ))}
    </div>
  )
}

/**
 * The tooltip of a column the history log can't count exactly (a dimmed bar,
 * a dashed stretch of line): which fields read as they are now. No mark of
 * its own on the chart, as a Number's line has none.
 */
function approxTitle(data: TrendData, column: Column | undefined): string | undefined {
  return column != null && column.first < data.exactFrom ? approximateNote(data.approximate) : undefined
}

/** One of the stats row's figures: a number and its words, a button opening its tasks when there are any. */
function Stat({ value, words, label, color, onClick, testId }: {
  value: string
  words: string
  label: string
  color?: string
  onClick?: () => void
  testId: string
}) {
  return (
    <Clickable as="span" className={styles.trendStat} data-testid={testId} label={label} onClick={onClick}>
      <b style={color ? { color } : undefined}>{value}</b>{words}
    </Clickable>
  )
}

/** Bars: created and completed per day or week, the totals and the net change over the stats row. */
function BarsShow({ data, name, rangeWords, today, onDrill }: ShowProps) {
  const [ref, size] = useElementSize()
  const { stats } = data
  const columns = useColumns(data, today)
  const tallest = Math.max(1, ...stats.buckets.map((b) => Math.max(b.createdIds.length, b.completedIds.length)))
  const unit = size.height > 0 ? Math.min(TREND_UNIT_PX, size.height / tallest) : TREND_UNIT_PX
  return (
    <div className={styles.trend}>
      <div className={styles.trendStats}>
        <Stat
          value={String(stats.completed)}
          words="completed"
          color="var(--color-accent-text)"
          testId="glance-trend-completed"
          label={`${stats.completed} completed in ${rangeWords}. Show tasks`}
          onClick={onDrill ? () => onDrill(trendTotalDrill('completed', rangeWords, stats.buckets.flatMap((b) => b.completedIds), name)) : undefined}
        />
        <Stat
          value={String(stats.created)}
          words="created"
          testId="glance-trend-created"
          label={`${stats.created} created in ${rangeWords}. Show tasks`}
          onClick={onDrill ? () => onDrill(trendTotalDrill('created', rangeWords, stats.buckets.flatMap((b) => b.createdIds), name)) : undefined}
        />
        <span className={styles.trendStat} data-testid="glance-trend-net"><b>{signed(stats.net)}</b>{sinceLabel(stats.window.start, today)}</span>
      </div>
      <div ref={ref} className={styles.trendChart} style={{ gridTemplateColumns: columnTemplate(columns) }}>
        {stats.buckets.map((b, i) => {
          const column = columns[i]
          const c = b.createdIds.length
          const k = b.completedIds.length
          const approx = column != null && column.first < data.exactFrom
          return (
            <Clickable
              key={i}
              as="div"
              className={styles.trendGroup}
              data-trend-column={String(i)}
              data-approx={approx ? 'true' : undefined}
              title={approxTitle(data, column)}
              label={`${column?.words ?? ''}: ${c} created, ${k} completed${approx ? ' (approximate)' : ''}. Show tasks`}
              onClick={onDrill && c + k > 0
                ? () => onDrill(trendBucketDrill(b.start, stats.window.granularity, today, { completed: b.completedIds, created: b.createdIds }, name))
                : undefined}
            >
              <span className={styles.trendBar} style={{ height: c * unit, background: CREATED_BAR }} />
              <span className={styles.trendBar} style={{ height: k * unit, background: ACCENT }} />
            </Clickable>
          )
        })}
      </div>
      <Axis columns={columns} width={size.width} />
    </div>
  )
}

/** A line of a line chart: its values per day, its colour and name. */
interface ChartLine {
  key: string
  label: string
  color: string
  values: readonly number[]
}

/** Px left above the tallest point for its value label, and under the lowest for the stroke. */
const PAD_TOP = 16
const PAD_BOTTOM = 3

/**
 * A line chart over the window's days (Burndown, Cumulative), drawn as
 * built SVG nodes in the measured box: each line through every day's
 * point, the days the log can't count exactly dashed (before `exactFrom`),
 * its last value labelled; `band` shades the room between the first two
 * lines, `area` the room under the first. Over it, a transparent button
 * per column (a day, or a week on the weekly ranges) opens what its point
 * counts; hovering or focusing one marks its point.
 */
function LineChart({ lines, columns, exactFrom, band, area, startLabel, hits }: {
  lines: readonly ChartLine[]
  columns: readonly Column[]
  exactFrom: number
  band?: boolean
  area?: boolean
  /** Label the first line's first value too (the Burndown's start). */
  startLabel?: boolean
  /** Each column's label, tooltip and drill. */
  hits: ReadonlyArray<{ label: string; title?: string; onClick?: () => void }>
}) {
  const [ref, size] = useElementSize()
  const [active, setActive] = useState<number | null>(null)
  const n = Math.max(1, lines[0]?.values.length ?? 0)
  const { width: w, height: h } = size
  const max = Math.max(1, ...lines.flatMap((l) => l.values))
  const x = (i: number) => ((i + 0.5) * w) / n
  const y = (v: number) => PAD_TOP + (1 - v / max) * Math.max(1, h - PAD_TOP - PAD_BOTTOM)
  const pts = (values: readonly number[], from: number, to: number) => values.slice(from, to + 1).map((v, j) => `${x(from + j).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const split = Math.min(Math.max(0, exactFrom), n - 1)
  const allApprox = exactFrom >= n
  const activeDay = active != null ? columns[active]?.last : undefined
  const ends = endLabels(lines, y, h)
  return (
    <div ref={ref} className={styles.trendLineChart}>
      {w > 0 && h > 0 && (
        <svg className={styles.trendLineSvg} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
          <line x1={0} x2={w} y1={y(max)} y2={y(max)} className={styles.trendGrid} />
          {!(startLabel && lines[0] && y(lines[0].values[0] ?? 0) - y(max) < 14) && <text x={2} y={y(max) - 4} className={styles.trendGridLabel}>{max}</text>}
          {startLabel && lines[0] && (
            <text x={x(0) + 2} y={Math.max(11, y(lines[0].values[0] ?? 0) - 6)} className={styles.trendEndLabel} style={{ fill: lines[0].color }}>{lines[0].values[0] ?? 0}</text>
          )}
          {band && lines[0] && lines[1] && (
            <polygon
              points={`${pts(lines[0].values, 0, n - 1)} ${[...lines[1].values].map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).reverse().join(' ')}`}
              className={styles.trendBand}
            />
          )}
          {area && lines[0] && (
            <polygon points={`${x(0).toFixed(1)},${y(0).toFixed(1)} ${pts(lines[0].values, 0, n - 1)} ${x(n - 1).toFixed(1)},${y(0).toFixed(1)}`} className={styles.trendArea} />
          )}
          {lines.map((l) => (
            <g key={l.key} data-trend-line={l.key}>
              {(split > 0 || allApprox) && (
                <polyline points={pts(l.values, 0, allApprox ? n - 1 : split)} fill="none" stroke={l.color} strokeWidth={2} strokeDasharray="3 3" strokeLinejoin="round" opacity={0.7} data-approx="true" />
              )}
              {!allApprox && (
                <polyline points={pts(l.values, split, n - 1)} fill="none" stroke={l.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              )}
              {n === 1 && <circle cx={x(0)} cy={y(l.values[0] ?? 0)} r={2.5} fill={l.color} />}
            </g>
          ))}
          {activeDay != null && (
            <g data-trend-active="">
              <line x1={x(activeDay)} x2={x(activeDay)} y1={PAD_TOP - 4} y2={h} className={styles.trendGuide} />
              {lines.map((l) => <circle key={l.key} cx={x(activeDay)} cy={y(l.values[activeDay] ?? 0)} r={3.5} fill={l.color} stroke="var(--color-surface)" strokeWidth={1.5} />)}
            </g>
          )}
          {ends.map((e) => (
            <text key={e.key} x={w - 2} y={e.y} textAnchor="end" className={styles.trendEndLabel} style={{ fill: e.color }}>{e.text}</text>
          ))}
        </svg>
      )}
      <div
        className={styles.trendHits}
        style={{ gridTemplateColumns: columnTemplate(columns) }}
        onPointerOver={(e) => setActive(columnOf(e.target))}
        onPointerLeave={() => setActive(null)}
        onFocus={(e) => setActive(columnOf(e.target))}
        onBlur={() => setActive(null)}
      >
        {columns.map((c, i) => {
          const hit = hits[i]
          return (
            <Clickable
              key={i}
              as="div"
              className={styles.trendHit}
              data-trend-column={String(i)}
              data-approx={c.first < exactFrom ? 'true' : undefined}
              label={hit?.label}
              title={hit?.title}
              onClick={hit?.onClick}
            >
              {null}
            </Clickable>
          )
        })}
      </div>
    </div>
  )
}

/** The column (`data-trend-column`) an event's target is in, if any. */
function columnOf(target: EventTarget): number | null {
  const el = target instanceof Element ? target.closest('[data-trend-column]') : null
  const n = el ? Number(el.getAttribute('data-trend-column')) : NaN
  return Number.isInteger(n) ? n : null
}

/**
 * Each line's last value, placed by its point and nudged apart (at least a
 * label's height) so two close ends don't overlap — above the point, or
 * under it when that's off the top.
 */
function endLabels(lines: readonly ChartLine[], y: (v: number) => number, h: number): Array<{ key: string; text: string; color: string; y: number }> {
  const out = lines.map((l) => {
    const v = l.values.at(-1) ?? 0
    return { key: l.key, text: String(v), color: l.color, y: Math.max(11, y(v) - 6) }
  }).sort((a, b) => a.y - b.y)
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]
    const cur = out[i]
    if (prev && cur && cur.y - prev.y < 12) cur.y = Math.min(h - 2, prev.y + 12)
  }
  return out
}

/** Burndown: the filter's open tasks at each day's end — the start and now, the change, a falling (or rising) line. */
function BurndownShow({ data, name, today, onDrill, compact }: ShowProps) {
  const { stats } = data
  const columns = useColumns(data, today)
  const [axisRef, axisSize] = useElementSize()
  const openNow = stats.openSeries.at(-1) ?? stats.openAtStart
  const lines: ChartLine[] = [{ key: 'open', label: 'Open', color: ACCENT, values: stats.openSeries }]
  const hits = columns.map((c) => {
    const day = stats.window.days[c.last]
    const ids = stats.daily[c.last]?.openIds ?? []
    const isToday = c.last === stats.window.days.length - 1
    const approx = c.first < data.exactFrom ? ' (approximate)' : ''
    return {
      label: `${c.words}: ${ids.length} open ${isToday ? 'now' : stats.window.granularity === 'day' ? 'at its end' : 'at the week’s end'}${approx}. Show tasks`,
      title: approxTitle(data, c),
      onClick: onDrill && day && ids.length > 0 ? () => onDrill(trendOpenDrill(day, today, ids, name)) : undefined,
    }
  })
  return (
    <div className={styles.trend}>
      {!compact && (
          <div className={styles.trendStats}>
            <Stat
              value={String(openNow)}
              words="open now"
              color="var(--color-accent-text)"
              testId="trend-open-now"
              label={`${openNow} open now. Show tasks`}
              onClick={onDrill && openNow > 0 ? () => onDrill(trendOpenDrill(today, today, stats.daily.at(-1)?.openIds ?? [], name)) : undefined}
            />
            <Stat
              value={String(stats.openAtStart)}
              words="at the start"
              testId="trend-open-start"
              label={`${stats.openAtStart} open when the range began. Show tasks`}
              onClick={onDrill && stats.openAtStart > 0 ? () => onDrill(trendOpenDrill(null, today, stats.openAtStartIds, name)) : undefined}
            />
            <span className={styles.trendStat} data-testid="trend-change"><b>{signed(stats.net)}</b>{sinceLabel(stats.window.start, today)}</span>
          </div>
      )}
      <LineChart lines={lines} columns={columns} exactFrom={data.exactFrom} area startLabel hits={hits} />
      <div ref={axisRef}><Axis columns={columns} width={axisSize.width} /></div>
    </div>
  )
}

/** Cumulative: the running totals of created (on top of what was open at the start) and of completed; the gap between them is what is open. */
function CumulativeShow({ data, name, rangeWords, today, onDrill, compact }: ShowProps) {
  const { stats } = data
  const columns = useColumns(data, today)
  const [axisRef, axisSize] = useElementSize()
  const cumulative = useMemo(() => trendCumulative(stats), [stats])
  const lines: ChartLine[] = [
    { key: 'created', label: 'Created', color: CREATED_LINE, values: cumulative.created },
    { key: 'completed', label: 'Completed', color: ACCENT, values: cumulative.completed },
  ]
  const hits = columns.map((c) => {
    const day = stats.window.days[c.last]
    const through = stats.daily.slice(0, c.last + 1)
    const created = through.flatMap((d) => d.createdIds)
    const completed = through.flatMap((d) => d.completedIds)
    const approx = c.first < data.exactFrom ? ' (approximate)' : ''
    return {
      label: `Through ${c.words}: ${cumulative.created[c.last] ?? 0} created (with ${stats.openAtStart} open at the start), ${cumulative.completed[c.last] ?? 0} completed${approx}. Show tasks`,
      title: approxTitle(data, c),
      onClick: onDrill && day && created.length + completed.length + stats.openAtStart > 0
        ? () => onDrill(trendCumulativeDrill(day, today, { completed, created, openAtStart: stats.openAtStartIds }, name))
        : undefined,
    }
  })
  return (
    <div className={styles.trend}>
      {!compact && (
          <div className={styles.trendStats}>
            <Stat
              value={String(stats.created)}
              words="created"
              testId="glance-trend-created"
              label={`${stats.created} created in ${rangeWords}. Show tasks`}
              onClick={onDrill ? () => onDrill(trendTotalDrill('created', rangeWords, stats.buckets.flatMap((b) => b.createdIds), name)) : undefined}
            />
            <Stat
              value={String(stats.completed)}
              words="completed"
              color="var(--color-accent-text)"
              testId="glance-trend-completed"
              label={`${stats.completed} completed in ${rangeWords}. Show tasks`}
              onClick={onDrill ? () => onDrill(trendTotalDrill('completed', rangeWords, stats.buckets.flatMap((b) => b.completedIds), name)) : undefined}
            />
            <Stat
              value={String(stats.openAtStart)}
              words="open at the start"
              testId="trend-open-start"
              label={`${stats.openAtStart} open when the range began. Show tasks`}
              onClick={onDrill && stats.openAtStart > 0 ? () => onDrill(trendOpenDrill(null, today, stats.openAtStartIds, name)) : undefined}
            />
          </div>
      )}
      <LineChart lines={lines} columns={columns} exactFrom={data.exactFrom} band hits={hits} />
      <div ref={axisRef}><Axis columns={columns} width={axisSize.width} /></div>
    </div>
  )
}

/** Each presentation's key. */
const LEGENDS: Record<TrendShow, ReactNode> = {
  bars: <><Legend color={CREATED_BAR} label="Created" /><Legend color={ACCENT} label="Completed" /></>,
  burndown: <Legend color={ACCENT} label="Open" />,
  cumulative: <><Legend color={CREATED_LINE} label="Created" /><Legend color={ACCENT} label="Completed" /></>,
}

/** The small face's headline for each presentation: the net change, the open count now, the completed count. */
function smallFigures(show: TrendShow, data: TrendData | null, rangeShort: string): { value: string; caption: string } {
  if (!data) return { value: '–', caption: show === 'burndown' ? 'open' : show === 'cumulative' ? 'completed' : `net · ${rangeShort}` }
  const { stats } = data
  if (show === 'burndown') return { value: String(stats.openSeries.at(-1) ?? stats.openAtStart), caption: `open · ${signed(stats.net)}` }
  if (show === 'cumulative') return { value: String(stats.completed), caption: `completed · ${stats.created} created` }
  return { value: signed(stats.net), caption: `net · ${rangeShort}` }
}

/**
 * The Created vs completed widget: its filter's tasks among those the top
 * bar shows (its lens switch, G3), over its range, shown as Bars, a
 * Burndown or Cumulative lines (`config.show`), the days the history log
 * can't count exactly dimmed or dashed (their tooltip says why). Every bar,
 * point and total opens its tasks.
 * Small face: its name and the presentation's headline; medium and large:
 * the chart. Its editor (Edit chart…, `TrendEditorHost`) opens under its
 * title (`data-trend-head`).
 */
export function TrendWidget({ tab, onResult, onDrill }: GlanceWidgetProps<TrendTab>) {
  const config = tab.config
  const range = config.range ?? DEFAULT_TREND_RANGE
  const name = trendName(config)
  const show = trendShow(config)
  const base = useStatsBase()
  const data = useTrend(base, config)
  const [faceRef, face] = useWidgetFace()
  const today = base.ctx.today
  const rangeLabel = trendRangeLabel(range)
  const rangeWords = trendRangeWords(range)
  const lensHides = lensHidesFor(useLensHidden(), trendFilter(config))
  const lines = useMemo(() => {
    const window = data?.stats.window
    const bucketLabels = window ? window.bucketStarts.map((s) => trendBucketWords(s, window.granularity, today)) : []
    return trendLines({ name, rangeLabel, show, trend: data?.stats ?? null, exactFrom: data?.exactFrom ?? 0, bucketLabels, signedNet: signed })
  }, [data, name, rangeLabel, show, today])
  useReportLines(onResult, lines)
  const drill = glanceDrill(onDrill, data?.filtered ?? false)
  const small = smallFigures(show, data, rangeLabel.replace(/^Last /, ''))
  const props = data ? { data, name, rangeWords, today, onDrill: drill, compact: face === 'medium' } : null
  return (
    <GlanceFrame tab={tab} faceRef={faceRef} face={face}>
      {face === 'small' ? (
        <GlanceSmallFace glyph="chart" glyphColor={ACCENT} title={name} value={small.value} caption={small.caption} />
      ) : (
        <Panel
          def={{ id: 'trend', title: name, glyph: 'chart', glyphColor: ACCENT }}
          titleData={{ 'data-trend-head': tab.id }}
          className={GLANCE_PANEL_CLASS}
          sub={rangeLabel}
          extras={LEGENDS[show]}
          lens={<TabLensSwitch tab={tab} hides={lensHides} />}
        >
          <div className={styles.trendBody} data-trend-show={show}>
            {props && show === 'bars' && <BarsShow {...props} />}
            {props && show === 'burndown' && <BurndownShow {...props} />}
            {props && show === 'cumulative' && <CumulativeShow {...props} />}
          </div>
        </Panel>
      )}
    </GlanceFrame>
  )
}
