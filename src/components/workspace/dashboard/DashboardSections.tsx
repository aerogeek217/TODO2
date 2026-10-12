import { useMemo, type CSSProperties, type ReactNode } from 'react'
import type { PersistedTodoItem } from '../../../models'
import {
  DEFAULT_DASHBOARD_LOOK_AHEAD,
  type DashboardSectionOptions,
} from '../../../models/dashboard-config'
import { idsByDate } from '../../../services/stats/stats-context'
import { NEUTRAL_PERSON_COLOR } from '../../../constants'
import { usePersonStore } from '../../../stores/person-store'
import { useUIStore } from '../../../stores/ui-store'
import { rowKey } from '../../../utils/scoped-selection'
import { MobileTaskRow } from '../../task/MobileTaskRow'
import { StatusIcon } from '../../shared/StatusIcon'
import { ListWidgetRow } from '../list/ListWidgetRow'
import { useElementSize } from '../calendar/use-element-size'
import { countOf, hotRuleInWords, nextDayLabels, signed, sinceLabel, trendBucketLabel, trendRangeLabel } from './dashboard-copy'
import { DashGlyph } from './glyphs'
import { SECTION_META, type DashboardSectionMeta } from './section-meta'
import type { DashboardData } from './use-dashboard-data'
import type { DashboardRowKit, OnDashboardDrill } from './types'
import styles from './DashboardWidget.module.css'

/** What every section is rendered with. */
export interface DashboardSectionProps {
  data: DashboardData
  /** The section's options from the tab config. */
  options: DashboardSectionOptions
  rows: DashboardRowKit
  onDrill?: OnDashboardDrill
  /** Its place in the grid (column span). */
  style?: CSSProperties
}

// ── Shared parts ────────────────────────────────────────────────────────────

function Panel({ def, count, sub, extras, style, children }: {
  def: DashboardSectionMeta
  count?: string
  sub?: string
  extras?: ReactNode
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <section className={`${styles.panel} ${styles.surface}`} style={style} aria-label={def.title} data-dash-section={def.id}>
      <div className={styles.panelHeader}>
        <DashGlyph name={def.glyph} color={def.glyphColor} />
        <span className={styles.panelTitle}>{def.title}</span>
        {count != null && <span className={styles.panelCount} data-testid="dash-section-count">{count}</span>}
        {sub && <span className={styles.panelSub}>{sub}</span>}
        {extras && <span className={styles.panelExtras}>{extras}</span>}
      </div>
      {children}
    </section>
  )
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyTitle}>{title}</span>
      <span className={styles.emptyHint}>{hint}</span>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className={styles.legend}>
      <i className={styles.swatch} style={{ background: color }} />
      {label}
    </span>
  )
}

/** A button when the number can be opened, else a plain element with the same look. */
function Clickable({ as, className, label, onClick, children, ...rest }: {
  as: 'div' | 'span'
  className?: string
  label?: string
  onClick?: () => void
  children: ReactNode
} & Record<`data-${string}`, string | undefined>) {
  if (onClick) {
    return <button type="button" className={className} aria-label={label} onClick={onClick} {...rest}>{children}</button>
  }
  const Tag = as
  return <Tag className={className} {...rest}>{children}</Tag>
}

/** Task rows as in a list widget: draggable, selectable, open on click. */
function TaskRows({ sectionKey, ids, data, kit }: {
  sectionKey: string
  ids: readonly number[]
  data: DashboardData
  kit: DashboardRowKit
}) {
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const todos = ids.flatMap((id) => {
    const t = data.todoById.get(id)
    return t ? [t] : []
  })
  return (
    <>
      {todos.map((todo, i) => {
        const key = rowKey(sectionKey, todo.id)
        const people = assignedPeopleMap.get(todo.id)
        if (kit.isMobile) {
          return <MobileTaskRow key={key} todo={todo} assignedPeople={people} onOpenDetail={kit.onOpen} />
        }
        const prev = todos[i - 1]
        const next = todos[i + 1]
        return (
          <ListWidgetRow
            key={key}
            todo={todo}
            assignedPeople={people}
            tabId={kit.tabId}
            sectionKey={sectionKey}
            rowKey={key}
            selected={kit.inScope && kit.selectedIds.has(todo.id)}
            selFirst={!(prev && kit.selectedIds.has(prev.id))}
            selLast={!(next && kit.selectedIds.has(next.id))}
            cursor={kit.cursorKey === key}
            look="idle"
            onSelect={kit.onSelect}
            onOpenDetail={kit.onOpen}
          />
        )
      })}
    </>
  )
}

/** The open tasks of `tasks` matching `pick`, in dialog order. */
function openIds(tasks: readonly PersistedTodoItem[], pick: (t: PersistedTodoItem) => boolean): number[] {
  return idsByDate(tasks.filter((t) => !t.isCompleted && pick(t)), 'deadline')
}

// ── Hot ─────────────────────────────────────────────────────────────────────


export function HotSection({ data, rows, style }: DashboardSectionProps) {
  const ids = data.tiles.shown.hot.ids
  return (
    <Panel
      def={SECTION_META.hot}
      style={style}
      count={countOf(ids.length, data.tiles.total.hot.ids.length)}
      sub={hotRuleInWords(data.ctx.hotRule)}
    >
      <div className={styles.panelBody}>
        {ids.length === 0
          ? <Empty title="Nothing hot" hint="Tasks matching the Hot setting show here." />
          : <TaskRows sectionKey="hot" ids={ids} data={data} kit={rows} />}
      </div>
    </Panel>
  )
}

// ── Needs follow-up ─────────────────────────────────────────────────────────


export function FollowupSection({ data, options, rows, style }: DashboardSectionProps) {
  const lookAhead = options.lookAhead ?? DEFAULT_DASHBOARD_LOOK_AHEAD
  const { shown, total } = data.followup
  const groups = [
    { key: 'fu-late', name: 'Late', dot: 'var(--color-followup)', ids: shown.late },
    { key: 'fu-today', name: 'Today', dot: 'var(--color-followup)', ids: shown.today },
    { key: 'fu-next', name: `Next ${lookAhead} days`, dot: 'var(--color-text-muted)', ids: shown.upcoming },
  ].filter((g) => g.ids.length > 0)
  const shownCount = shown.late.length + shown.today.length + shown.upcoming.length
  const totalCount = total.late.length + total.today.length + total.upcoming.length
  return (
    <Panel
      def={SECTION_META.followup}
      style={style}
      count={countOf(shownCount, totalCount)}
      sub={`Late, today and the next ${lookAhead} days`}
    >
      <div className={styles.panelBody}>
        {groups.length === 0 ? (
          <Empty
            title="Nothing needs follow-up"
            hint={`No follow-ups are late, due today or due in the next ${lookAhead} days.`}
          />
        ) : groups.map((g) => (
          <div key={g.key} role="group" aria-label={g.name}>
            <div className={styles.groupHeader}>
              <i className={styles.groupDot} style={{ background: g.dot }} />
              <span>{g.name}</span>
              <span className={styles.groupCount}>· {g.ids.length}</span>
            </div>
            <TaskRows sectionKey={g.key} ids={g.ids} data={data} kit={rows} />
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── Next 7 days ─────────────────────────────────────────────────────────────


/** Px per task in the Next 7 days bars, when they fit. */
const DAY_UNIT_PX = 22
/** Counts row + labels + gaps + padding around the bars in a column. */
const DAY_CHROME_PX = 80

export function NextDaysSection({ data, onDrill, style }: DashboardSectionProps) {
  const [ref, size] = useElementSize()
  const cols = data.nextDays
  const tallest = Math.max(1, ...cols.map((c) => c.dueIds.length + c.followupIds.length))
  const room = Math.max(0, size.height - DAY_CHROME_PX)
  const unit = size.height > 0 ? Math.min(DAY_UNIT_PX, room / tallest) : DAY_UNIT_PX
  return (
    <Panel
      def={SECTION_META.next7}
      style={style}
      extras={<><Legend color="var(--color-overdue)" label="Due" /><Legend color="var(--color-followup)" label="Follow-up" /></>}
    >
      <div ref={ref} className={styles.days}>
        {cols.map((c, i) => {
          const [name, num] = nextDayLabels(c.date, i)
          const d = c.dueIds.length
          const f = c.followupIds.length
          const ids = [...new Set([...c.dueIds, ...c.followupIds])]
          return (
            <Clickable
              key={i}
              as="div"
              className={styles.day}
              data-late={i === 0 ? 'true' : undefined}
              data-today={i === 1 ? 'true' : undefined}
              data-testid="dash-day"
              label={`${name} ${num}: ${d} due, ${f} follow-up. Show tasks`}
              onClick={onDrill ? () => onDrill({ kind: 'tasks', title: i < 2 ? name : `${name} ${num}`, glyph: 'calendar', todoIds: ids }) : undefined}
            >
              <span className={styles.dayCounts}>
                {d + f === 0 && <span className={styles.muted}>–</span>}
                {d > 0 && <span style={{ color: 'var(--color-overdue)' }}>{d}</span>}
                {f > 0 && <span style={{ color: 'var(--color-followup)' }}>{f}</span>}
              </span>
              <span className={styles.dayBars}>
                {d > 0 && <span className={styles.bar} style={{ height: d * unit, background: 'var(--color-overdue)' }} />}
                {f > 0 && <span className={styles.bar} style={{ height: f * unit, background: 'var(--color-followup)' }} />}
              </span>
              <span className={styles.dayLabels}>
                <span className={styles.dayName}>{name}</span>
                <span className={styles.dayNum}>{num}</span>
              </span>
            </Clickable>
          )
        })}
      </div>
    </Panel>
  )
}

// ── Created vs completed ────────────────────────────────────────────────────


/** Px per task in the trend bars, when they fit. */
const TREND_UNIT_PX = 36

export function TrendSection({ data, onDrill, style }: DashboardSectionProps) {
  const [ref, size] = useElementSize()
  const { trend, trendRange, ctx } = data
  const buckets = trend?.buckets ?? []
  const tallest = Math.max(1, ...buckets.map((b) => Math.max(b.createdIds.length, b.completedIds.length)))
  const unit = size.height > 0 ? Math.min(TREND_UNIT_PX, size.height / tallest) : TREND_UNIT_PX
  const columns = { gridTemplateColumns: `repeat(${Math.max(1, buckets.length)}, minmax(0, 1fr))` }
  const granularity = trend?.window.granularity ?? 'day'
  return (
    <Panel
      def={SECTION_META.trend}
      style={style}
      sub={trendRangeLabel(trendRange)}
      extras={<><Legend color="var(--color-chart-created)" label="Created" /><Legend color="var(--color-accent)" label="Completed" /></>}
    >
      <div className={styles.trend}>
        <div className={styles.trendStats}>
          <span className={styles.trendStat} data-testid="dash-trend-completed"><b style={{ color: 'var(--color-accent)' }}>{trend?.completed ?? 0}</b>completed</span>
          <span className={styles.trendStat} data-testid="dash-trend-created"><b>{trend?.created ?? 0}</b>created</span>
          {trend && <span className={styles.trendStat}><b>{signed(trend.net)}</b>{sinceLabel(trend.window.start, ctx.today)}</span>}
        </div>
        <div ref={ref} className={styles.trendChart} style={columns}>
          {buckets.map((b, i) => {
            const label = trendBucketLabel(b.start, granularity)
            const c = b.createdIds.length
            const k = b.completedIds.length
            const ids = [...new Set([...b.completedIds, ...b.createdIds])]
            return (
              <Clickable
                key={i}
                as="div"
                className={styles.trendGroup}
                label={`${label}: ${c} created, ${k} completed. Show tasks`}
                onClick={onDrill && ids.length > 0 ? () => onDrill({ kind: 'tasks', title: label, glyph: 'chart', todoIds: ids }) : undefined}
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

// ── Status ──────────────────────────────────────────────────────────────────


export function StatusSection({ data, onDrill, style }: DashboardSectionProps) {
  const entries = data.status.shown
  const open = entries.reduce((n, e) => n + e.count, 0)
  const openTotal = data.status.total.reduce((n, e) => n + e.count, 0)
  return (
    <Panel def={SECTION_META.status} style={style} count={`${countOf(open, openTotal)} open`}>
      {openTotal === 0 ? (
        <Empty title="No open tasks" hint="Open tasks show here by status." />
      ) : (
        <>
          <div className={styles.statusBar} role="img" aria-label={`${open} open tasks by status`}>
            {entries.filter((e) => e.count > 0).map((e) => (
              <span key={e.id ?? 'none'} style={{ flex: `${e.count} 1 0`, background: e.color }} />
            ))}
          </div>
          <div className={styles.panelBody}>
            {entries.map((e) => (
              <Clickable
                key={e.id ?? 'none'}
                as="div"
                className={styles.statusRow}
                data-zero={e.count === 0 ? 'true' : undefined}
                data-status-key={String(e.id ?? 'unset')}
                label={`${e.label}: ${e.count}. Show tasks`}
                onClick={onDrill && e.count > 0
                  ? () => onDrill({ kind: 'tasks', title: e.label, glyph: 'status', todoIds: openIds(data.shown, (t) => (t.statusId ?? null) === e.id) })
                  : undefined}
              >
                <span style={{ color: e.color, display: 'inline-flex' }}><StatusIcon icon={e.icon} filled /></span>
                <span className={styles.statusName}>{e.label}</span>
                <span className={styles.statusCount}>{e.count}</span>
                <span className={styles.statusPct}>{open > 0 ? Math.round((e.count / open) * 100) : 0}%</span>
              </Clickable>
            ))}
          </div>
        </>
      )}
    </Panel>
  )
}

// ── People ──────────────────────────────────────────────────────────────────


function Count({ n, color }: { n: number; color: string }) {
  return <span className={styles.num} style={{ color: n > 0 ? color : 'var(--color-text-muted)' }}>{n > 0 ? n : '–'}</span>
}

export function PeopleSection({ data, options, onDrill, style }: DashboardSectionProps) {
  const { rows, unassigned } = data.people
  const showUnassigned = options.showUnassigned !== false && unassigned.ids.length > 0
  const max = Math.max(1, ...rows.map((r) => r.ids.length), showUnassigned ? unassigned.ids.length : 0)
  const all = useMemo(() => [
    ...rows.map((r) => ({ key: String(r.person.id), person: r.person, stats: r })),
    ...(showUnassigned ? [{ key: 'none', person: null, stats: unassigned }] : []),
  ], [rows, unassigned, showUnassigned])
  return (
    <Panel def={SECTION_META.people} style={style} sub="Open tasks by person">
      {all.length === 0 ? (
        <Empty title="No open tasks" hint="Open tasks show here by person." />
      ) : (
        <>
          <div className={`${styles.peopleGrid} ${styles.peopleHead}`}>
            <span>Person</span><span>Open</span><span /><span className={styles.num}>Hot</span><span className={styles.num}>Follow-up</span>
          </div>
          <div className={styles.panelBody}>
            {all.map(({ key, person, stats }) => {
              const name = person ? person.name : 'Unassigned'
              const open = stats.ids.length
              const onClick = person
                ? (x: number, y: number) => useUIStore.getState().showFilteredList(x, y, { type: 'person', personId: person.id, personName: person.name })
                : onDrill
                  ? () => onDrill({ kind: 'tasks', title: 'Unassigned', glyph: 'people', todoIds: stats.ids })
                  : null
              const content = (
                <>
                  <span className={styles.personName}>
                    {person
                      ? <i className={styles.avatar} style={{ background: person.color || NEUTRAL_PERSON_COLOR }}>{(person.initials || person.name).charAt(0).toUpperCase()}</i>
                      : <i className={`${styles.avatar} ${styles.avatarNone}`} />}
                    <span>{name}</span>
                  </span>
                  <span className={styles.peopleBar}><span style={{ width: `${Math.round((open / max) * 100)}%` }} /></span>
                  <span className={styles.num}>{open}</span>
                  <Count n={stats.hotIds.length} color="var(--color-danger)" />
                  <Count n={stats.followupDueIds.length} color="var(--color-followup)" />
                </>
              )
              const cls = `${styles.peopleGrid} ${styles.personRow}`
              return onClick ? (
                <button
                  key={key}
                  type="button"
                  className={cls}
                  data-person-row={key}
                  aria-label={`${name}: ${open} open, ${stats.hotIds.length} hot, ${stats.followupDueIds.length} follow-up due`}
                  onClick={(e) => onClick(e.clientX, e.clientY)}
                >
                  {content}
                </button>
              ) : (
                <div key={key} className={cls} data-person-row={key}>{content}</div>
              )
            })}
          </div>
        </>
      )}
    </Panel>
  )
}
