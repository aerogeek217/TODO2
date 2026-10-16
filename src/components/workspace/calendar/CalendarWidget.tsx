import { useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useDndMonitor, useDroppable } from '@dnd-kit/core'
import {
  clampCalendarOffset,
  type CalendarDateType,
  type CalendarDateTypes,
  type CalendarTab,
  type CalendarView,
} from '../../../models/workspace-layout'
import { useTodoStore } from '../../../stores/todo-store'
import { usePersonStore } from '../../../stores/person-store'
import { useTagStore } from '../../../stores/tag-store'
import { useStatusStore } from '../../../stores/status-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useFilterStore } from '../../../stores/filter-store'
import { countActiveFilters } from '../../../utils/filter-criteria'
import { applyFilter } from '../../../utils/filter-match'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { useToday } from '../../../hooks/use-today'
import { useFilterSettings } from '../../../hooks/use-filter-settings'
import {
  buildEntries,
  dayDots,
  dayOverdueWash,
  type CalendarEntry,
} from '../../../services/calendar-entries'
import {
  CALENDAR_BREAKPOINTS,
  calendarRange,
  calendarRangeLabel,
  calendarRangeName,
  convertCalendarOffset,
  dayLabel,
  monthCellFit,
  dayOverflow,
  weekRowsFit,
  weekdayLabels,
} from '../../../utils/calendar-grid'
import { dayKey } from '../../../utils/date'
import { TASK_DROP_KIND, calendarDayDropId } from '../../../utils/task-dnd'
import { TaskDraggable } from '../../task/dnd/TaskDraggable'
import { ChevronLeftIcon, ChevronRightIcon, FlagIcon, PlusIcon, TodayIcon, WidgetKindIcon } from '../icons'
import { CalendarEntryButton, type CalendarEntrySize } from './CalendarEntryButton'
import { CalendarDayPopover } from './CalendarDayPopover'
import {
  calendarScope,
  isCalendarEntryDragData,
  PendingCalendarDropContext,
  type CalendarEntryDragData,
} from './calendar-drag'
import { useElementSize } from './use-element-size'
import styles from './CalendarWidget.module.css'

/** Width assumed before the widget is measured. */
const UNMEASURED_WIDTH = 1000

/** Month grid: bottom padding and row gap (px), for the cell-height fit. */
const MONTH_GRID_PAD = 6
const MONTH_GRID_GAP = 2

type CalendarMode = 'month' | 'compact' | 'rows' | 'columns'

/** A task drag in progress anywhere in the workspace. */
interface TaskDragInfo {
  /** A calendar entry (moves its own date), not a list row. */
  entryMove: boolean
}

/** What a day shared by every layout needs. */
interface DayContext {
  tabId: string
  scope: string
  dateTypes: CalendarDateTypes
  today: Date
  drag: TaskDragInfo | null
  /** The day the Due / Follow-up chooser is open for, in ms. */
  pendingMs: number | null
  /** Mobile: nothing drags. */
  noDrag: boolean
  onOpen: (todoId: number) => void
}

function useTaskDrag(): TaskDragInfo | null {
  const [drag, setDrag] = useState<TaskDragInfo | null>(null)
  useDndMonitor({
    onDragStart(event) {
      const data = event.active.data.current
      if (!data || data.todo == null) return
      setDrag({ entryMove: isCalendarEntryDragData(data) })
    },
    onDragEnd() { setDrag(null) },
    onDragCancel() { setDrag(null) },
  })
  return drag
}

/** The hovered day's label: what a drop there does. */
function dropLabel(drag: TaskDragInfo | null, types: CalendarDateTypes): string {
  if (drag?.entryMove) return 'Move here'
  if (types.due && types.followup) return 'Set date'
  return types.due ? 'Set due' : 'Set follow-up'
}

/** A day as a drop target: dropping a task sets (or moves) one of its dates to the day. */
function useDayTarget(ctx: DayContext, day: Date) {
  const { setNodeRef, isOver } = useDroppable({
    id: calendarDayDropId(ctx.scope, day.getTime()),
    data: { type: TASK_DROP_KIND.calendarDay, date: day, scope: ctx.scope, dateTypes: ctx.dateTypes },
  })
  const highlighted = isOver || ctx.pendingMs === day.getTime()
  return { setNodeRef, highlighted }
}

function DropLabel({ ctx }: { ctx: DayContext }) {
  return (
    <span className={styles.dropLabel} aria-hidden="true">
      <PlusIcon size={12} strokeWidth={2} /> {dropLabel(ctx.drag, ctx.dateTypes)}
    </span>
  )
}

function dayClasses(base: string | undefined, ctx: DayContext, highlighted: boolean, extra: Array<string | false | undefined>): string {
  return [
    base,
    ctx.drag ? styles.dayDragTarget : '',
    highlighted ? styles.dayOver : '',
    ...extra,
  ].filter(Boolean).join(' ')
}

/** One entry, draggable unless it's a recurring occurrence (or on mobile). */
function EntryItem({ entry, size, wrap = false, slot, ctx }: {
  entry: CalendarEntry
  size: CalendarEntrySize
  wrap?: boolean
  /** Drag id slot; defaults to the entry's date type. */
  slot?: string
  ctx: DayContext
}) {
  if (entry.isVirtual || ctx.noDrag) {
    return <CalendarEntryButton entry={entry} today={ctx.today} size={size} wrap={wrap} onOpen={ctx.onOpen} />
  }
  const data: CalendarEntryDragData = {
    calendarDateType: entry.kind,
    calendarEntry: { entry, size, wrap, today: ctx.today },
  }
  return (
    <TaskDraggable
      todo={entry.todo}
      surface="calendar-widget"
      scope={ctx.tabId}
      sectionKey={slot ?? entry.kind}
      extraData={{ ...data }}
    >
      {({ setNodeRef, attributes, listeners, isDragging }) => (
        <CalendarEntryButton
          entry={entry}
          today={ctx.today}
          size={size}
          wrap={wrap}
          onOpen={ctx.onOpen}
          dragging={isDragging}
          dragRef={setNodeRef}
          dragAttributes={attributes}
          dragListeners={listeners}
        />
      )}
    </TaskDraggable>
  )
}

function washClass(entries: readonly CalendarEntry[], day: Date, today: Date): string | false {
  if (day.getTime() >= today.getTime()) return false
  const wash = dayOverdueWash(entries, today)
  return wash === 'due' ? (styles.washDue ?? false) : wash === 'followup' ? (styles.washFollowup ?? false) : false
}

/** `+N more` in a day's last slot: opens the day popover over the day. */
function MoreButton({ day, more, open, onMore, md }: {
  day: Date
  more: number
  open: boolean
  onMore: (day: Date, cell: HTMLElement) => void
  /** Week rows: a 24px slot. */
  md?: boolean
}) {
  return (
    <button
      type="button"
      className={`${styles.more} ${md ? styles.moreMd : ''} ${open ? styles.moreOpen : ''}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={(e) => {
        const cell = e.currentTarget.closest<HTMLElement>('[data-day]')
        if (cell) onMore(day, cell)
      }}
    >
      +{more} more
    </button>
  )
}

// ── Month ────────────────────────────────────────────────────────────────

function MonthDay({ day, month, entries, fit, ctx, onMore, moreOpen }: {
  day: Date
  month: number
  entries: CalendarEntry[]
  fit: number
  ctx: DayContext
  onMore: (day: Date, cell: HTMLElement) => void
  moreOpen: boolean
}) {
  const { setNodeRef, highlighted } = useDayTarget(ctx, day)
  const isToday = day.getTime() === ctx.today.getTime()
  const outside = day.getMonth() !== month
  const { shown, more } = dayOverflow(entries.length, fit)
  return (
    <div
      ref={setNodeRef}
      className={dayClasses(styles.monthDay, ctx, highlighted, [outside && styles.dayOutside, washClass(entries, day, ctx.today)])}
      data-day={dayKey(day)}
      data-today={isToday ? 'true' : undefined}
      data-outside={outside ? 'true' : undefined}
      data-drop-target={highlighted ? 'true' : undefined}
    >
      <div className={styles.dayNumber}>
        <span className={isToday ? styles.todayPill : undefined}>{day.getDate()}</span>
      </div>
      {entries.slice(0, shown).map((e) => <EntryItem key={e.key} entry={e} size="sm" ctx={ctx} />)}
      {more > 0 && <MoreButton day={day} more={more} open={moreOpen} onMore={onMore} />}
      {highlighted && <DropLabel ctx={ctx} />}
    </div>
  )
}

function MonthGrid({ days, month, entriesByDay, ctx, weekStartsOn, onMore, moreDayMs }: {
  days: Date[]
  month: number
  entriesByDay: Map<string, CalendarEntry[]>
  ctx: DayContext
  weekStartsOn: 0 | 1
  onMore: (day: Date, cell: HTMLElement) => void
  moreDayMs: number | null
}) {
  const [gridRef, gridSize] = useElementSize()
  const rows = Math.ceil(days.length / 7)
  const cellHeight = gridSize.height > 0 ? (gridSize.height - MONTH_GRID_PAD - MONTH_GRID_GAP * (rows - 1)) / rows : 0
  const fit = monthCellFit(cellHeight)
  return (
    <>
      <div className={styles.weekdays} aria-hidden="true">
        {weekdayLabels(weekStartsOn).map((w) => <span key={w}>{w}</span>)}
      </div>
      <div ref={gridRef} className={styles.monthGrid} data-cal-grid="month">
        {days.map((day) => (
          <MonthDay
            key={day.getTime()}
            day={day}
            month={month}
            entries={entriesByDay.get(dayKey(day)) ?? []}
            fit={fit}
            ctx={ctx}
            onMore={onMore}
            moreOpen={moreDayMs === day.getTime()}
          />
        ))}
      </div>
    </>
  )
}

// ── Week ─────────────────────────────────────────────────────────────────

function weekdayShort(d: Date): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] ?? ''
}

function WeekRow({ day, entries, fit, ctx, onMore, moreOpen }: {
  day: Date
  entries: CalendarEntry[]
  fit: number
  ctx: DayContext
  onMore: (day: Date, cell: HTMLElement) => void
  moreOpen: boolean
}) {
  const { setNodeRef, highlighted } = useDayTarget(ctx, day)
  const isToday = day.getTime() === ctx.today.getTime()
  const { shown, more } = dayOverflow(entries.length, fit)
  return (
    <div
      ref={setNodeRef}
      className={dayClasses(styles.weekRow, ctx, highlighted, [isToday && styles.dayToday, washClass(entries, day, ctx.today)])}
      data-day={dayKey(day)}
      data-today={isToday ? 'true' : undefined}
      data-drop-target={highlighted ? 'true' : undefined}
    >
      <div className={styles.dateBlock} aria-label={dayLabel(day)}>
        <span className={styles.weekdayName}>{weekdayShort(day)}</span>
        <span className={styles.weekDate}>{day.getDate()}</span>
      </div>
      <div className={styles.weekEntries}>
        {entries.length === 0
          ? <span className={styles.emptyDash} aria-hidden="true">—</span>
          : entries.slice(0, shown).map((e) => <EntryItem key={e.key} entry={e} size="md" ctx={ctx} />)}
        {more > 0 && <MoreButton day={day} more={more} open={moreOpen} onMore={onMore} md />}
      </div>
      {highlighted && <DropLabel ctx={ctx} />}
    </div>
  )
}

/**
 * The week as seven rows sharing the cell's height. When the days' entries
 * don't all fit, every row is capped at the same number of slots
 * (`weekRowsFit` over the measured height) and a row over it ends in
 * `+N more`.
 */
function WeekRows({ days, entriesByDay, ctx, onMore, moreDayMs }: {
  days: Date[]
  entriesByDay: Map<string, CalendarEntry[]>
  ctx: DayContext
  onMore: (day: Date, cell: HTMLElement) => void
  moreDayMs: number | null
}) {
  const [rowsRef, rowsSize] = useElementSize()
  const entriesOf = (day: Date) => entriesByDay.get(dayKey(day)) ?? []
  const fit = weekRowsFit(rowsSize.height, days.map((d) => entriesOf(d).length))
  return (
    <div ref={rowsRef} className={styles.weekRows} data-cal-grid="rows">
      {days.map((day) => (
        <WeekRow
          key={day.getTime()}
          day={day}
          entries={entriesOf(day)}
          fit={fit}
          ctx={ctx}
          onMore={onMore}
          moreOpen={moreDayMs === day.getTime()}
        />
      ))}
    </div>
  )
}

function WeekColumn({ day, entries, ctx }: { day: Date; entries: CalendarEntry[]; ctx: DayContext }) {
  const { setNodeRef, highlighted } = useDayTarget(ctx, day)
  const isToday = day.getTime() === ctx.today.getTime()
  return (
    <div
      ref={setNodeRef}
      className={dayClasses(styles.weekColumn, ctx, highlighted, [isToday && styles.dayToday, washClass(entries, day, ctx.today)])}
      data-day={dayKey(day)}
      data-today={isToday ? 'true' : undefined}
      data-drop-target={highlighted ? 'true' : undefined}
    >
      <div className={styles.columnHeader} aria-label={dayLabel(day)}>
        <span className={styles.weekdayName}>{weekdayShort(day)}</span>
        <span className={styles.weekDate}>{day.getDate()}</span>
      </div>
      <div className={styles.columnEntries}>
        {entries.map((e) => <EntryItem key={e.key} entry={e} size="md" wrap ctx={ctx} />)}
      </div>
      {highlighted && <DropLabel ctx={ctx} />}
    </div>
  )
}

// ── Compact month ────────────────────────────────────────────────────────

function CompactDay({ day, month, entries, selected, ctx, onSelect }: {
  day: Date
  month: number
  entries: CalendarEntry[]
  selected: boolean
  ctx: DayContext
  onSelect: (day: Date) => void
}) {
  const { setNodeRef, highlighted } = useDayTarget(ctx, day)
  const isToday = day.getTime() === ctx.today.getTime()
  const outside = day.getMonth() !== month
  const count = entries.length
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={dayClasses(styles.compactDay, ctx, highlighted, [
        outside && styles.dayOutside,
        selected && styles.compactSelected,
        washClass(entries, day, ctx.today),
      ])}
      aria-pressed={selected}
      aria-label={`${dayLabel(day)}, ${count} ${count === 1 ? 'task' : 'tasks'}`}
      data-day={dayKey(day)}
      data-today={isToday ? 'true' : undefined}
      data-outside={outside ? 'true' : undefined}
      data-drop-target={highlighted ? 'true' : undefined}
      onClick={() => onSelect(day)}
    >
      <span className={isToday ? styles.todayPill : styles.compactNumber}>{day.getDate()}</span>
      <span className={styles.dots} aria-hidden="true">
        {dayDots(entries).map((d, i) => <span key={i} className={styles.dot} data-dot={d} />)}
      </span>
    </button>
  )
}

function DayList({ day, entries, ctx, touch }: { day: Date; entries: CalendarEntry[]; ctx: DayContext; touch: boolean }) {
  const isToday = day.getTime() === ctx.today.getTime()
  return (
    <div className={styles.dayList} data-cal-day-list={dayKey(day)}>
      <div className={styles.dayListHeader}>
        <span className={styles.dayListTitle}>{dayLabel(day)}</span>
        {isToday && <span className={styles.dayListToday}>Today</span>}
        <span className={styles.dayListCount}>{entries.length} {entries.length === 1 ? 'task' : 'tasks'}</span>
      </div>
      <div className={styles.dayListEntries}>
        {entries.map((e) => <EntryItem key={e.key} entry={e} size={touch ? 'touch' : 'md'} ctx={ctx} />)}
      </div>
    </div>
  )
}

// ── Toolbar ──────────────────────────────────────────────────────────────

function TypeToggle({ type, types, iconOnly, onToggle }: {
  type: CalendarDateType
  types: CalendarDateTypes
  iconOnly: boolean
  onToggle: (type: CalendarDateType) => void
}) {
  const on = types[type]
  const only = on && !types[type === 'due' ? 'followup' : 'due']
  const label = type === 'due' ? 'Due' : 'Follow-up'
  const tip = only ? 'At least one date type is shown' : type === 'due' ? 'Show due dates' : 'Show next follow-ups'
  return (
    <button
      type="button"
      className={`${styles.typeToggle} ${iconOnly ? styles.typeToggleIcon : ''}`}
      data-type={type}
      aria-pressed={on}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly && !only ? `${tip} (${label})` : tip}
      onClick={() => { if (!only) onToggle(type) }}
    >
      {type === 'due' ? <WidgetKindIcon kind="calendar" size={12} /> : <FlagIcon size={12} />}
      {!iconOnly && <span>{label}</span>}
    </button>
  )
}

// ── Widget ───────────────────────────────────────────────────────────────

interface MoreState {
  dayMs: number
  at: { x: number; y: number }
}

/**
 * The calendar widget: a month grid (dots + day list when narrow or on
 * mobile) or a week (rows when narrow, seven columns when wide), with the
 * tasks' due dates and / or next follow-ups as entries. The top-bar (screen)
 * filter applies. Days take task drops (set or move a date); entries drag to
 * move their own date; recurring occurrences don't drag.
 */
export function CalendarWidget({ tab }: { tab: CalendarTab }) {
  const isMobile = useIsMobile()
  const today = useToday()
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const todos = useTodoStore((s) => s.todos)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const statuses = useStatusStore((s) => s.statuses)
  const screen = useFilterStore((s) => s.filters)
  const markerSettings = useFilterSettings()
  const screenActive = useFilterStore((s) => s.isActive)
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const pending = useContext(PendingCalendarDropContext)
  const drag = useTaskDrag()
  const [rootRef, rootSize] = useElementSize()
  const [selectedMs, setSelectedMs] = useState<number | null>(null)
  const [more, setMore] = useState<MoreState | null>(null)

  const dateTypes = tab.config.dateTypes
  const view: CalendarView = tab.viewState?.view ?? 'month'
  const offset = clampCalendarOffset(tab.viewState?.offset ?? 0)
  const scope = calendarScope(tab.id)
  const width = rootSize.width > 0 ? rootSize.width : UNMEASURED_WIDTH
  const narrow = width < CALENDAR_BREAKPOINTS.compactMonth
  const mode: CalendarMode = view === 'month'
    ? (isMobile || narrow ? 'compact' : 'month')
    : (isMobile || width < CALENDAR_BREAKPOINTS.weekColumns ? 'rows' : 'columns')

  const range = useMemo(() => calendarRange(view, offset, today, weekStartsOn), [view, offset, today, weekStartsOn])
  const month = range.start.getMonth()

  const shownTodos = useMemo(
    () => applyFilter(screen, todos, assignedPeopleMap, statuses, today, assignedTagsMap, markerSettings),
    [screen, todos, assignedPeopleMap, statuses, today, assignedTagsMap, markerSettings],
  )

  const entriesByDay = useMemo(
    () => buildEntries(shownTodos, range.days, { assignedPeopleMap, statuses, dateTypes }),
    [shownTodos, range.days, assignedPeopleMap, statuses, dateTypes],
  )
  const entryCount = useMemo(() => {
    let n = 0
    for (const list of entriesByDay.values()) n += list.length
    return n
  }, [entriesByDay])

  // Tasks in view that only the screen filter hides (completed ones count
  // only when "Show completed" is on).
  const hiddenCount = useMemo(() => {
    if (entryCount > 0 || !screenActive) return 0
    const base = todos.filter((t) => screen.showCompleted || !t.isCompleted)
    const ids = new Set<number>()
    for (const list of buildEntries(base, range.days, { dateTypes }).values()) for (const e of list) ids.add(e.todo.id)
    return ids.size
  }, [entryCount, screenActive, todos, screen.showCompleted, range.days, dateTypes])

  const ctx = useMemo<DayContext>(() => ({
    tabId: tab.id,
    scope,
    dateTypes,
    today,
    drag,
    pendingMs: pending?.scope === scope ? pending.dateMs : null,
    noDrag: isMobile,
    onOpen: openEditPopup,
  }), [tab.id, scope, dateTypes, today, drag, pending, isMobile, openEditPopup])

  const setView = useCallback((next: CalendarView) => {
    if (next === view) return
    setMore(null)
    void useWorkspaceStore.getState().patchTabViewState(tab.id, 'calendar', {
      view: next,
      offset: clampCalendarOffset(convertCalendarOffset(view, next, offset, today, weekStartsOn)),
    })
  }, [tab.id, view, offset, today, weekStartsOn])

  const setOffset = useCallback((next: number) => {
    setMore(null)
    void useWorkspaceStore.getState().patchTabViewState(tab.id, 'calendar', { view, offset: clampCalendarOffset(next) })
  }, [tab.id, view])

  const toggleType = useCallback((type: CalendarDateType) => {
    useWorkspaceStore.getState().patchTabConfig(tab.id, 'calendar', {
      dateTypes: { ...dateTypes, [type]: !dateTypes[type] },
    })
  }, [tab.id, dateTypes])

  const openMore = useCallback((day: Date, cell: HTMLElement) => {
    const r = cell.getBoundingClientRect()
    setMore((prev) => (prev?.dayMs === day.getTime() ? null : { dayMs: day.getTime(), at: { x: r.left - 6, y: r.top - 6 } }))
  }, [])

  // Compact: the selected day, or today / the shown month's first when it's out of view.
  const selectedDay = useMemo(() => {
    const inView = (ms: number | null) => ms != null && range.days.some((d) => d.getTime() === ms)
    const ms = inView(selectedMs) ? selectedMs : inView(today.getTime()) ? today.getTime() : range.start.getTime()
    return range.days.find((d) => d.getTime() === ms) ?? range.start
  }, [selectedMs, range, today])

  const label = calendarRangeLabel(range, view === 'month' ? narrow : width < CALENDAR_BREAKPOINTS.weekColumns)
  const unit = view === 'month' ? 'month' : 'week'
  const moreDay = more ? range.days.find((d) => d.getTime() === more.dayMs) : undefined

  let body: ReactNode
  switch (mode) {
    case 'month':
      body = (
        <MonthGrid
          days={range.days}
          month={month}
          entriesByDay={entriesByDay}
          ctx={ctx}
          weekStartsOn={weekStartsOn}
          onMore={openMore}
          moreDayMs={more?.dayMs ?? null}
        />
      )
      break
    case 'compact':
      body = (
        <>
          <div className={`${styles.weekdays} ${styles.weekdaysCentred}`} aria-hidden="true">
            {weekdayLabels(weekStartsOn).map((w) => <span key={w}>{w}</span>)}
          </div>
          <div className={styles.compactGrid} data-cal-grid="compact">
            {range.days.map((day) => (
              <CompactDay
                key={day.getTime()}
                day={day}
                month={month}
                entries={entriesByDay.get(dayKey(day)) ?? []}
                selected={day.getTime() === selectedDay.getTime()}
                ctx={ctx}
                onSelect={(d) => setSelectedMs(d.getTime())}
              />
            ))}
          </div>
          <DayList day={selectedDay} entries={entriesByDay.get(dayKey(selectedDay)) ?? []} ctx={ctx} touch={isMobile} />
        </>
      )
      break
    case 'rows':
      body = (
        <WeekRows
          days={range.days}
          entriesByDay={entriesByDay}
          ctx={ctx}
          onMore={openMore}
          moreDayMs={more?.dayMs ?? null}
        />
      )
      break
    case 'columns':
      body = (
        <div className={styles.weekColumns} data-cal-grid="columns">
          {range.days.map((day) => (
            <WeekColumn key={day.getTime()} day={day} entries={entriesByDay.get(dayKey(day)) ?? []} ctx={ctx} />
          ))}
        </div>
      )
      break
  }

  const rangeName = calendarRangeName(range, today, weekStartsOn)
  const showEmpty = entryCount === 0 && !drag
  const filterCount = countActiveFilters(screen)

  return (
    <div
      ref={rootRef}
      className={styles.widget}
      data-calendar-widget={tab.id}
      data-mode={mode}
      data-mobile={isMobile ? 'true' : undefined}
      data-dragging={drag ? 'true' : undefined}
    >
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={`Previous ${unit}`}
          title={`Previous ${unit}`}
          onClick={() => setOffset(offset - 1)}
        >
          <ChevronLeftIcon size={14} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={`Next ${unit}`}
          title={`Next ${unit}`}
          onClick={() => setOffset(offset + 1)}
        >
          <ChevronRightIcon size={14} />
        </button>
        <span className={styles.rangeLabel} aria-live="polite" data-testid="calendar-range-label">{label}</span>
        {narrow && !isMobile ? (
          <button type="button" className={styles.iconButton} aria-label="Today" title="Today" onClick={() => setOffset(0)}>
            <TodayIcon size={14} />
          </button>
        ) : (
          <button type="button" className={styles.todayButton} onClick={() => setOffset(0)}>Today</button>
        )}
        <span className={styles.spacer} />
        {!isMobile && (
          <div className={styles.typeToggles} role="group" aria-label="Date types shown">
            {(['due', 'followup'] as const).map((type) => (
              <TypeToggle
                key={type}
                type={type}
                types={dateTypes}
                iconOnly={width < CALENDAR_BREAKPOINTS.toggleLabels}
                onToggle={toggleType}
              />
            ))}
          </div>
        )}
        <div className={styles.segmented} role="group" aria-label="Calendar view">
          {(['month', 'week'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={`${styles.segment} ${view === v ? styles.segmentOn : ''}`}
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              {v === 'month' ? 'Month' : 'Week'}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.body}>
        {body}
        {showEmpty && (
          <div className={styles.emptyWrap}>
            {hiddenCount > 0 ? (
              <div className={styles.emptyNote} data-testid="calendar-empty" data-empty="filtered">
                <div className={styles.emptyLine1}>No tasks match</div>
                <div className={styles.emptyLine2}>
                  {hiddenCount} {hiddenCount === 1 ? 'task' : 'tasks'} {view === 'week' && rangeName === 'this week' ? rangeName : `in ${rangeName}`} {hiddenCount === 1 ? 'is' : 'are'} hidden by the screen filter.
                </div>
                <button type="button" className={styles.emptyAction} onClick={() => useFilterStore.getState().clearAll()}>
                  {filterCount === 1 ? 'Clear screen filter' : 'Clear screen filters'}
                </button>
              </div>
            ) : (
              <div className={styles.emptyNote} data-testid="calendar-empty" data-empty="nothing">
                <div className={styles.emptyLine1}>
                  {dateTypes.due && dateTypes.followup
                    ? 'Nothing due or to follow up'
                    : dateTypes.due ? 'Nothing due' : 'Nothing to follow up'}
                  {' '}{view === 'week' && rangeName === 'this week' ? rangeName : `in ${rangeName}`}
                </div>
                <div className={styles.emptyLine2}>Drag a task from a list onto a day to set its date.</div>
              </div>
            )}
          </div>
        )}
      </div>

      {more && moreDay && (
        <CalendarDayPopover
          day={moreDay}
          at={more.at}
          entries={entriesByDay.get(dayKey(moreDay)) ?? []}
          renderEntry={(e) => <EntryItem key={e.key} entry={e} size="md" slot={`pop-${e.kind}`} ctx={ctx} />}
          onClose={() => setMore(null)}
        />
      )}
    </div>
  )
}
