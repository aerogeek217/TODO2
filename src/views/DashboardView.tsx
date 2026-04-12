import { useEffect, useMemo, useCallback, useState } from 'react'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'
import { useOrgStore } from '../stores/org-store'
import { useUIStore } from '../stores/ui-store'
import { useTaskboardStore } from '../stores/taskboard-store'
import { useTaskEditCallbacks } from '../hooks/use-task-edit-callbacks'
import { TaskRow } from '../components/task/TaskRow'
import { TaskEditPopup } from '../components/task/TaskEditPopup'
import { FilteredListPopup } from '../components/overlays/FilteredListPopup'
import { Priority } from '../models'
import type { PersistedTodoItem } from '../models'
import { startOfToday, MS_PER_DAY } from '../utils/date'
import { TaskboardPanel } from '../components/taskboard/TaskboardPanel'
import styles from './DashboardView.module.css'

const TOP_N = 10

/**
 * Score a task for importance ranking.
 * Higher score = more important = should appear first.
 *
 * Weighting:
 *  - Hard deadline tasks get a large boost
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

  // Hard deadline boost
  if (todo.isHardDeadline) score += 50

  return score
}

export interface DashboardList {
  key: string
  label: string
  description: string
  todos: PersistedTodoItem[]
}

export function buildDashboardLists(todos: PersistedTodoItem[]): DashboardList[] {
  const now = startOfToday().getTime()
  const incomplete = todos.filter((t) => !t.isCompleted)

  // Score and sort by importance (descending)
  const scored = incomplete.map((t) => ({ todo: t, score: scoreTask(t, now) }))
  scored.sort((a, b) => b.score - a.score)

  // Mine: not assigned and not starred (follow-up)
  const mine = scored
    .filter(({ todo }) => !todo.isAssigned && !todo.isStarred)
    .slice(0, TOP_N)
    .map(({ todo }) => todo)

  // Follow-up: starred tasks
  const followup = scored
    .filter(({ todo }) => todo.isStarred)
    .slice(0, TOP_N)
    .map(({ todo }) => todo)

  // Assigned: tasks with isAssigned flag
  const assigned = scored
    .filter(({ todo }) => todo.isAssigned)
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

export function DashboardView() {
  const { todos, loadAll } = useTodoStore()
  const { assignedPeopleMap, load: loadPeople, loadAssignments: loadPeopleAssignments } = usePersonStore()
  const { assignedTagsMap, load: loadTags, loadAssignments: loadTagAssignments } = useTagStore()
  const { load: loadOrgs, loadAssignments: loadOrgAssignments } = useOrgStore()
  const { openEditPopup } = useUIStore()
  const { load: loadTaskboard } = useTaskboardStore()
  const taskEdit = useTaskEditCallbacks()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  useEffect(() => {
    loadAll()
    loadPeople()
    loadTags()
    loadOrgs()
    loadTaskboard()
  }, [loadAll, loadPeople, loadTags, loadOrgs, loadTaskboard])

  useEffect(() => {
    const todoIds = todos.map((t) => t.id)
    if (todoIds.length > 0) {
      loadPeopleAssignments(todoIds)
      loadTagAssignments(todoIds)
      loadOrgAssignments(todoIds)
    }
  }, [todos, loadPeopleAssignments, loadTagAssignments, loadOrgAssignments])

  const lists = useMemo(() => buildDashboardLists(todos), [todos])

  const handleClick = useCallback((todoId: number) => {
    openEditPopup(todoId)
  }, [openEditPopup])

  const toggleSection = useCallback((key: string) => {
    setCollapsed((s) => ({ ...s, [key]: !s[key] }))
  }, [])

  return (
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
                      list.todos.map((todo) => (
                        <TaskRow
                          key={todo.id}
                          todo={todo}
                          assignedPeople={assignedPeopleMap.get(todo.id)}
                          assignedTags={assignedTagsMap.get(todo.id)}
                          compact
                          onOpenDetail={handleClick}
                        />
                      ))
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
}
