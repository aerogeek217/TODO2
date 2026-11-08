import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { clampCalendarOffset, toggleCalendarDateType, type CalendarDateType, type CalendarTab, type CalendarView } from '../../../models/workspace-layout'
import { useTodoStore } from '../../../stores/todo-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useFilterStore } from '../../../stores/filter-store'
import { useAppliedLens, useScreenFilter } from '../../../stores/screen-filter'
import { screenHiderText, screenUnhideAction } from '../../shared/filters/screen-hides'
import { admitsCompleted, countActiveFilters } from '../../../utils/filter-criteria'
import { buildEntries } from '../../../services/calendar-entries'
import { CALENDAR_BREAKPOINTS, calendarRange, calendarRangeLabel, calendarRangeName, convertCalendarOffset, weekdayLabels } from '../../../utils/calendar-grid'
import { heatHue } from '../../../utils/calendar-heat'
import { dayKey } from '../../../utils/date'
import { ChevronLeftIcon, ChevronRightIcon, TodayIcon } from '../../shared/icons'
import { CalendarDayPopover } from './CalendarDayPopover'
import { useElementSize } from '../../../hooks/use-element-size'
import styles from './CalendarWidget.module.css'
import { WidgetTopLine } from '../WidgetTopLine'
import type { CalendarMode } from './calendar-day'
import { useCalendarEntries, useCalendarSetup } from './calendar-data'
import { EntryItem } from './CalendarDayParts'
import { MonthGrid } from './CalendarMonth'
import { WeekRows, WeekColumn } from './CalendarWeek'
import { CompactDay, DayList } from './CalendarCompact'
import { TypeToggle, TitlesToggle } from './CalendarToggles'
import { CalendarFace } from './CalendarFace'
import { useWidgetFace } from '../../../hooks/use-widget-face'
/** Width assumed before the widget is measured. */
const UNMEASURED_WIDTH = 1000

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
  // Its face (D25 R): today and the week's heat when small, the week's days when medium, the calendar when large.
  const [faceRef, face] = useWidgetFace()
  return face === 'large'
    ? <CalendarFull tab={tab} faceRef={faceRef} />
    : <CalendarFace tab={tab} face={face} faceRef={faceRef} />
}

/** The full calendar (its large face). */
function CalendarFull({ tab, faceRef }: { tab: CalendarTab; faceRef: (el: HTMLElement | null) => void }) {
  const { ctx, today, weekStartsOn, isMobile } = useCalendarSetup(tab)
  const drag = ctx.drag
  const todos = useTodoStore((s) => s.todos)
  const { filters: screen, active: screenActive } = useScreenFilter()
  const lens = useAppliedLens()
  const chipCount = useFilterStore((s) => countActiveFilters(s.filters))
  const [sizeRef, rootSize] = useElementSize()
  const rootRef = useCallback((el: HTMLElement | null) => {
    sizeRef(el)
    faceRef(el)
  }, [sizeRef, faceRef])
  const [selectedMs, setSelectedMs] = useState<number | null>(null)
  const [more, setMore] = useState<MoreState | null>(null)

  const dateTypes = tab.config.dateTypes
  const view: CalendarView = tab.viewState?.view ?? 'month'
  const offset = clampCalendarOffset(tab.viewState?.offset ?? 0)
  const titles = tab.viewState?.titles === true
  const width = rootSize.width > 0 ? rootSize.width : UNMEASURED_WIDTH
  const narrow = width < CALENDAR_BREAKPOINTS.compactMonth
  const mode: CalendarMode = view === 'month'
    ? (isMobile || narrow ? 'compact' : 'month')
    : (isMobile || width < CALENDAR_BREAKPOINTS.weekColumns ? 'rows' : 'columns')

  const range = useMemo(() => calendarRange(view, offset, today, weekStartsOn), [view, offset, today, weekStartsOn])
  const month = range.start.getMonth()

  const entriesByDay = useCalendarEntries(tab, range.days)
  const entryCount = useMemo(() => {
    let n = 0
    for (const list of entriesByDay.values()) n += list.length
    return n
  }, [entriesByDay])

  // Tasks in view that only the screen filter hides (completed ones count
  // only when it lets them through: Show completed, or a Completed range).
  const withCompleted = admitsCompleted(screen)
  const hiddenCount = useMemo(() => {
    if (entryCount > 0 || !screenActive) return 0
    const base = todos.filter((t) => withCompleted || !t.isCompleted)
    const ids = new Set<number>()
    for (const list of buildEntries(base, range.days, { dateTypes }).values()) for (const e of list) ids.add(e.todo.id)
    return ids.size
  }, [entryCount, screenActive, todos, withCompleted, range.days, dateTypes])

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

  const toggleTitles = useCallback(() => {
    void useWorkspaceStore.getState().patchTabViewState(tab.id, 'calendar', { titles: titles ? undefined : true })
  }, [tab.id, titles])

  const toggleType = useCallback((type: CalendarDateType) => {
    const next = toggleCalendarDateType(dateTypes, type)
    if (next !== dateTypes) useWorkspaceStore.getState().patchTabConfig(tab.id, 'calendar', { dateTypes: next })
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
          titles={titles}
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
                titles={titles}
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
  const noTypes = !dateTypes.due && !dateTypes.followup
  // With no date type shown the note stays up during a drag: it says why the days take no drop.
  const showEmpty = noTypes || (entryCount === 0 && !drag)
  const unhide = screenUnhideAction(chipCount)

  return (
    <div
      ref={rootRef}
      className={styles.widget}
      data-calendar-widget={tab.id}
      data-mode={mode}
      data-heat-hue={heatHue(dateTypes)}
      data-mobile={isMobile ? 'true' : undefined}
      data-dragging={drag ? 'true' : undefined}
    >
      <WidgetTopLine className={styles.toolbar}>
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
        {!isMobile && view === 'month' && (
          <TitlesToggle on={titles} iconOnly={width < CALENDAR_BREAKPOINTS.toggleLabels} onToggle={toggleTitles} />
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
      </WidgetTopLine>

      <div className={styles.body}>
        {body}
        {showEmpty && (
          <div className={styles.emptyWrap}>
            {noTypes ? (
              <div className={styles.emptyNote} data-testid="calendar-empty" data-empty="no-types">
                <div className={styles.emptyLine1}>No date types shown</div>
                <div className={styles.emptyLine2}>Turn on Due or Follow-up to see tasks here.</div>
              </div>
            ) : hiddenCount > 0 ? (
              <div className={styles.emptyNote} data-testid="calendar-empty" data-empty="filtered">
                <div className={styles.emptyLine1}>No tasks match</div>
                <div className={styles.emptyLine2}>
                  {hiddenCount} {hiddenCount === 1 ? 'task' : 'tasks'} {view === 'week' && rangeName === 'this week' ? rangeName : `in ${rangeName}`} {hiddenCount === 1 ? 'is' : 'are'} hidden by {screenHiderText(chipCount > 0, lens)}.
                </div>
                <button type="button" className={styles.emptyAction} onClick={unhide.onClick}>
                  {unhide.label}
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
