import { useContext, useMemo, useState } from 'react'
import type { CalendarTab } from '../../../models/workspace-layout'
import { useFilterSettings } from '../../../hooks/use-filter-settings'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { useTodoNameLookups } from '../../../hooks/use-todo-name-lookups'
import { useToday } from '../../../hooks/use-today'
import { buildEntries, type CalendarEntry } from '../../../services/calendar-entries'
import { usePersonStore } from '../../../stores/person-store'
import { useScreenFilter } from '../../../stores/screen-filter'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { calendarRange, dayLabel, weekdayLabels } from '../../../utils/calendar-grid'
import { dayHeat, heatHue, heatSummary } from '../../../utils/calendar-heat'
import { dayKey } from '../../../utils/date'
import { applyFilter } from '../../../utils/filter-match'
import type { WidgetFace } from '../../../utils/widget-face'
import { TodayIcon } from '../../shared/icons'
import { calendarScope, PendingCalendarDropContext } from './calendar-drag'
import { dayClasses, type DayContext, useDayTarget, useTaskDrag } from './calendar-day'
import { DropLabel, EntryItem } from './CalendarDayParts'
import { CalendarDayPopover } from './CalendarDayPopover'
import calStyles from './CalendarWidget.module.css'
import styles from './CalendarFace.module.css'

/** What today's entries are, in words: `due`, `to follow up`, `due or to follow up`. */
function todayWords(types: CalendarTab['config']['dateTypes']): string {
  if (types.due && types.followup) return 'due or to follow up today'
  return types.followup ? 'to follow up today' : 'due today'
}

/** A medium face's day: its weekday, number and count, heat-tinted; it takes a task drop (sets the date) and opens its entries. */
function WeekFaceDay({ day, weekday, entries, ctx, onOpen }: {
  day: Date
  weekday: string
  entries: readonly CalendarEntry[]
  ctx: DayContext
  onOpen: (day: Date, el: HTMLElement) => void
}) {
  const { setNodeRef, highlighted } = useDayTarget(ctx, day)
  const heat = dayHeat(entries, day, ctx.today)
  const isToday = day.getTime() === ctx.today.getTime()
  const summary = heatSummary(heat)
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={dayClasses(`${styles.weekDay} ${calStyles.heatDay}`, ctx, highlighted, [isToday && styles.weekToday])}
      aria-label={`${dayLabel(day)}${isToday ? ', today' : ''}: ${heat.count} ${heat.count === 1 ? 'task' : 'tasks'}`}
      title={summary || undefined}
      data-day={dayKey(day)}
      data-today={isToday ? 'true' : undefined}
      data-heat={heat.step}
      data-late={heat.late ?? undefined}
      data-drop-target={highlighted ? 'true' : undefined}
      onClick={(e) => { if (heat.count > 0) onOpen(day, e.currentTarget) }}
    >
      <span className={styles.weekName}>{weekday}</span>
      <span className={`${styles.weekNumber} ${heat.late ? styles.weekLate : ''}`} data-late={heat.late ?? undefined}>{day.getDate()}</span>
      <span className={styles.weekCount} data-testid="calendar-face-count">{heat.count > 0 ? heat.count : '–'}</span>
      {highlighted && <DropLabel ctx={ctx} />}
    </button>
  )
}

/**
 * The calendar's small and medium faces (D25 R), over this week under the
 * screen filter. Small: today's count (of the tab's date types) and a
 * seven-day heat strip. Medium: the week as seven day cells with their
 * counts — each takes a task dropped on it as the full calendar's days do
 * (the same droppable ids and drop handling: it sets or moves the date), and
 * a click opens its entries.
 */
export function CalendarFace({ tab, face, faceRef }: {
  tab: CalendarTab
  face: Exclude<WidgetFace, 'large'>
  faceRef: (el: HTMLElement | null) => void
}) {
  const isMobile = useIsMobile()
  const today = useToday()
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const todos = useTodoStore((s) => s.todos)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const statuses = useStatusStore((s) => s.statuses)
  const lookups = useTodoNameLookups()
  const { filters: screen } = useScreenFilter()
  const markerSettings = useFilterSettings()
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const pending = useContext(PendingCalendarDropContext)
  const drag = useTaskDrag()
  const [open, setOpen] = useState<{ dayMs: number; at: { x: number; y: number } } | null>(null)

  const dateTypes = tab.config.dateTypes
  const scope = calendarScope(tab.id)
  const range = useMemo(() => calendarRange('week', 0, today, weekStartsOn), [today, weekStartsOn])
  const shown = useMemo(() => applyFilter(screen, todos, lookups, today, markerSettings), [screen, todos, lookups, today, markerSettings])
  const entriesByDay = useMemo(
    () => buildEntries(shown, range.days, { assignedPeopleMap, statuses, dateTypes }),
    [shown, range.days, assignedPeopleMap, statuses, dateTypes],
  )
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

  const entriesOf = (day: Date) => entriesByDay.get(dayKey(day)) ?? []
  const todayCount = entriesOf(today).length
  const weekdays = weekdayLabels(weekStartsOn)
  const openDay = open ? range.days.find((d) => d.getTime() === open.dayMs) : undefined

  return (
    <div
      ref={faceRef}
      className={`${calStyles.widget} ${styles.face} ${face === 'small' ? styles.small : styles.medium}`}
      data-calendar-face={face}
      data-calendar-face-tab={tab.id}
      data-heat-hue={heatHue(dateTypes)}
      data-dragging={drag ? 'true' : undefined}
    >
      {face === 'small' ? (
        <>
          <span className={styles.label}><TodayIcon size={12} />Today</span>
          <span className={styles.figures}>
            <span className={styles.count} data-testid="calendar-face-today">{todayCount}</span>
            <span className={styles.caption}>{todayWords(dateTypes)}</span>
          </span>
          <span className={styles.strip} role="img" aria-label={`This week: ${range.days.map((d) => `${dayLabel(d)} ${entriesOf(d).length}`).join(', ')}`}>
            {range.days.map((day) => {
              const heat = dayHeat(entriesOf(day), day, today)
              return (
                <span
                  key={day.getTime()}
                  className={`${styles.stripDay} ${calStyles.heatDay}`}
                  data-heat={heat.step}
                  data-today={day.getTime() === today.getTime() ? 'true' : undefined}
                  data-late={heat.late ?? undefined}
                />
              )
            })}
          </span>
        </>
      ) : (
        <div className={styles.week} data-cal-grid="week-face">
          {range.days.map((day, i) => (
            <WeekFaceDay
              key={day.getTime()}
              day={day}
              weekday={weekdays[i] ?? ''}
              entries={entriesOf(day)}
              ctx={ctx}
              onOpen={(d, el) => {
                const r = el.getBoundingClientRect()
                setOpen((prev) => (prev?.dayMs === d.getTime() ? null : { dayMs: d.getTime(), at: { x: r.left, y: r.bottom + 4 } }))
              }}
            />
          ))}
        </div>
      )}
      {open && openDay && (
        <CalendarDayPopover
          day={openDay}
          at={open.at}
          entries={entriesOf(openDay)}
          renderEntry={(e) => <EntryItem key={e.key} entry={e} size="md" slot={`pop-${e.kind}`} ctx={ctx} />}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
