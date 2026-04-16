import { useEffect, useMemo, useCallback, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'
import { useOrgStore } from '../stores/org-store'
import { useUIStore } from '../stores/ui-store'
import { useStatusStore } from '../stores/status-store'
import { useSettingsStore } from '../stores/settings-store'
import { useTaskboardStore } from '../stores/taskboard-store'
import { useTaskEditCallbacks } from '../hooks/use-task-edit-callbacks'
import { useIsMobile } from '../hooks/use-is-mobile'
import { TaskRow } from '../components/task/TaskRow'
import { TaskEditPopup } from '../components/task/TaskEditPopup'
import { FilteredListPopup } from '../components/overlays/FilteredListPopup'
import { Priority } from '../models'
import type { PersistedTodoItem, Status } from '../models'
import { startOfToday, MS_PER_DAY, formatRelativeTime } from '../utils/date'
import { TaskboardPanel } from '../components/taskboard/TaskboardPanel'
import styles from './DashboardView.module.css'

const TOP_N = 10

/**
 * Score a task for importance ranking.
 * Higher score = more important = should appear first.
 *
 * Weighting:
 *  - Hard deadline tasks always outrank soft deadlines (+500 bump puts hard
 *    above the max soft score of ~465 from being 365+ days overdue). This
 *    matches the List view's "hard first within a bucket" semantics.
 *  - Due date proximity: closer due dates score higher
 *  - Priority: High=2, Medium=1, Normal=0 adds a bonus
 */
export function scoreTask(todo: PersistedTodoItem, now: number): number {
  let score = 0

  // Priority bonus
  if (todo.priority === Priority.High) score += 20
  else if (todo.priority === Priority.Medium) score += 10

  // Due date proximity (closer = higher score)
  if (todo.dueDate) {
    const dueTime = new Date(todo.dueDate).getTime()
    const daysUntilDue = (dueTime - now) / MS_PER_DAY

    // Overdue tasks get the highest due-date score
    if (daysUntilDue < 0) {
      score += 100 + Math.min(Math.abs(daysUntilDue), 365)
    } else {
      // Due soon = high score, due far away = low score
      score += Math.max(0, 60 - daysUntilDue)
    }
  }

  // Hard deadline boost — large enough to always outrank soft scores
  if (todo.isHardDeadline) score += 500

  return score
}

export interface DashboardList {
  key: string
  label: string
  description: string
  todos: PersistedTodoItem[]
}

export function buildDashboardLists(
  todos: PersistedTodoItem[],
  statuses: Status[],
  seededFollowupStatusId: number | null,
  seededAssignedStatusId: number | null,
): DashboardList[] {
  const now = startOfToday().getTime()
  const incomplete = todos.filter((t) => !t.isCompleted)

  // Build set of hideByDefault status IDs for Mine filter
  const hiddenStatusIds = new Set(
    statuses.filter((s) => s.hideByDefault).map((s) => s.id!)
  )

  // Score and sort by importance (descending)
  const scored = incomplete.map((t) => ({ todo: t, score: scoreTask(t, now) }))
  scored.sort((a, b) => b.score - a.score)

  // Mine: tasks whose status is undefined or not hideByDefault
  const mine = scored
    .filter(({ todo }) => todo.statusId == null || !hiddenStatusIds.has(todo.statusId))
    .slice(0, TOP_N)
    .map(({ todo }) => todo)

  // Follow-up: tasks with seeded follow-up status
  const followup = scored
    .filter(({ todo }) => seededFollowupStatusId != null && todo.statusId === seededFollowupStatusId)
    .slice(0, TOP_N)
    .map(({ todo }) => todo)

  // Assigned: tasks with seeded assigned status
  const assigned = scored
    .filter(({ todo }) => seededAssignedStatusId != null && todo.statusId === seededAssignedStatusId)
    .slice(0, TOP_N)
    .map(({ todo }) => todo)

  // Stale: oldest by modifiedAt
  const stale = [...incomplete]
    .sort((a, b) => new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime())
    .slice(0, TOP_N)

  return [
    { key: 'mine', label: 'Mine', description: 'Not assigned, not follow-up', todos: mine },
    { key: 'followup', label: 'Follow-up', description: 'Awaiting response', todos: followup },
    { key: 'assigned', label: 'Assigned', description: 'Delegated to others', todos: assigned },
    { key: 'stale', label: 'Stale', description: 'Oldest by last modified', todos: stale },
  ]
}

function DashboardDraggableRow({
  todo,
  listKey,
  children,
}: {
  todo: PersistedTodoItem
  listKey: string
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `dashboard-${listKey}-${todo.id}`,
    data: { type: 'dashboard-task', todo },
  })

  return (
    <div ref={setNodeRef} {...attributes} {...listeners} style={{ opacity: isDragging ? 0.4 : 1 }}>
      {children}
    </div>
  )
}

export function DashboardView() {
  const { todos, loadAll } = useTodoStore()
  const { assignedPeopleMap, load: loadPeople, loadAssignments: loadPeopleAssignments } = usePersonStore()
  const { assignedTagsMap, load: loadTags, loadAssignments: loadTagAssignments } = useTagStore()
  const { load: loadOrgs, loadAssignments: loadOrgAssignments } = useOrgStore()
  const { openEditPopup } = useUIStore()
  const { statuses, load: loadStatuses } = useStatusStore()
  const { seededFollowupStatusId, seededAssignedStatusId } = useSettingsStore()
  const { load: loadTaskboard } = useTaskboardStore()
  const taskEdit = useTaskEditCallbacks()
  const isMobile = useIsMobile()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [activeDragTodo, setActiveDragTodo] = useState<PersistedTodoItem | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const todo = event.active.data.current?.todo as PersistedTodoItem | undefined
    if (todo) setActiveDragTodo(todo)
  }, [])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveDragTodo(null)
    const todo = event.active.data.current?.todo as PersistedTodoItem | undefined
    const overData = event.over?.data.current
    if (!todo || overData?.type !== 'taskboard') return
    await useTaskboardStore.getState().add(todo.id)
  }, [])

  useEffect(() => {
    loadAll()
    loadPeople()
    loadTags()
    loadOrgs()
    loadStatuses()
    loadTaskboard()
  }, [loadAll, loadPeople, loadTags, loadOrgs, loadStatuses, loadTaskboard])

  useEffect(() => {
    const todoIds = todos.map((t) => t.id)
    if (todoIds.length > 0) {
      loadPeopleAssignments(todoIds)
      loadTagAssignments(todoIds)
      loadOrgAssignments(todoIds)
    }
  }, [todos, loadPeopleAssignments, loadTagAssignments, loadOrgAssignments])

  const lists = useMemo(
    () => buildDashboardLists(todos, statuses, seededFollowupStatusId, seededAssignedStatusId),
    [todos, statuses, seededFollowupStatusId, seededAssignedStatusId],
  )

  const handleClick = useCallback((todoId: number) => {
    openEditPopup(todoId)
  }, [openEditPopup])

  const toggleSection = useCallback((key: string) => {
    setCollapsed((s) => ({ ...s, [key]: !s[key] }))
  }, [])

  const pageContent = (
    <>
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.pageHeader}>
            <div className={styles.pageTitle}>Dashboard</div>
            <div className={styles.pageSubtitle}>Top 10 by importance</div>
          </div>

          <div className={styles.taskboardSection}>
            <TaskboardPanel />
          </div>

          <div className={styles.grid}>
            {lists.map((list) => (
              <div key={list.key} className={styles.card}>
                <div
                  className={styles.cardHeader}
                  onClick={() => toggleSection(list.key)}
                >
                  <span className={`${styles.chevron} ${collapsed[list.key] ? styles.chevronCollapsed : ''}`}>&#9662;</span>
                  <span className={styles.cardTitle}>{list.label}</span>
                  <span className={styles.cardCount}>{list.todos.length}</span>
                </div>
                {!collapsed[list.key] && (
                  <div className={styles.cardBody}>
                    {list.todos.length === 0 ? (
                      <div className={styles.empty}>No tasks</div>
                    ) : (
                      list.todos.map((todo) => {
                        const staleLabel = list.key === 'stale' ? `Modified ${formatRelativeTime(new Date(todo.modifiedAt))}` : undefined
                        return !isMobile ? (
                          <DashboardDraggableRow key={todo.id} todo={todo} listKey={list.key}>
                            <TaskRow
                              todo={todo}
                              assignedPeople={assignedPeopleMap.get(todo.id)}
                              assignedTags={assignedTagsMap.get(todo.id)}
                              compact
                              onOpenDetail={handleClick}
                              extraLabel={staleLabel}
                            />
                          </DashboardDraggableRow>
                        ) : (
                          <TaskRow
                            key={todo.id}
                            todo={todo}
                            assignedPeople={assignedPeopleMap.get(todo.id)}
                            assignedTags={assignedTagsMap.get(todo.id)}
                            compact
                            onOpenDetail={handleClick}
                            extraLabel={staleLabel}
                          />
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

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
      </div>
      <FilteredListPopup />
    </>
  )

  if (isMobile) return pageContent

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {pageContent}
      <DragOverlay dropAnimation={null}>
        {activeDragTodo && (
          <div className={styles.dragOverlay}>
            <TaskRow todo={activeDragTodo} compact ghost />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
