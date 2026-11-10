import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { NEUTRAL_PERSON_COLOR } from '../../../constants'
import { DEFAULT_STATUS_ICON } from '../../../models'
import { columnIsLit, liveBreakdownSort, type BreakdownColumn, type BreakdownConfig, type BreakdownSortKey, type BreakdownSplit } from '../../../models/chart-widgets'
import { tabIgnoresLens, type BreakdownTab } from '../../../models/workspace-layout'
import { useBreakdownData } from '../../../hooks/use-chart-data'
import { lensHidesFor, useLensHidden, useStatsBase } from '../../../hooks/use-glance-data'
import { TabLensSwitch } from '../LensSwitch'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { openReview } from '../../../services/review'
import { columnCount, nextBreakdownSort, PRIORITY_GROUP_RINGS, sortBreakdownRows, type BreakdownRow } from '../../../services/stats/breakdown'
import { useChartWidgetsStore } from '../../../stores/chart-widgets-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { trackScrollEdges } from '../../../utils/scroll-edges'
import { EntityMenu, type MenuEntity } from '../../shared/EntityMenu'
import { EnvelopeIcon, ReviewIcon } from '../../shared/icons'
import { useEntityMenuOffers } from '../../shared/person-menu-entries'
import { PersonCheckinMenu } from '../../shared/PersonCheckinMenu'
import { PriorityRing } from '../../shared/PriorityRing'
import { StatusIcon } from '../../shared/StatusIcon'
import { useTooltip } from '../../shared/use-tooltip'
import {
  breakdownLines, columnHeading, filteredRows, livePicks, rowFigure, sortHeading, SPLIT_GLYPHS, SPLIT_ROW_LABELS,
} from './breakdown-copy'
import { breakdownColumnDrill, breakdownRowDrill, breakdownRowLens, breakdownRowReview, rowHeading } from './chart-drills'
import { ChartPanel } from './chart-parts'
import { glanceDrill, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import type { GlanceDrill, OnGlanceDrill } from './glance-types'
import { GlanceFrame } from './GlanceFrame'
import { GlanceSmallFace } from './GlanceSmallFace'
import { Empty } from './section-parts'
import { themeColor } from '../../../utils/theme-color'
import styles from './BreakdownWidget.module.css'

/** Colours for rows without one of their own (a due or age bucket, Unassigned), in order. */
const PALETTE = ['var(--hue-teal)', 'var(--hue-violet)', 'var(--hue-blue)', 'var(--hue-green)', 'var(--hue-amber)', 'var(--hue-rose)']

const DUE_COLORS: Record<string, string> = {
  overdue: 'var(--color-overdue)',
  today: 'var(--color-overdue)',
  week: 'var(--hue-amber)',
  later: 'var(--hue-teal)',
}

/** A row's colour in a donut or stacked bar. */
function rowColor(row: BreakdownRow, i: number): string {
  if (row.entity.kind === 'none') return 'var(--color-text-muted)'
  if (row.entity.kind === 'priority') return row.entity.group === 'important' ? 'var(--color-marker-important)' : row.entity.group === 'focus' ? 'var(--color-marker-focus)' : 'var(--color-marker-urgent)'
  if (row.entity.kind === 'due') return DUE_COLORS[row.entity.bucket] ?? 'var(--color-text-secondary)'
  return row.color || PALETTE[i % PALETTE.length] || 'var(--color-text-secondary)'
}

/** What leads a row's name: a person's avatar, a tag's dot, a status's glyph, a priority's ring, a bucket's dot. */
function RowMark({ row, color }: { row: BreakdownRow; color: string }) {
  const e = row.entity
  switch (e.kind) {
    case 'person':
      return (
        <i className={styles.avatar} style={{ background: e.person.color || NEUTRAL_PERSON_COLOR }} aria-hidden="true">
          {(e.person.initials || e.person.name).charAt(0).toUpperCase()}
        </i>
      )
    case 'status':
      return <span className={styles.mark} style={{ color: e.status.color }} aria-hidden="true"><StatusIcon icon={e.status.icon ?? DEFAULT_STATUS_ICON} filled /></span>
    case 'priority':
      return (
        <span className={styles.ringBox} aria-hidden="true">
          <span className={styles.ringBorder} />
          <PriorityRing summary={PRIORITY_GROUP_RINGS[e.group]} completed={false} size={14} />
        </span>
      )
    case 'none':
      return <i className={`${styles.avatar} ${styles.avatarNone}`} aria-hidden="true" />
    default:
      return <i className={styles.dot} style={{ background: color }} aria-hidden="true" />
  }
}

/**
 * A count column's count (board BC): filled solid in the column's colour
 * while it meets the column's Light up when rule, outlined in it otherwise;
 * a dim `–` for none. A click reviews those tasks (or opens them where there
 * is no review).
 */
function ColumnCount({ n, column, label, onOpen }: {
  n: number
  column: BreakdownColumn
  label: string
  onOpen?: () => void
}) {
  if (n === 0) return <span className={styles.dash} aria-label={`No tasks in ${columnHeading(column)}`}>–</span>
  const lit = columnIsLit(column, n)
  const cls = `${styles.badge} ${lit ? styles.badgeSolid : ''}`
  // Outlined, the count is text in the colour as the theme draws it (J21);
  // solid, the fill is the colour as picked, under the dark on-hue text.
  const style = { '--col-color': themeColor(column.color), '--col-fill': column.color } as CSSProperties
  const marks = { 'data-column': column.id, 'data-solid': lit ? '' : undefined }
  if (!onOpen) return <span className={cls} style={style} {...marks}>{n}</span>
  return (
    <button
      type="button"
      className={cls}
      style={style}
      {...marks}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
    >
      {n}
    </button>
  )
}

/** A row's Review button (board BC): a muted icon right after the row's name, shown on the row's hover or focus; starts the review deck on the row's tasks. */
function RowReview({ heading, n, onReview }: { heading: string; n: number; onReview: () => void }) {
  const { triggerProps, tooltip } = useTooltip('Review')
  return (
    <>
      <button
        type="button"
        className={styles.rowAction}
        data-testid="breakdown-review"
        aria-label={`Review ${heading}: ${n} ${n === 1 ? 'task' : 'tasks'}`}
        onClick={(e) => {
          e.stopPropagation()
          onReview()
        }}
        {...triggerProps}
      >
        <ReviewIcon size={15} />
      </button>
      {tooltip}
    </>
  )
}

/** A person row's envelope (board BC, beside Review): their check-in menu — Email check-in · Paste reply (Review is its own button here). */
function RowEnvelope({ person }: { person: { id: number; name: string } }) {
  const { triggerProps, tooltip } = useTooltip('Email check-in')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={styles.rowAction}
        data-testid="breakdown-envelope"
        aria-label={`Email check-in options for ${person.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        {...triggerProps}
      >
        <EnvelopeIcon size={15} />
      </button>
      {tooltip}
      {open && <PersonCheckinMenu person={person} anchorRef={ref} placement="bottom-start" review={false} onClose={() => setOpen(false)} />}
    </>
  )
}

/** The entity a row's right-click opens the person / tag menu for. */
function rowEntity(row: BreakdownRow): MenuEntity | null {
  if (row.entity.kind === 'person') return { kind: 'person', entity: row.entity.person }
  if (row.entity.kind === 'tag') return { kind: 'tag', entity: row.entity.tag }
  return null
}

/**
 * A count column's width: its number's room (a three-digit badge), never
 * its heading's — the heading is cut short with an ellipsis, its name in
 * the tooltip, so the name column gets the rest.
 */
const COLUMN_PX = 40

/** A count column's width in a narrow table (under 400px): a two-digit badge's. */
const NARROW_COLUMN_PX = 30

interface TableProps {
  title: string
  config: BreakdownConfig
  columns: readonly BreakdownColumn[]
  rows: readonly BreakdownRow[]
  /** Medium: name (· Review after it) · the count columns, no bar, Open or envelope. */
  compact: boolean
  sortBy: BreakdownSortKey | null
  reversed: boolean
  onSort: (by: BreakdownSortKey) => void
  onDrill?: OnGlanceDrill
  /** Reviews open from here (desktop, outside dialogs, no deck open). */
  review: boolean
  /** The widget ignores the top bar's lens (its switch): how a row's review starts (item 10). */
  ignoresLens: boolean
  /** The bar column (bars at the large face). */
  bars: boolean
}

/**
 * The rows as a table: name · (bar) · Open (or Oldest) · each count
 * column, each heading a sort button; the row's actions (Review, and a
 * person's envelope) right after its name, shown while the row is hovered
 * or holds the focus. A row's click opens its tasks; its Review button and
 * a count column's count open the review deck on them; a person's or tag's
 * right-click (or Shift+F10) opens its menu.
 */
function BreakdownTable({ title, config, columns, rows, compact, sortBy, reversed, onSort, onDrill, review, ignoresLens, bars }: TableProps) {
  const { splitBy, show } = config
  const [menu, setMenu] = useState<{ entity: MenuEntity; at: { x: number; y: number } } | null>(null)
  const envelope = !compact && config.checkins === true && splitBy === 'people'
  const figure = !compact
  const max = Math.max(1, ...rows.map((r) => (show === 'oldest' ? Math.max(0, r.oldest?.days ?? 0) : r.ids.length)))
  // A narrow table (`@container`, under 400px) drops the bar, and its count columns take a two-digit badge's room.
  const columnsOf = (narrow: boolean) => [
    'minmax(0, 1fr)',
    bars && !compact && !narrow ? '84px' : null,
    figure ? '44px' : null,
    ...columns.map(() => `${narrow ? NARROW_COLUMN_PX : COLUMN_PX}px`),
  ].filter(Boolean).join(' ')
  const keys: BreakdownSortKey[] = ['name', ...(figure ? ['open'] : []), ...columns.map((c) => c.id)]
  const heading = (by: BreakdownSortKey) => {
    const active = sortBy === by
    const label = sortHeading(by, splitBy, show, columns)
    // Counts go largest first, names A–Z; a second click reverses.
    const descending = by === 'name' ? reversed : !reversed
    const fixed = by === 'name' || by === 'open'
    return (
      <span
        key={by}
        role="columnheader"
        aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'}
        className={`${styles.headCell} ${by === 'name' ? styles.headName : fixed ? styles.headNum : styles.headCount} ${by === 'name' && bars && !compact ? styles.headSpan : ''}`}
      >
        <button type="button" className={styles.sortButton} data-sort-key={by} aria-pressed={active} title={fixed ? undefined : label} onClick={() => onSort(by)}>
          <span className={styles.sortLabel}>{label}</span>
          {active && <span className={styles.sortMark} aria-hidden="true">{descending ? '▼' : '▲'}</span>}
        </button>
      </span>
    )
  }
  return (
    <div className={styles.table} role="table" aria-label={title} style={{ '--bd-cols': columnsOf(false), '--bd-cols-narrow': columnsOf(true) } as CSSProperties} data-compact={compact ? '' : undefined}>
      <div className={`${styles.grid} ${styles.head}`} role="row">
        {keys.map(heading)}
      </div>
      <div ref={trackScrollEdges} className={styles.body} role="rowgroup">
        {rows.map((row, i) => {
          const heading = rowHeading(row)
          const color = rowColor(row, i)
          const open = onDrill ? () => onDrill(breakdownRowDrill(title, row)) : undefined
          const entity = rowEntity(row)
          const value = show === 'oldest' ? Math.max(0, row.oldest?.days ?? 0) : row.ids.length
          const late = row.overdue
          const n = row.ids.length
          const words = `${heading}: ${n} ${n === 1 ? 'task' : 'tasks'}${show === 'oldest' && row.oldest ? `, oldest ${row.oldest.days} days` : ''}`
          return (
            <div
              key={row.key}
              role="row"
              className={`${styles.grid} ${styles.row}`}
              data-breakdown-row={row.key}
              onClick={(e: MouseEvent) => {
                // Not a click in a menu portaled from the row (its events bubble here through React).
                if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return
                open?.()
              }}
              onContextMenu={entity ? (e: MouseEvent) => {
                if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return
                e.preventDefault()
                setMenu({ entity, at: { x: e.clientX, y: e.clientY } })
              } : undefined}
              onKeyDown={entity ? (e: KeyboardEvent<HTMLDivElement>) => {
                if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return
                e.preventDefault()
                e.stopPropagation()
                const r = e.currentTarget.getBoundingClientRect()
                setMenu({ entity, at: { x: r.left + 8, y: r.bottom + 4 } })
              } : undefined}
            >
              <span role="cell" className={styles.nameCell}>
                <button
                  type="button"
                  className={styles.nameButton}
                  aria-label={`${words}. Show tasks`}
                  onClick={(e) => {
                    e.stopPropagation()
                    open?.()
                  }}
                >
                  <RowMark row={row} color={color} />
                  <span className={styles.nameText}>
                    <span className={styles.name}>{heading}</span>
                    {show === 'oldest' && !compact && row.oldest && (
                      <span className={styles.sub}>{`${n} ${n === 1 ? 'task' : 'tasks'} · ${row.oldest.title}`}</span>
                    )}
                  </span>
                </button>
                {(review || (envelope && row.entity.kind === 'person')) && (
                  <span className={styles.nameActions} data-testid="breakdown-row-actions">
                    {review && <RowReview heading={heading} n={n} onReview={() => { openReview(breakdownRowReview(title, row, 'all', breakdownRowLens(config, ignoresLens, row.key, 'all'))) }} />}
                    {envelope && row.entity.kind === 'person' && <RowEnvelope person={row.entity.person} />}
                  </span>
                )}
              </span>
              {bars && !compact && (
                <span role="cell" className={styles.bar} data-col="bar" aria-hidden="true">
                  {show === 'count' && late > 0 && <span className={styles.barLate} style={{ width: `${(late / max) * 100}%` }} />}
                  <span className={styles.barRest} style={{ width: `${((value - (show === 'count' ? late : 0)) / max) * 100}%` }} />
                </span>
              )}
              {figure && (
                <span role="cell" className={styles.num} data-testid="breakdown-figure">
                  {rowFigure(row, show)}
                </span>
              )}
              {columns.map((column) => {
                const count = columnCount(row, column.id)
                const name = columnHeading(column)
                return (
                  <span key={column.id} role="cell" className={styles.countCell}>
                    <ColumnCount
                      n={count}
                      column={column}
                      label={`${review ? 'Review' : 'Show'} ${heading}'s ${count} in ${name}`}
                      onOpen={review
                        ? () => { openReview(breakdownRowReview(title, row, { columnId: column.id, heading: name }, breakdownRowLens(config, ignoresLens, row.key, { columnId: column.id, heading: name }))) }
                        : onDrill ? () => onDrill(breakdownColumnDrill(title, row, column.id, name)) : undefined}
                    />
                  </span>
                )
              })}
            </div>
          )
        })}
      </div>
      {menu && (
        <EntityMenu entities={[menu.entity]} point={menu.at} closeOnScroll restoreFocus onClose={() => setMenu(null)} />
      )}
    </div>
  )
}

/** A stacked bar of the rows (style `stacked`): a segment each, its share of the tasks; a click opens its tasks. */
function StackedBar({ title, rows, onDrill }: { title: string; rows: readonly BreakdownRow[]; onDrill?: OnGlanceDrill }) {
  const total = rows.reduce((n, r) => n + r.ids.length, 0)
  if (total === 0) return null
  return (
    <div className={styles.stacked} role="group" aria-label={`${title} as a stacked bar`} data-testid="breakdown-stacked">
      {rows.map((r, i) => (r.ids.length > 0 && (
        <button
          key={r.key}
          type="button"
          className={styles.segment}
          style={{ flex: `${r.ids.length} 1 0`, background: rowColor(r, i) }}
          data-segment={r.key}
          aria-label={`${rowHeading(r)}: ${r.ids.length}. Show tasks`}
          title={`${rowHeading(r)}: ${r.ids.length}`}
          disabled={!onDrill}
          onClick={() => onDrill?.(breakdownRowDrill(title, r))}
        />
      )))}
    </div>
  )
}

const DONUT_R = 15.9155 // a circumference of 100

/** A donut of the rows (style `donut`): a segment each; a click opens its tasks. */
function Donut({ title, rows, onDrill }: { title: string; rows: readonly BreakdownRow[]; onDrill?: OnGlanceDrill }) {
  const total = rows.reduce((n, r) => n + r.ids.length, 0)
  if (total === 0) return null
  // Each segment's start, as a share of the ring (from 12 o'clock).
  const starts = rows.reduce<number[]>((acc, r, i) => [...acc, (acc[i] ?? 0) + (r.ids.length / total) * 100], [0])
  return (
    <svg className={styles.donut} viewBox="0 0 42 42" role="group" aria-label={`${title} as a donut`} data-testid="breakdown-donut">
      <circle cx="21" cy="21" r={DONUT_R} fill="none" stroke="var(--color-tint-8)" strokeWidth="6" />
      {rows.map((r, i) => {
        if (r.ids.length === 0) return null
        const share = (r.ids.length / total) * 100
        const offset = 25 - (starts[i] ?? 0)
        return (
          <circle
            key={r.key}
            cx="21"
            cy="21"
            r={DONUT_R}
            fill="none"
            stroke={rowColor(r, i)}
            strokeWidth="6"
            strokeDasharray={`${share} ${100 - share}`}
            strokeDashoffset={offset}
            className={onDrill ? styles.donutSegment : undefined}
            data-segment={r.key}
            role={onDrill ? 'button' : undefined}
            tabIndex={onDrill ? 0 : undefined}
            aria-label={`${rowHeading(r)}: ${r.ids.length}. Show tasks`}
            onClick={onDrill ? () => onDrill(breakdownRowDrill(title, r)) : undefined}
            onKeyDown={onDrill ? (e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              onDrill(breakdownRowDrill(title, r))
            } : undefined}
          >
            <title>{`${rowHeading(r)}: ${r.ids.length}`}</title>
          </circle>
        )
      })}
      <text x="21" y="23.5" textAnchor="middle" className={styles.donutTotal}>{total}</text>
    </svg>
  )
}

/**
 * The filter row (large face only, board F): a label (Person / Tag /
 * Status / Priority …) and a field. Typing narrows the rows by name;
 * Enter picks the first match as a chip (picks OR); Backspace in the empty
 * field takes the last chip back, Esc clears the text, × clears it all.
 * Temporary: per tab and split, never in the layout.
 */
function BreakdownFilterRow({ split, rows, picks, text, onPicks, onText }: {
  split: BreakdownSplit
  rows: readonly BreakdownRow[]
  picks: readonly string[]
  text: string
  onPicks: (keys: readonly string[]) => void
  onText: (text: string) => void
}) {
  const label = SPLIT_ROW_LABELS[split]
  const inputRef = useRef<HTMLInputElement>(null)
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const picked = picks.flatMap((k) => {
    const r = byKey.get(k)
    return r ? [r] : []
  })
  const query = text.trim().toLowerCase()
  return (
    <div className={styles.filterRow} data-testid="breakdown-filter-row">
      <span className={styles.filterLabel} aria-hidden="true">{label}</span>
      <span className={styles.filterField} onClick={() => inputRef.current?.focus()}>
        {picked.map((r) => (
          <span key={r.key} className={styles.chip} data-testid="breakdown-filter-chip">
            {rowHeading(r)}
            <button
              type="button"
              className={styles.chipRemove}
              aria-label={`Remove ${rowHeading(r)}`}
              onClick={(e) => {
                e.stopPropagation()
                onPicks(picks.filter((k) => k !== r.key))
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className={styles.filterInput}
          aria-label={`Filter by ${label.toLowerCase()}`}
          placeholder={picked.length > 0 ? '' : `Type a ${label.toLowerCase()}…`}
          value={text}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (!query) return
              const first = rows.find((r) => !picks.includes(r.key) && r.label.toLowerCase().includes(query))
              if (first) onPicks([...picks, first.key])
              onText('')
            } else if (e.key === 'Backspace' && text === '' && picks.length > 0) {
              e.preventDefault()
              onPicks(picks.slice(0, -1))
            } else if (e.key === 'Escape' && text !== '') {
              e.preventDefault()
              e.stopPropagation()
              onText('')
            }
          }}
        />
        {(picked.length > 0 || text !== '') && (
          <button
            type="button"
            className={styles.clear}
            aria-label={`Clear the ${label.toLowerCase()} filter`}
            onClick={(e) => {
              e.stopPropagation()
              onPicks([])
              onText('')
              inputRef.current?.focus()
            }}
          >
            ×
          </button>
        )}
      </span>
    </div>
  )
}

const NO_PICKS: readonly string[] = []

/**
 * The Breakdown widget (D26 P8, board Z1): the tasks its filter keeps under
 * the top bar's filter, split by people, tags, status, priority, due date
 * or age — a row each, as bars, a donut or one stacked bar. By its face
 * (D25 R): small is its title and the top row; medium a compact table
 * (name · its count columns); large the chart, the table with its sortable
 * headings (view state, per split) and the filter row. Its editor (Edit
 * breakdown…, `ChartEditorHost`) opens under its title (`data-chart-head`).
 */
export function BreakdownWidget({ tab, onResult, onDrill }: GlanceWidgetProps<BreakdownTab>) {
  const config = tab.config
  const base = useStatsBase()
  const data = useBreakdownData(base, config)
  const [faceRef, face] = useWidgetFace()
  const offers = useEntityMenuOffers()
  const storedSort = tab.viewState?.sorts?.[config.splitBy]
  const columnIds = useMemo(() => data.columns.map((c) => c.id), [data.columns])
  // A sort by a column it no longer has reads as the default order; an older derived column's as the Due / Follow-up column.
  const sort = liveBreakdownSort(storedSort, columnIds)
  const picks = useChartWidgetsStore((s) => s.rowPicks[tab.id]?.[config.splitBy]) ?? NO_PICKS
  const [typed, setTyped] = useState<{ split: BreakdownSplit; text: string }>({ split: config.splitBy, text: '' })
  const text = typed.split === config.splitBy ? typed.text : ''

  const title = config.name.trim() || 'Breakdown'
  const all = useMemo(
    () => sortBreakdownRows(data.stats.rows.filter((r) => config.showNone || r.entity.kind !== 'none'), sort, config.show, columnIds),
    [data.stats.rows, config.showNone, sort, config.show, columnIds],
  )
  const large = face === 'large'
  const shownPicks = useMemo(() => livePicks(all, picks), [all, picks])
  const rows = large ? filteredRows(all, shownPicks, text) : all
  // What the rows shown hold (a task in several rows once): the header, Copy and the count's drill
  // agree, a hidden none row counted in none of them.
  const total = useMemo(() => new Set(all.flatMap((r) => r.ids)).size, [all])
  const word = data.tasks.some((t) => t.isCompleted) ? 'tasks' : 'open'
  const lines = useMemo(() => breakdownLines(title, total, word, all, config.show, data.columns), [title, total, word, all, config.show, data.columns])
  useReportLines(onResult, lines)

  const drill = glanceDrill(onDrill, data.count.filtered)
  const onSort = (by: BreakdownSortKey) => {
    const next = nextBreakdownSort(sort, by)
    const sorts = { ...tab.viewState?.sorts }
    if (next) sorts[config.splitBy] = next
    else delete sorts[config.splitBy]
    void useWorkspaceStore.getState().patchTabViewState(tab.id, 'breakdown', { sorts })
  }
  const glyph = SPLIT_GLYPHS[config.splitBy]
  const lensHides = lensHidesFor(useLensHidden(), config.filter)

  let body: ReactNode
  if (face === 'small') {
    const top = all.at(0)
    body = (
      <GlanceSmallFace
        glyph={glyph}
        glyphColor="var(--color-accent)"
        title={title}
        entry={top ? rowHeading(top) : undefined}
        value={top ? rowFigure(top, config.show) : '0'}
        caption={top && config.show === 'count' ? 'open' : top ? undefined : 'open'}
      />
    )
  } else {
    const allDrill = drill && total > 0 ? () => drill(groupsDrill(title, all)) : undefined
    const table = (
      <BreakdownTable
        title={title}
        config={config}
        columns={data.columns}
        rows={rows}
        compact={!large}
        sortBy={sort?.by ?? null}
        reversed={sort?.reversed === true}
        onSort={onSort}
        onDrill={drill}
        review={offers.review}
        ignoresLens={tabIgnoresLens(tab)}
        bars={config.style === 'bars'}
      />
    )
    body = (
      <ChartPanel
        tabId={tab.id}
        kind="breakdown"
        title={title}
        glyph={glyph}
        count={`${total} ${word}`}
        onCount={allDrill}
        lens={<TabLensSwitch tab={tab} hides={lensHides} />}
      >
        {all.length === 0 ? (
          <Empty title="No tasks" hint="The tasks this breakdown's filter keeps show here." />
        ) : (
          <>
            {large && (
              <BreakdownFilterRow
                split={config.splitBy}
                rows={all}
                picks={shownPicks}
                text={text}
                onPicks={(keys) => useChartWidgetsStore.getState().setRowPicks(tab.id, config.splitBy, keys)}
                onText={(t) => setTyped({ split: config.splitBy, text: t })}
              />
            )}
            {config.style === 'stacked' && <StackedBar title={title} rows={rows} onDrill={drill} />}
            {config.style === 'donut' && large ? (
              <div className={styles.donutLayout}>
                <Donut title={title} rows={rows} onDrill={drill} />
                {table}
              </div>
            ) : table}
          </>
        )}
      </ChartPanel>
    )
  }
  return (
    <GlanceFrame tab={tab} faceRef={faceRef} face={face}>
      {body}
    </GlanceFrame>
  )
}

/** The header count's click: every row's tasks, each under its row's heading. */
function groupsDrill(title: string, rows: readonly BreakdownRow[]): GlanceDrill {
  return {
    title,
    glyph: 'chart',
    description: `${title}: every row's tasks. A task in several rows shows under each.`,
    source: {
      kind: 'groups',
      groups: rows.map((r) => ({ key: r.key, label: rowHeading(r), ...(r.color ? { color: r.color } : {}), todoIds: [...r.ids] })),
    },
  }
}

