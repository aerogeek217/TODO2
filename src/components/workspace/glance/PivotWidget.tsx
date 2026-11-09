import { useMemo, type CSSProperties } from 'react'
import type { PivotTab } from '../../../models/workspace-layout'
import { usePivotData } from '../../../hooks/use-chart-data'
import { useStatsBase } from '../../../hooks/use-glance-data'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { cellKey, type PivotHead, type PivotStats } from '../../../services/stats/pivot'
import { trackScrollEdges } from '../../../utils/scroll-edges'
import { SPLIT_CHOICE_LABELS } from './breakdown-copy'
import { chartDrill, rowHeading } from './chart-drills'
import { ChartPanel } from './chart-parts'
import { glanceDrill, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import type { SummaryPart } from './glance-summary'
import type { OnGlanceDrill } from './glance-types'
import { GlanceFrame } from './GlanceFrame'
import { GlanceSmallFace } from './GlanceSmallFace'
import { Empty } from './section-parts'
import styles from './PivotWidget.module.css'

/** The largest cell: its row, its column and its count (`null` with no tasks). */
function topCell(stats: PivotStats): { row: PivotHead; col: PivotHead; n: number } | null {
  let top: { row: PivotHead; col: PivotHead; n: number } | null = null
  for (const row of stats.rows) {
    for (const col of stats.cols) {
      const n = stats.cells.get(cellKey(row.key, col.key))?.length ?? 0
      if (n > 0 && (!top || n > top.n)) top = { row, col, n }
    }
  }
  return top
}

/** Copy: `Pivot 12 open`, then a line per row, `Aisha: Waiting 3 · Doing 2`. */
function pivotLines(title: string, stats: PivotStats): SummaryPart[][] {
  return [
    [{ label: title, count: `${stats.ids.length} open` }],
    ...stats.rows.map((r) => stats.cols.flatMap((c) => {
      const n = stats.cells.get(cellKey(r.key, c.key))?.length ?? 0
      return n > 0 ? [{ label: `${rowHeading(r)} · ${rowHeading(c)}`, count: String(n) }] : []
    })),
  ]
}

/** A cell's heat: the accent, stronger as it nears the largest cell. */
function heat(n: number, max: number): CSSProperties | undefined {
  if (n === 0 || max === 0) return undefined
  return { background: `color-mix(in srgb, var(--color-accent) ${Math.round(12 + 50 * (n / max))}%, transparent)` }
}

/** The heat table: a row per row head, a column per column head, the totals last; every cell opens its tasks. */
function HeatTable({ title, stats, onDrill }: { title: string; stats: PivotStats; onDrill?: OnGlanceDrill }) {
  const { rows, cols, cells, max } = stats
  const open = (label: string, ids: readonly number[]) => onDrill && ids.length > 0
    ? () => onDrill(chartDrill(`${title} · ${label}`, 'matrix', `${title}: the tasks ${label}.`, ids))
    : undefined
  const cell = (key: string, ids: readonly number[], label: string, cls: string | undefined, style?: CSSProperties) => {
    const run = open(label, ids)
    const text = ids.length > 0 ? String(ids.length) : '–'
    return (
      <span key={key} role="cell" className={styles.cellBox} data-pivot-cell={key}>
        {run
          ? <button type="button" className={cls} style={style} aria-label={`${label}: ${ids.length}. Show tasks`} onClick={run}>{text}</button>
          : <span className={`${cls} ${ids.length === 0 ? styles.zero : ''}`} style={style}>{text}</span>}
      </span>
    )
  }
  return (
    <div ref={trackScrollEdges} className={styles.scroll}>
      <div
        className={styles.table}
        role="table"
        aria-label={title}
        style={{ gridTemplateColumns: `minmax(72px, 140px) repeat(${cols.length}, minmax(44px, 140px)) minmax(44px, auto)` }}
      >
        <div role="row" className={styles.row}>
          <span role="columnheader" className={styles.corner} />
          {cols.map((c) => <span key={c.key} role="columnheader" className={styles.colHead} title={rowHeading(c)}>{rowHeading(c)}</span>)}
          <span role="columnheader" className={styles.colHead}>Total</span>
        </div>
        {rows.map((r) => (
          <div key={r.key} role="row" className={styles.row} data-pivot-row={r.key}>
            <span role="rowheader" className={styles.rowHead} title={rowHeading(r)}>{rowHeading(r)}</span>
            {cols.map((c) => {
              const ids = cells.get(cellKey(r.key, c.key)) ?? []
              return cell(cellKey(r.key, c.key), ids, `${rowHeading(r)} × ${rowHeading(c)}`, styles.cell, heat(ids.length, max))
            })}
            {cell(`${r.key}|total`, r.ids, rowHeading(r), `${styles.cell} ${styles.total}`)}
          </div>
        ))}
        <div role="row" className={styles.row}>
          <span role="rowheader" className={`${styles.rowHead} ${styles.totalHead}`}>Total</span>
          {cols.map((c) => cell(`total|${c.key}`, c.ids, rowHeading(c), `${styles.cell} ${styles.total}`))}
          {cell('total|total', stats.ids, 'in all', `${styles.cell} ${styles.total}`)}
        </div>
      </div>
    </div>
  )
}

/**
 * The Pivot widget (D26 P8, board Z1): the tasks its filter keeps under the
 * top bar's filter, split by two things in a heat table — rows × columns
 * with their totals, a cell's colour its share of the largest. Every cell
 * and total opens its tasks. Small face: its title and its largest cell;
 * medium and large: the table. Its editor (Edit pivot…) opens under its
 * title.
 */
export function PivotWidget({ tab, onResult, onDrill }: GlanceWidgetProps<PivotTab>) {
  const config = tab.config
  const base = useStatsBase()
  const data = usePivotData(base, config)
  const [faceRef, face] = useWidgetFace()
  const title = config.name.trim() || 'Pivot'
  const lines = useMemo(() => pivotLines(title, data.stats), [title, data.stats])
  useReportLines(onResult, lines)
  const drill = glanceDrill(onDrill, data.count.filtered)
  const top = topCell(data.stats)
  return (
    <GlanceFrame tab={tab} faceRef={faceRef} face={face}>
      {face === 'small' ? (
        <GlanceSmallFace
          glyph="matrix"
          glyphColor="var(--color-accent)"
          title={title}
          entry={top ? `${rowHeading(top.row)} × ${rowHeading(top.col)}` : undefined}
          value={String(top?.n ?? 0)}
          caption={top ? undefined : 'open'}
        />
      ) : (
        <ChartPanel
          tabId={tab.id}
          kind="pivot"
          title={title}
          glyph="matrix"
          count={`${data.stats.ids.length} open`}
          sub={`${SPLIT_CHOICE_LABELS[config.rows]} × ${SPLIT_CHOICE_LABELS[config.cols]}`}
        >
          {data.stats.ids.length === 0
            ? <Empty title="No tasks" hint="The tasks this pivot's filter keeps show here." />
            : <HeatTable title={title} stats={data.stats} onDrill={drill} />}
        </ChartPanel>
      )}
    </GlanceFrame>
  )
}
