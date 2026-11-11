import { useMemo, type CSSProperties } from 'react'
import type { PivotSort } from '../../../models/chart-widgets'
import type { PivotTab } from '../../../models/workspace-layout'
import { usePivotData } from '../../../hooks/use-chart-data'
import { lensHidesFor, useLensHidden, useStatsBase } from '../../../hooks/use-glance-data'
import { TabLensSwitch } from '../LensSwitch'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { nextBreakdownSort } from '../../../services/stats/breakdown'
import { cellKey, isLivePivotSort, sortPivotRows, type PivotHead, type PivotStats } from '../../../services/stats/pivot'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { trackScrollEdges } from '../../../utils/scroll-edges'
import { SPLIT_CHOICE_LABELS, SPLIT_ROW_LABELS } from './breakdown-copy'
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

/** Copy: `Pivot 12 open`, then a line per row in the order shown, `Aisha: Waiting 3 · Doing 2`. */
function pivotLines(title: string, stats: PivotStats, rows: readonly PivotHead[]): SummaryPart[][] {
  return [
    [{ label: title, count: `${stats.ids.length} open` }],
    ...rows.map((r) => stats.cols.flatMap((c) => {
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

/**
 * A sortable heading (item 8, as a Breakdown's): a button — a click sorts
 * the rows by it, largest first (names A–Z), a second reverses, a third
 * puts the natural order back — with ▼ / ▲ while it is the sort.
 */
function SortHeading({ by, label, className, title, sort, onSort }: {
  by: string
  label: string
  className: string | undefined
  title?: string
  sort: PivotSort | undefined
  onSort: (by: string) => void
}) {
  const active = sort?.by === by
  // Counts go largest first, names A–Z; a second click reverses.
  const descending = by === 'name' ? sort?.reversed === true : sort?.reversed !== true
  return (
    <span role="columnheader" className={className} aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'} data-pivot-head={by}>
      <button type="button" className={styles.sortButton} data-sort-key={by} aria-pressed={active} title={title} onClick={() => onSort(by)}>
        <span className={styles.sortLabel}>{label}</span>
        {active && <span className={styles.sortMark} aria-hidden="true">{descending ? '▼' : '▲'}</span>}
      </button>
    </span>
  )
}

/**
 * The heat table: a row per row head (in `rows`' order), a column per
 * column head, the totals last; every cell opens its tasks. The name,
 * each column and Total head a sort button.
 */
function HeatTable({ title, nameLabel, stats, rows, sort, onSort, onDrill }: {
  title: string
  /** The name heading: what the rows split by (`Person`, `Status`, …). */
  nameLabel: string
  stats: PivotStats
  rows: readonly PivotHead[]
  sort: PivotSort | undefined
  onSort: (by: string) => void
  onDrill?: OnGlanceDrill
}) {
  const { cols, cells, max } = stats
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
          <SortHeading by="name" label={nameLabel} className={styles.corner} sort={sort} onSort={onSort} />
          {cols.map((c) => <SortHeading key={c.key} by={c.key} label={rowHeading(c)} title={rowHeading(c)} className={styles.colHead} sort={sort} onSort={onSort} />)}
          <SortHeading by="total" label="Total" className={styles.colHead} sort={sort} onSort={onSort} />
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
 * and total opens its tasks; the name, column and Total headings sort the
 * rows (view state, item 8). Small face: its title and its largest cell;
 * medium and large: the table. Its editor (Edit pivot…) opens under its
 * title.
 */
export function PivotWidget({ tab, onResult, onDrill }: GlanceWidgetProps<PivotTab>) {
  const config = tab.config
  const base = useStatsBase()
  const data = usePivotData(base, config)
  const [faceRef, face] = useWidgetFace()
  const title = config.name.trim() || 'Pivot'
  // A sort by a column the table no longer shows reads as the natural order.
  const stored = tab.viewState?.sort
  const sort = stored && isLivePivotSort(stored, data.stats) ? stored : undefined
  const rows = useMemo(() => sortPivotRows(data.stats, sort), [data.stats, sort])
  const lines = useMemo(() => pivotLines(title, data.stats, rows), [title, data.stats, rows])
  const onSort = (by: string) => {
    const next = nextBreakdownSort(sort, by)
    void useWorkspaceStore.getState().patchTabViewState(tab.id, 'pivot', { sort: next })
  }
  useReportLines(onResult, lines)
  const drill = glanceDrill(onDrill, data.count.filtered)
  const top = topCell(data.stats)
  const lensHides = lensHidesFor(useLensHidden(), config.filter)
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
          lens={<TabLensSwitch tab={tab} hides={lensHides} />}
        >
          {data.stats.ids.length === 0
            ? <Empty title="No tasks" hint="The tasks this pivot's filter keeps show here." />
            : <HeatTable title={title} nameLabel={SPLIT_ROW_LABELS[config.rows]} stats={data.stats} rows={rows} sort={sort} onSort={onSort} onDrill={drill} />}
        </ChartPanel>
      )}
    </GlanceFrame>
  )
}
