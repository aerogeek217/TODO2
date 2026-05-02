import { useEffect, useMemo, useCallback, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useOrgStore } from '../stores/org-store'
import { useTagStore } from '../stores/tag-store'
import { useProjectStore } from '../stores/project-store'
import { useUIStore } from '../stores/ui-store'
import { useFilterStore, applyFilter } from '../stores/filter-store'
import { useStatusStore } from '../stores/status-store'
import { useSettingsStore } from '../stores/settings-store'
import { useTaskEditCallbacks } from '../hooks/use-task-edit-callbacks'
import { TaskEditPopup } from '../components/task/TaskEditPopup'
import { FilteredListPopup } from '../components/overlays/FilteredListPopup'
import { TaskDraggable } from '../components/task/dnd/TaskDraggable'
import type { PersistedTodoItem } from '../models'
import { generateInitials } from '../utils/person'
import { startOfDay, isSameDay } from '../utils/date'
import { effectiveDate, scheduledLabel, isScheduledExpired, isScheduledPast, isDeadlinePast, daysUntil, dateIntensity } from '../utils/effective-date'
import { buildRescheduleUpdate } from '../utils/reschedule'
import {
  CALENDAR_VIEW_SCOPE,
  TASK_DROP_KIND,
  buildTaskCollision,
  calendarDayDropId,
  dispatchTaskDrop,
} from '../utils/task-dnd'
import { useTaskboardStore } from '../stores/taskboard-store'
import { StatusIcon } from '../components/shared/StatusIcon'
import { dropCellClassName } from '../components/shared/DropIndicator'
import { DRAG_ACTIVATION_DISTANCE_PX } from '../constants'
import { TaskRow } from '../components/task/TaskRow'
import overlayStyles from '../components/canvas/DragOverlayTask.module.css'
import { buildEntries as buildCalendarEntries } from '../services/calendar-entries'
import styles from './CalendarView.module.css'

type ViewMode = 'month' | 'week'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MAX_MONTH_TASKS = 4

function getMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  // Monday = 0
  let startDow = first.getDay() - 1
  if (startDow < 0) startDow = 6

  const start = new Date(first)
  start.setDate(start.getDate() - startDow)

  const days: Date[] = []
  const d = new Date(start)
  // Always show 6 weeks for consistent height
  for (let i = 0; i < 42; i++) {
    days.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return days
}

function getWeekGrid(refDate: Date): Date[] {
  const d = new Date(refDate)
  let dow = d.getDay() - 1
  if (dow < 0) dow = 6
  d.setDate(d.getDate() - dow)

  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    days.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return days
}

function formatMonthYear(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function formatWeekRange(days: Date[]): string {
  const first = days[0]
  const last = days[days.length - 1]
  if (!first || !last) return ''
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (first.getFullYear() !== last.getFullYear()) {
    return `${first.toLocaleDateString('en-US', { ...opts, year: 'numeric' })} - ${last.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`
  }
  if (first.getMonth() !== last.getMonth()) {
    return `${first.toLocaleDateString('en-US', opts)} - ${last.toLocaleDateString('en-US', opts)}, ${first.getFullYear()}`
  }
  return `${first.toLocaleDateString('en-US', { month: 'long' })} ${first.getDate()} - ${last.getDate()}, ${first.getFullYear()}`
}

interface DayCellProps {
  day: Date
  children: (args: {
    isDragOver: boolean
    setNodeRef: (el: HTMLElement | null) => void
  }) => React.ReactNode
}

/** Wraps each day cell in a `useDroppable` so dnd-kit drop handlers receive
 * `{ type: 'calendar-day', date }` through `over.data.current`. The ref must
 * attach to a real layout-participating element (not a `display: contents`
 * wrapper) or dnd-kit measures a zero-size rect and no drop ever matches. */
function DayDroppable({ day, children }: DayCellProps) {
  const dayStart = startOfDay(day)
  const id = calendarDayDropId(CALENDAR_VIEW_SCOPE, dayStart.getTime())
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: TASK_DROP_KIND.calendarDay, date: dayStart, scope: CALENDAR_VIEW_SCOPE },
  })
  return <>{children({ isDragOver: isOver, setNodeRef })}</>
}

export function CalendarView() {
  const { todos, ensureAllLoaded: loadAll } = useTodoStore()
  const { people, ensureLoaded: loadPeople, assignedPeopleMap, loadAssignments: loadPeopleAssignments } = usePersonStore()
  const { orgs, personOrgMap, assignedOrgsMap, ensureLoaded: loadOrgs, loadAssignments: loadOrgAssignments, loadPersonOrgMap } = useOrgStore()
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const loadTags = useTagStore((s) => s.ensureLoaded)
  const loadTagAssignments = useTagStore((s) => s.loadAssignments)
  const { projects, ensureAllLoaded: loadAllProjects } = useProjectStore()
  const { openEditPopup } = useUIStore()
  const { filters } = useFilterStore()
  const { statuses } = useStatusStore()
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const taskEdit = useTaskEditCallbacks()

  const [viewMode, setViewMode] = useState<ViewMode>('month')
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [showUnscheduled, setShowUnscheduled] = useState(false)
  const [activeDragTodo, setActiveDragTodo] = useState<PersistedTodoItem | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }),
  )

  const collisionDetection = useMemo(
    () => buildTaskCollision([
      {
        when: () => true,
        accept: (id) => typeof id === 'string' && id.startsWith(`calday-${CALENDAR_VIEW_SCOPE}-`),
        algorithm: 'pointerWithin',
      },
    ]),
    [],
  )

  useEffect(() => {
    loadAll()
    loadPeople()
    loadOrgs()
    loadTags()
    loadAllProjects()
  }, [loadAll, loadPeople, loadOrgs, loadTags, loadAllProjects])

  useEffect(() => {
    const todoIds = todos.map((t) => t.id)
    if (todoIds.length > 0) {
      loadPeopleAssignments(todoIds)
      loadOrgAssignments(todoIds)
      loadTagAssignments(todoIds)
    }
  }, [todos, loadPeopleAssignments, loadOrgAssignments, loadTagAssignments])

  useEffect(() => {
    loadPersonOrgMap()
  }, [people, orgs, loadPersonOrgMap])

  const projectsById = useMemo(() => new Map(projects.map(p => [p.id!, p])), [projects])
  const activeTodos = useMemo(() => {
    return applyFilter(filters, todos, assignedPeopleMap, personOrgMap, assignedOrgsMap, statuses, undefined, projectsById, assignedTagsMap)
  }, [todos, filters, assignedPeopleMap, personOrgMap, assignedOrgsMap, statuses, projectsById, assignedTagsMap])

  const [today, setToday] = useState(() => startOfDay(new Date()))

  const { scheduled, unscheduled } = useMemo(() => {
    const scheduled: PersistedTodoItem[] = []
    const unscheduled: PersistedTodoItem[] = []
    for (const t of activeTodos) {
      if (effectiveDate(t, today, weekStartsOn)) scheduled.push(t)
      else unscheduled.push(t)
    }
    return { scheduled, unscheduled }
  }, [activeTodos, today, weekStartsOn])

  // Refresh "today" when the page becomes visible (e.g. after midnight)
  useEffect(() => {
    const refresh = () => {
      const now = startOfDay(new Date())
      setToday((prev) => (prev.getTime() === now.getTime() ? prev : now))
    }
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [])
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const days = useMemo(() => {
    return viewMode === 'month' ? getMonthGrid(year, month) : getWeekGrid(currentDate)
  }, [viewMode, year, month, currentDate])

  const headerLabel = useMemo(() => {
    return viewMode === 'month' ? formatMonthYear(currentDate) : formatWeekRange(days)
  }, [viewMode, currentDate, days])

  const entriesByDay = useMemo(() => buildCalendarEntries(scheduled, days, {
    today,
    weekStartsOn,
    sortMode: 'effective',
    assignedPeopleMap,
    assignedOrgsMap,
    statuses,
  }), [scheduled, days, today, weekStartsOn, assignedPeopleMap, assignedOrgsMap, statuses])

  const goToday = useCallback(() => setCurrentDate(new Date()), [])

  const goPrev = useCallback(() => {
    setCurrentDate((d) => {
      const n = new Date(d)
      if (viewMode === 'month') n.setMonth(n.getMonth() - 1)
      else n.setDate(n.getDate() - 7)
      return n
    })
  }, [viewMode])

  const goNext = useCallback(() => {
    setCurrentDate((d) => {
      const n = new Date(d)
      if (viewMode === 'month') n.setMonth(n.getMonth() + 1)
      else n.setDate(n.getDate() + 7)
      return n
    })
  }, [viewMode])

  const handleTaskClick = useCallback((e: React.MouseEvent, todoId: number) => {
    e.stopPropagation()
    openEditPopup(todoId)
  }, [openEditPopup])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const todo = event.active.data.current?.todo as PersistedTodoItem | undefined
    if (todo) setActiveDragTodo(todo)
  }, [])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveDragTodo(null)
    // `dispatchTaskDrop` consumes calendar-day drops via the `calendar` op —
    // rescheduling runs through `buildRescheduleUpdate` in one place.
    await dispatchTaskDrop(event, {
      taskboard: useTaskboardStore.getState(),
      calendar: {
        reschedule: async (todoId, date) => {
          const t = useTodoStore.getState().todos.find((x) => x.id === todoId)
          if (!t) return
          await useTodoStore.getState().update(buildRescheduleUpdate(t, date))
        },
      },
    })
  }, [])

  const isWeek = viewMode === 'week'
  const maxTasks = isWeek ? Infinity : MAX_MONTH_TASKS

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDragTodo(null)}
    >
      <div className={styles.page}>
        <div className={styles.container}>
          {/* Toolbar */}
          <div className={styles.toolbar}>
            <button className={styles.navButton} onClick={goPrev}>&lsaquo;</button>
            <button className={styles.navButton} onClick={goNext}>&rsaquo;</button>
            <button className={styles.todayButton} onClick={goToday}>Today</button>
            <div className={styles.monthLabel}>{headerLabel}</div>
            <div className={styles.viewToggle}>
              <button
                className={`${styles.toggleButton} ${viewMode === 'month' ? styles.toggleButtonActive : ''}`}
                onClick={() => setViewMode('month')}
              >
                Month
              </button>
              <button
                className={`${styles.toggleButton} ${viewMode === 'week' ? styles.toggleButtonActive : ''}`}
                onClick={() => setViewMode('week')}
              >
                Week
              </button>
            </div>
          </div>

          {/* Day headers */}
          <div className={styles.calendarGrid}>
            {DAY_NAMES.map((name) => (
              <div key={name} className={styles.dayHeader}>{name}</div>
            ))}

            {/* Day cells */}
            {days.map((day) => {
              const dayKey = startOfDay(day).toISOString()
              const isToday = isSameDay(day, today)
              const isCurrentMonth = day.getMonth() === month
              const isOutside = viewMode === 'month' && !isCurrentMonth
              const dayEntries = entriesByDay.get(dayKey) ?? []
              const hasOverdue = !isToday && day < today && dayEntries.some((e) => !e.isVirtual && !e.todo.isCompleted)
              const visibleEntries = dayEntries.slice(0, maxTasks)
              const moreCount = dayEntries.length - visibleEntries.length

              return (
                <DayDroppable key={dayKey} day={day}>
                  {({ isDragOver, setNodeRef }) => (
                    <div
                      ref={setNodeRef}
                      className={[
                        styles.dayCell,
                        isWeek && styles.dayCellWeek,
                        isOutside && styles.dayCellOutside,
                        isToday && styles.dayCellToday,
                        hasOverdue && styles.dayCellOverdue,
                        dropCellClassName(isDragOver),
                      ].filter(Boolean).join(' ')}
                    >
                      <div className={[
                        styles.dayNumber,
                        isToday && styles.dayNumberToday,
                        isOutside && styles.dayNumberOutside,
                      ].filter(Boolean).join(' ')}>
                        {day.getDate()}
                      </div>

                      {visibleEntries.map(({ todo, isVirtual, key: entryKey }) => {
                        const assigned = assignedPeopleMap.get(todo.id)
                        const initials = assigned?.map((p) => p.initials || generateInitials(p.name)).join(', ')

                        const hasSched = !!todo.scheduledDate
                        const hasDead = !!todo.dueDate
                        // Past states don't apply to virtual recurring instances — they
                        // represent future occurrences whose parent's dates are the past
                        // anchor, not the instance's day.
                        const pastSched = !isVirtual && isScheduledPast(todo, today, weekStartsOn)
                        const pastDead = !isVirtual && isDeadlinePast(todo, today)

                        let tintClass: string | false = false
                        if (hasDead && pastDead) tintClass = styles.taskItemPastDeadline ?? false
                        else if (hasSched && pastSched) tintClass = styles.taskItemPastScheduled ?? false
                        else if (hasSched && hasDead) tintClass = styles.taskItemBoth ?? false
                        else if (hasSched) tintClass = styles.taskItemScheduled ?? false
                        else if (hasDead) tintClass = styles.taskItemDeadline ?? false

                        const intensityDate = isVirtual ? day : effectiveDate(todo, today, weekStartsOn)
                        const intensity = dateIntensity(daysUntil(intensityDate, today))

                        const taskItemClass = [
                          styles.taskItem,
                          isWeek && styles.weekTaskItem,
                          todo.isCompleted && styles.taskItemCompleted,
                          isVirtual && styles.taskItemVirtual,
                          tintClass,
                        ].filter(Boolean).join(' ')
                        const itemStyle = { ['--date-intensity' as string]: intensity }
                        const title = isVirtual ? `Recurring instance — click to edit parent task "${todo.title}"` : undefined

                        const body = (
                          <>
                            {hasSched && (
                              <span
                                className={styles.scheduledMarker}
                                title={`Scheduled: ${scheduledLabel(todo.scheduledDate!, today)}`}
                                aria-label="Scheduled"
                              >
                                <StatusIcon icon="calendar" />
                                {isScheduledExpired(todo, today, weekStartsOn) && <span className={styles.markerExpired} />}
                              </span>
                            )}
                            {hasDead && (
                              <span
                                className={styles.deadlineMarker}
                                title={`Deadline: ${new Date(todo.dueDate!).toLocaleDateString()}`}
                                aria-label="Deadline"
                              >
                                <StatusIcon icon="clock" />
                              </span>
                            )}
                            {todo.recurrenceRule && <span className={styles.recurrenceIndicator} title={`Repeats ${todo.recurrenceRule.type}`}>&#x21bb;</span>}
                            <span className={styles.taskTitle}>{todo.title}</span>
                            {initials && <span className={styles.taskInitials}>{initials}</span>}
                          </>
                        )

                        if (isVirtual) {
                          return (
                            <div
                              key={entryKey}
                              className={taskItemClass}
                              style={itemStyle}
                              onClick={(e) => handleTaskClick(e, todo.id)}
                              title={title}
                            >
                              {body}
                            </div>
                          )
                        }

                        return (
                          <TaskDraggable
                            key={entryKey}
                            todo={todo}
                            surface="calendar-view"
                          >
                            {({ setNodeRef, attributes, listeners }) => (
                              <div
                                ref={setNodeRef}
                                className={taskItemClass}
                                style={itemStyle}
                                onClick={(e) => handleTaskClick(e, todo.id)}
                                title={title}
                                {...attributes}
                                {...listeners}
                              >
                                {body}
                              </div>
                            )}
                          </TaskDraggable>
                        )
                      })}

                      {moreCount > 0 && (
                        <div className={styles.moreCount}>+{moreCount} more</div>
                      )}
                    </div>
                  )}
                </DayDroppable>
              )
            })}
          </div>

          {/* Unscheduled tasks */}
          {unscheduled.length > 0 && (
            <div className={styles.unscheduledSection}>
              <button
                className={styles.unscheduledToggle}
                onClick={() => setShowUnscheduled((s) => !s)}
              >
                {showUnscheduled ? '▾' : '▸'} {unscheduled.length} unscheduled task{unscheduled.length !== 1 ? 's' : ''}
              </button>
              {showUnscheduled && (
                <div className={styles.unscheduledList}>
                  {unscheduled.map((todo) => (
                    <TaskDraggable
                      key={todo.id}
                      todo={todo}
                      surface="calendar-view"
                    >
                      {({ setNodeRef, attributes, listeners }) => (
                        <div
                          ref={setNodeRef}
                          className={styles.unscheduledItem}
                          onClick={(e) => handleTaskClick(e, todo.id)}
                          {...attributes}
                          {...listeners}
                        >
                          {todo.title}
                        </div>
                      )}
                    </TaskDraggable>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTodos.length === 0 && (
            <div className={styles.empty}>
              {useFilterStore.getState().isActive ? (
                <>
                  No tasks match your current filters.
                  <button className={styles.clearFiltersButton} onClick={() => useFilterStore.getState().clearAll()}>Clear filters</button>
                </>
              ) : (
                'No tasks to display.'
              )}
            </div>
          )}
        </div>

        {/* Task edit popup */}
        {taskEdit.editPopupMode === 'edit' && taskEdit.editProps && (
          <TaskEditPopup
            mode="edit"
            {...taskEdit.editProps}
            allPeople={taskEdit.allPeople}
            allOrgs={taskEdit.allOrgs}
            allTags={taskEdit.allTags}
            onClose={taskEdit.closeEditPopup}
            {...taskEdit.entityCreators}
          />
        )}

        {taskEdit.editPopupMode === 'create' && (
          <TaskEditPopup
            mode="create"
            assignedPeople={[]}
            allPeople={taskEdit.allPeople}
            onClose={taskEdit.closeEditPopup}
            onCreate={taskEdit.onCreate}
            assignedOrgs={[]}
            allOrgs={taskEdit.allOrgs}
            assignedTags={[]}
            allTags={taskEdit.allTags}
            onAssignPerson={() => {}}
            onUnassignPerson={() => {}}
            onAssignOrg={() => {}}
            onUnassignOrg={() => {}}
            onAssignTag={() => {}}
            onUnassignTag={() => {}}
            {...taskEdit.entityCreators}
          />
        )}

        <FilteredListPopup />

        <DragOverlay dropAnimation={null}>
          {activeDragTodo && (
            <div className={overlayStyles.overlay} data-drag-overlay>
              <TaskRow todo={activeDragTodo} ghost />
            </div>
          )}
        </DragOverlay>
      </div>
    </DndContext>
  )
}
