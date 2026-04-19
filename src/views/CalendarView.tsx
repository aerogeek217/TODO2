import { useEffect, useMemo, useCallback, useRef, useState } from 'react'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'
import { useOrgStore } from '../stores/org-store'
import { useProjectStore } from '../stores/project-store'
import { useUIStore } from '../stores/ui-store'
import { useFilterStore, applyFilter } from '../stores/filter-store'
import { useStatusStore } from '../stores/status-store'
import { useTaskEditCallbacks } from '../hooks/use-task-edit-callbacks'
import { TaskEditPopup } from '../components/task/TaskEditPopup'
import { FilteredListPopup } from '../components/overlays/FilteredListPopup'
import type { PersistedTodoItem } from '../models'
import { generateInitials } from '../utils/person'
import { startOfDay, isSameDay, MS_PER_DAY } from '../utils/date'
import { effectiveDate, resolveScheduled, scheduledLabel, isScheduledExpired, isScheduledPast, isDeadlinePast, daysUntil, dateIntensity } from '../utils/effective-date'
import { generateRecurringInstances, recurrenceAnchor } from '../services/recurrence'
import { StatusIcon } from '../components/shared/StatusIcon'
import styles from './CalendarView.module.css'

/** A calendar entry: either a real task or a virtual recurring instance. */
interface CalendarEntry {
  todo: PersistedTodoItem
  isVirtual: boolean
  displayKey: string
}

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
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (first.getFullYear() !== last.getFullYear()) {
    return `${first.toLocaleDateString('en-US', { ...opts, year: 'numeric' })} - ${last.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`
  }
  if (first.getMonth() !== last.getMonth()) {
    return `${first.toLocaleDateString('en-US', opts)} - ${last.toLocaleDateString('en-US', opts)}, ${first.getFullYear()}`
  }
  return `${first.toLocaleDateString('en-US', { month: 'long' })} ${first.getDate()} - ${last.getDate()}, ${first.getFullYear()}`
}

export function CalendarView() {
  const { todos, loadAll, update: updateTodo } = useTodoStore()
  const { people, load: loadPeople, assignedPeopleMap, loadAssignments: loadPeopleAssignments } = usePersonStore()
  const { load: loadTags, assignedTagsMap, loadAssignments: loadTagAssignments } = useTagStore()
  const { orgs, personOrgMap, assignedOrgsMap, load: loadOrgs, loadAssignments: loadOrgAssignments, loadPersonOrgMap } = useOrgStore()
  const { loadAll: loadAllProjects } = useProjectStore()
  const { openEditPopup } = useUIStore()
  const { filters } = useFilterStore()
  const { statuses } = useStatusStore()
  const taskEdit = useTaskEditCallbacks()

  const [viewMode, setViewMode] = useState<ViewMode>('month')
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [showUnscheduled, setShowUnscheduled] = useState(false)
  const [dragOverDay, setDragOverDay] = useState<string | null>(null)
  const dragTodoIdRef = useRef<number | null>(null)

  useEffect(() => {
    loadAll()
    loadPeople()
    loadTags()
    loadOrgs()
    loadAllProjects()
  }, [loadAll, loadPeople, loadTags, loadOrgs, loadAllProjects])

  useEffect(() => {
    const todoIds = todos.map((t) => t.id)
    if (todoIds.length > 0) {
      loadPeopleAssignments(todoIds)
      loadTagAssignments(todoIds)
      loadOrgAssignments(todoIds)
    }
  }, [todos, loadPeopleAssignments, loadTagAssignments, loadOrgAssignments])

  useEffect(() => {
    loadPersonOrgMap()
  }, [people, orgs, loadPersonOrgMap])

  const activeTodos = useMemo(() => {
    return applyFilter(filters, todos, assignedPeopleMap, assignedTagsMap, personOrgMap, assignedOrgsMap, statuses)
  }, [todos, filters, assignedPeopleMap, assignedTagsMap, personOrgMap, assignedOrgsMap, statuses])

  const [today, setToday] = useState(() => startOfDay(new Date()))

  const { scheduled, unscheduled } = useMemo(() => {
    const scheduled: PersistedTodoItem[] = []
    const unscheduled: PersistedTodoItem[] = []
    for (const t of activeTodos) {
      if (effectiveDate(t, today)) scheduled.push(t)
      else unscheduled.push(t)
    }
    return { scheduled, unscheduled }
  }, [activeTodos, today])

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

  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>()

    const addEntry = (dayDate: Date, todo: PersistedTodoItem, isVirtual: boolean, suffix = '') => {
      const key = startOfDay(dayDate).toISOString()
      const arr = map.get(key) ?? []
      arr.push({ todo, isVirtual, displayKey: isVirtual ? `recurring-${todo.id}-${key}` : `task-${todo.id}${suffix}` })
      map.set(key, arr)
    }

    // Compute visible range from the days grid
    const rangeStart = days.length > 0 ? startOfDay(days[0]) : new Date()
    const rangeEnd = days.length > 0 ? new Date(startOfDay(days[days.length - 1]).getTime() + MS_PER_DAY) : new Date()

    // When both scheduled + deadline are set, render on the scheduled day —
    // matches the tint logic ("both picks scheduled primary") and keeps the
    // card on the day the user dragged it to even though min(sched, due)
    // would clamp it back to the deadline.
    for (const t of scheduled) {
      const sched = resolveScheduled(t.scheduledDate, today)
      const primary = sched ?? (t.dueDate ? startOfDay(new Date(t.dueDate)) : null)
      if (!primary) continue
      const primaryDay = startOfDay(primary)
      addEntry(primaryDay, t, false)

      // Generate virtual future instances for recurring tasks.
      // Anchored to dueDate when set, otherwise a precise scheduledDate.
      if (t.recurrenceRule) {
        const anchor = recurrenceAnchor(t)
        if (anchor) {
          const instances = generateRecurringInstances(anchor.date, t.recurrenceRule, rangeStart, rangeEnd)
          for (const instanceDate of instances) {
            const instDay = startOfDay(instanceDate)
            if (instDay.getTime() === primaryDay.getTime()) continue
            addEntry(instDay, t, true)
          }
        }
      }
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => {
        const ae = effectiveDate(a.todo, today)
        const be = effectiveDate(b.todo, today)
        if (ae && be && ae.getTime() !== be.getTime()) return ae.getTime() - be.getTime()
        return a.todo.sortOrder - b.todo.sortOrder
      })
    }
    return map
  }, [scheduled, days, today])

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

  // Drag to reschedule
  const handleDragStart = useCallback((e: React.DragEvent, todoId: number) => {
    dragTodoIdRef.current = todoId
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(todoId))
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, dayKey: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverDay(dayKey)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOverDay(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, targetDate: Date) => {
    e.preventDefault()
    setDragOverDay(null)
    const todoId = dragTodoIdRef.current
    if (todoId == null) return
    dragTodoIdRef.current = null

    const todo = todos.find((t) => t.id === todoId)
    if (!todo) return

    const newDate = new Date(targetDate)
    // Preserve the time component from the field being updated, else default to noon
    const timeSource = todo.scheduledDate?.kind === 'date'
      ? new Date(todo.scheduledDate.value)
      : todo.dueDate
        ? new Date(todo.dueDate)
        : null
    if (timeSource) {
      newDate.setHours(timeSource.getHours(), timeSource.getMinutes(), timeSource.getSeconds())
    } else {
      newDate.setHours(12, 0, 0, 0)
    }

    if (todo.scheduledDate) {
      // Dragging a scheduled task always commits to a precise date — the user's
      // fuzzy choice was deliberate, but picking a specific day is an override.
      updateTodo({
        ...todo,
        scheduledDate: { kind: 'date', value: newDate },
        modifiedAt: new Date(),
      })
    } else {
      updateTodo({ ...todo, dueDate: newDate, modifiedAt: new Date() })
    }
  }, [todos, updateTodo])

  const isWeek = viewMode === 'week'
  const maxTasks = isWeek ? Infinity : MAX_MONTH_TASKS

  return (
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
            const isDragOver = dragOverDay === dayKey
            const visibleEntries = dayEntries.slice(0, maxTasks)
            const moreCount = dayEntries.length - visibleEntries.length

            return (
              <div
                key={dayKey}
                className={[
                  styles.dayCell,
                  isWeek && styles.dayCellWeek,
                  isOutside && styles.dayCellOutside,
                  isToday && styles.dayCellToday,
                  hasOverdue && styles.dayCellOverdue,
                  isDragOver && styles.dayCellDragOver,
                ].filter(Boolean).join(' ')}
                onDragOver={(e) => handleDragOver(e, dayKey)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, day)}
              >
                <div className={[
                  styles.dayNumber,
                  isToday && styles.dayNumberToday,
                  isOutside && styles.dayNumberOutside,
                ].filter(Boolean).join(' ')}>
                  {day.getDate()}
                </div>

                {visibleEntries.map(({ todo, isVirtual, displayKey }) => {
                  const assigned = assignedPeopleMap.get(todo.id)
                  const initials = assigned?.map((p) => p.initials || generateInitials(p.name)).join(', ')

                  const hasSched = !!todo.scheduledDate
                  const hasDead = !!todo.dueDate
                  // Past states don't apply to virtual recurring instances — they
                  // represent future occurrences whose parent's dates are the past
                  // anchor, not the instance's day.
                  const pastSched = !isVirtual && isScheduledPast(todo, today)
                  const pastDead = !isVirtual && isDeadlinePast(todo, today)

                  let tintClass: string | false = false
                  if (hasDead && pastDead) tintClass = styles.taskItemPastDeadline
                  else if (hasSched && pastSched) tintClass = styles.taskItemPastScheduled
                  else if (hasSched && hasDead) tintClass = styles.taskItemBoth
                  else if (hasSched) tintClass = styles.taskItemScheduled
                  else if (hasDead) tintClass = styles.taskItemDeadline

                  const intensityDate = isVirtual ? day : effectiveDate(todo, today)
                  const intensity = dateIntensity(daysUntil(intensityDate, today))

                  return (
                    <div
                      key={displayKey}
                      className={[
                        styles.taskItem,
                        isWeek && styles.weekTaskItem,
                        todo.isCompleted && styles.taskItemCompleted,
                        isVirtual && styles.taskItemVirtual,
                        tintClass,
                      ].filter(Boolean).join(' ')}
                      style={{ ['--date-intensity' as string]: intensity }}
                      onClick={(e) => handleTaskClick(e, todo.id)}
                      draggable={!isVirtual}
                      onDragStart={(e) => !isVirtual && handleDragStart(e, todo.id)}
                      title={isVirtual ? `Recurring instance — click to edit parent task "${todo.title}"` : undefined}
                    >
                      {hasSched && (
                        <span
                          className={styles.scheduledMarker}
                          title={`Scheduled: ${scheduledLabel(todo.scheduledDate!, today)}`}
                          aria-label="Scheduled"
                        >
                          <StatusIcon icon="calendar" />
                          {isScheduledExpired(todo, today) && <span className={styles.markerExpired} />}
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
                    </div>
                  )
                })}

                {moreCount > 0 && (
                  <div className={styles.moreCount}>+{moreCount} more</div>
                )}
              </div>
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
              {showUnscheduled ? '\u25BE' : '\u25B8'} {unscheduled.length} unscheduled task{unscheduled.length !== 1 ? 's' : ''}
            </button>
            {showUnscheduled && (
              <div className={styles.unscheduledList}>
                {unscheduled.map((todo) => (
                  <div
                    key={todo.id}
                    className={styles.unscheduledItem}
                    onClick={(e) => handleTaskClick(e, todo.id)}
                    draggable
                    onDragStart={(e) => handleDragStart(e, todo.id)}
                  >
                    {todo.title}
                  </div>
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
          allTags={taskEdit.allTags}
          allOrgs={taskEdit.allOrgs}
          onClose={taskEdit.closeEditPopup}
          {...taskEdit.entityCreators}
        />
      )}

      {taskEdit.editPopupMode === 'create' && (
        <TaskEditPopup
          mode="create"
          assignedPeople={[]}
          allPeople={taskEdit.allPeople}
          assignedTags={[]}
          allTags={taskEdit.allTags}
          onClose={taskEdit.closeEditPopup}
          onCreate={taskEdit.onCreate}
          assignedOrgs={[]}
          allOrgs={taskEdit.allOrgs}
          onAssignPerson={() => {}}
          onUnassignPerson={() => {}}
          onAssignTag={() => {}}
          onUnassignTag={() => {}}
          onAssignOrg={() => {}}
          onUnassignOrg={() => {}}
          {...taskEdit.entityCreators}
        />
      )}

      <FilteredListPopup />
    </div>
  )
}
