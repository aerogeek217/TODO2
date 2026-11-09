import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { NEUTRAL_PERSON_COLOR } from '../../../constants'
import { DEFAULT_STATUS_ICON } from '../../../models'
import type { BreakdownConfig, BreakdownSortKey, BreakdownSplit } from '../../../models/chart-widgets'
import type { BreakdownTab } from '../../../models/workspace-layout'
import { useBreakdownData } from '../../../hooks/use-chart-data'
import { useStatsBase } from '../../../hooks/use-glance-data'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { openReview } from '../../../services/review'
import { nextBreakdownSort, sortBreakdownRows, type BreakdownRow } from '../../../services/stats/breakdown'
import { useChartWidgetsStore } from '../../../stores/chart-widgets-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { trackScrollEdges } from '../../../utils/scroll-edges'
import { EntityMenu, type MenuEntity } from '../../shared/EntityMenu'
import { EnvelopeIcon } from '../../shared/icons'
import { useEntityMenuOffers } from '../../shared/person-menu-entries'
import { PersonCheckinMenu } from '../../shared/PersonCheckinMenu'
import { PriorityRing } from '../../shared/PriorityRing'
import { StatusIcon } from '../../shared/StatusIcon'
import { useTooltip } from '../../shared/use-tooltip'
import {
  breakdownLines, filteredRows, livePicks, rowFigure, sortHeading, sortWords, SPLIT_GLYPHS, SPLIT_ROW_LABELS,
} from './breakdown-copy'
import { breakdownRowDrill, breakdownRowReview, rowHeading, type RowReviewPart } from './chart-drills'
import { ChartPanel } from './chart-parts'
import { glanceDrill, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import type { GlanceDrill, OnGlanceDrill } from './glance-types'
import { GlanceFrame } from './GlanceFrame'
import { GlanceSmallFace } from './GlanceSmallFace'
import { Empty, PriorityBadges } from './section-parts'
import styles from './BreakdownWidget.module.css'

/** Colours for rows without one of their own (a due or age bucket, Unassigned), in order. */
const PALETTE = ['var(--hue-teal)', 'var(--hue-violet)', 'var(--hue-blue)', 'var(--hue-green)', 'var(--hue-amber)', 'var(--hue-rose)']

const PRIORITY_RING: Record<string, { focus: boolean; urgent: 'flag' | null; important: boolean }> = {
  focus: { focus: true, urgent: null, important: false },
  urgentImportant: { focus: false, urgent: 'flag', important: true },
  urgent: { focus: false, urgent: 'flag', important: false },
  important: { focus: false, urgent: null, important: true },
}

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
          <PriorityRing summary={PRIORITY_RING[e.group] ?? { focus: false, urgent: null, important: false }} completed={false} size={14} />
        </span>
      )
    case 'none':
      return <i className={`${styles.avatar} ${styles.avatarNone}`} aria-hidden="true" />
    default:
      return <i className={styles.dot} style={{ background: color }} aria-hidden="true" />
  }
}

/** A Due / Follow-up count: solid while any of it is overdue, outlined otherwise; a dim `–` for none. A click reviews those tasks (or opens them where there is no review). */
function BadgeCount({ n, overdue, part, label, onOpen }: {
  n: number
  overdue: number
  part: 'due' | 'followup'
  label: string
  onOpen?: () => void
}) {
  if (n === 0) return <span className={styles.dash} aria-label={`No ${part === 'due' ? 'due' : 'follow-up'} tasks`}>–</span>
  const cls = `${styles.badge} ${part === 'due' ? styles.badgeDue : styles.badgeFollowup} ${overdue > 0 ? styles.badgeSolid : ''}`
  if (!onOpen) return <span className={cls} data-badge-part={part} data-solid={overdue > 0 ? '' : undefined}>{n}</span>
  return (
    <button
      type="button"
      className={cls}
      data-badge-part={part}
      data-solid={overdue > 0 ? '' : undefined}
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

/** A person row's envelope: their check-in menu (`PersonCheckinMenu`: Review · Email check-in · Paste reply). */
function RowEnvelope({ person }: { person: { id: number; name: string } }) {
  const { triggerProps, tooltip } = useTooltip('Email check-in')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={styles.envelope}
        aria-label={`Email check-in options for ${person.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        {...triggerProps}
      >
        <EnvelopeIcon />
      </button>
      {tooltip}
      {open && <PersonCheckinMenu person={person} anchorRef={ref} placement="bottom-end" onClose={() => setOpen(false)} />}
    </>
  )
}

/** The entity a row's right-click opens the person / tag menu for. */
function rowEntity(row: BreakdownRow): MenuEntity | null {
  if (row.entity.kind === 'person') return { kind: 'person', entity: row.entity.person }
  if (row.entity.kind === 'tag') return { kind: 'tag', entity: row.entity.tag }
  return null
}

interface TableProps {
  title: string
  config: BreakdownConfig
  rows: readonly BreakdownRow[]
  /** Medium: name · Due · Follow-up, no bar, priority or envelope. */
  compact: boolean
  sortBy: BreakdownSortKey | null
  reversed: boolean
  onSort: (by: BreakdownSortKey) => void
  onDrill?: OnGlanceDrill
  /** Reviews open from here (desktop, outside dialogs, no deck open). */
  review: boolean
  /** The bar column (bars at the large face). */
  bars: boolean
}

/**
 * The rows as a table: name · (bar) · Open (or Oldest) · Priority · Due ·
 * Follow-up (· the envelope), each heading a sort button. A row's click
 * opens its tasks; Review ▸ (on its hover or focus) and its Due / Follow-up
 * counts open the review deck on them; a person's or tag's right-click (or
 * Shift+F10) opens its menu.
 */
function BreakdownTable({ title, config, rows, compact, sortBy, reversed, onSort, onDrill, review, bars }: TableProps) {
  const { splitBy, show } = config
  const [menu, setMenu] = useState<{ entity: MenuEntity; at: { x: number; y: number } } | null>(null)
  const envelope = !compact && config.checkins === true && splitBy === 'people'
  const priority = !compact && splitBy !== 'priority'
  const figure = !compact
  const max = Math.max(1, ...rows.map((r) => (show === 'oldest' ? Math.max(0, r.oldest?.days ?? 0) : r.ids.length)))
  // A narrow table (`@container`, under 400px) drops the bar and the priority columns.
  const columnsOf = (narrow: boolean) => [
    'minmax(0, 1fr)',
    bars && !compact && !narrow ? '84px' : null,
    figure ? '44px' : null,
    priority && !narrow ? '76px' : null,
    '44px',
    '64px',
    envelope ? '26px' : null,
  ].filter(Boolean).join(' ')
  const keys: BreakdownSortKey[] = ['name', ...(figure ? ['open' as const] : []), ...(priority ? ['priority' as const] : []), 'due', 'followup']
  const heading = (by: BreakdownSortKey) => {
    const active = sortBy === by
    const label = sortHeading(by, splitBy, show)
    // Counts go largest first, names A–Z; a second click reverses.
    const descending = by === 'name' ? reversed : !reversed
    return (
      <span
        key={by}
        role="columnheader"
        aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'}
        className={`${styles.headCell} ${by === 'name' ? styles.headName : styles.headNum} ${by === 'name' && bars && !compact ? styles.headSpan : ''}`}
        data-col={by === 'priority' ? 'priority' : undefined}
      >
        <button type="button" className={styles.sortButton} data-sort-key={by} aria-pressed={active} onClick={() => onSort(by)}>
          {label}
          {active && <span className={styles.sortMark} aria-hidden="true">{descending ? '▼' : '▲'}</span>}
        </button>
      </span>
    )
  }
  return (
    <div className={styles.table} role="table" aria-label={title} style={{ '--bd-cols': columnsOf(false), '--bd-cols-narrow': columnsOf(true) } as CSSProperties} data-compact={compact ? '' : undefined}>
      <div className={`${styles.grid} ${styles.head}`} role="row">
        {keys.map(heading)}
        {envelope && <span role="columnheader" className={styles.headCell}><span className={styles.srOnly}>Check-in</span></span>}
      </div>
      <div ref={trackScrollEdges} className={styles.body} role="rowgroup">
        {rows.map((row, i) => {
          const heading = rowHeading(row)
          const color = rowColor(row, i)
          const open = onDrill ? () => onDrill(breakdownRowDrill(title, row)) : undefined
          const reviewPart = (part: RowReviewPart) => () => { openReview(breakdownRowReview(title, row, part)) }
          const drillPart = (part: 'due' | 'followup') => onDrill
            ? () => onDrill({ ...breakdownRowDrill(title, row), title: `${title} · ${heading} · ${part === 'due' ? 'Due' : 'Follow-up'}`, source: { kind: 'todos', todoIds: [...(part === 'due' ? row.dueIds : row.followupIds)] } })
            : undefined
          const entity = rowEntity(row)
          const value = show === 'oldest' ? Math.max(0, row.oldest?.days ?? 0) : row.ids.length
          const late = row.dueOverdue
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
                {review && (
                  <button
                    type="button"
                    className={styles.review}
                    data-testid="breakdown-review"
                    aria-label={`Review ${heading}: ${n} ${n === 1 ? 'task' : 'tasks'}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      reviewPart('all')()
                    }}
                  >
                    Review ▸
                  </button>
                )}
              </span>
              {bars && !compact && (
                <span role="cell" className={styles.bar} data-col="bar" aria-hidden="true">
                  {show === 'count' && late > 0 && <span className={styles.barLate} style={{ width: `${(late / max) * 100}%` }} />}
                  <span className={styles.barRest} style={{ width: `${((value - (show === 'count' ? late : 0)) / max) * 100}%` }} />
                </span>
              )}
              {figure && (
                <span
                  role="cell"
                  className={styles.num}
                  data-testid="breakdown-figure"
                  style={show === 'oldest' && row.followupOverdue > 0 ? { color: 'var(--color-followup)' } : undefined}
                >
                  {rowFigure(row, show)}
                </span>
              )}
              {priority && <span role="cell" className={styles.priority} data-col="priority"><PriorityBadges counts={row.priority} /></span>}
              <span role="cell" className={styles.numCell}>
                <BadgeCount
                  n={row.dueIds.length}
                  overdue={row.dueOverdue}
                  part="due"
                  label={`${review ? 'Review' : 'Show'} ${heading}'s ${row.dueIds.length} due`}
                  onOpen={review ? reviewPart('due') : drillPart('due')}
                />
              </span>
              <span role="cell" className={styles.numCell}>
                <BadgeCount
                  n={row.followupIds.length}
                  overdue={row.followupOverdue}
                  part="followup"
                  label={`${review ? 'Review' : 'Show'} ${heading}'s ${row.followupIds.length} follow-up${row.followupIds.length === 1 ? '' : 's'}`}
                  onOpen={review ? reviewPart('followup') : drillPart('followup')}
                />
              </span>
              {envelope && (
                <span role="cell" className={styles.numCell}>
                  {row.entity.kind === 'person' && <RowEnvelope person={row.entity.person} />}
                </span>
              )}
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
 * (name · Due · Follow-up); large the chart, the table with its sortable
 * headings (view state, per split) and the filter row. Its editor (Edit
 * breakdown…, `ChartEditorHost`) opens under its title (`data-chart-head`).
 */
export function BreakdownWidget({ tab, onResult, onDrill }: GlanceWidgetProps<BreakdownTab>) {
  const config = tab.config
  const base = useStatsBase()
  const data = useBreakdownData(base, config)
  const [faceRef, face] = useWidgetFace()
  const offers = useEntityMenuOffers()
  const sort = tab.viewState?.sorts?.[config.splitBy]
  const picks = useChartWidgetsStore((s) => s.rowPicks[tab.id]?.[config.splitBy]) ?? NO_PICKS
  const [typed, setTyped] = useState<{ split: BreakdownSplit; text: string }>({ split: config.splitBy, text: '' })
  const text = typed.split === config.splitBy ? typed.text : ''

  const title = config.name.trim() || 'Breakdown'
  const all = useMemo(
    () => sortBreakdownRows(data.stats.rows.filter((r) => config.showNone || r.entity.kind !== 'none'), sort, config.show),
    [data.stats.rows, config.showNone, sort, config.show],
  )
  const large = face === 'large'
  const shownPicks = useMemo(() => livePicks(all, picks), [all, picks])
  const rows = large ? filteredRows(all, shownPicks, text) : all
  const total = data.stats.ids.length
  const word = data.tasks.some((t) => t.isCompleted) ? 'tasks' : 'open'
  const lines = useMemo(() => breakdownLines(title, total, word, all, config.show), [title, total, word, all, config.show])
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
        rows={rows}
        compact={!large}
        sortBy={sort?.by ?? null}
        reversed={sort?.reversed === true}
        onSort={onSort}
        onDrill={drill}
        review={offers.review}
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
        sub={large ? sortWords(sort, config.splitBy, config.show) : undefined}
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

