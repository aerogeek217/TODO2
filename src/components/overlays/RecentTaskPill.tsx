/**
 * RecentTaskPill — transient floating affordance for the just-created task.
 *
 * Surfaces immediately after `useUIStore.showRecentlyCreated(id)` fires from
 * a creation path (QuickAddBar submit, TaskEditPopup create save). Anchors
 * to the same top-center position the QuickAddBar uses so it visually
 * replaces the dialog the user just dismissed. Lives for ~5 s, then fades;
 * hover pauses the fade so the user can decide. Within that window the user
 * can:
 *   • interact with the inline `<TaskRow>` exactly as on any other surface
 *     (status, people, dates, tags, notes, inline-edit title; double-click
 *     opens the full editor)
 *   • click × to dismiss immediately
 *
 * Render lifetime is keyed on `recentlyCreated.key` so a fresh creation
 * remounts the pill — the CSS animation restarts cleanly.
 *
 * **A new task flies home** (flair P4): before the pill is first painted, a
 * list row on screen showing the task (`findFlightRow`) takes its place —
 * the task flies there (`flyTaskHome`) and the pill is cleared unseen. The
 * pill shows only when no list on screen shows the task, on a phone, and
 * under reduced motion.
 */
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useUIStore } from '../../stores/ui-store'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { TaskRow } from '../task/TaskRow'
import { TaskRowGrid } from '../task/TaskRowGrid'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { prefersReducedMotion } from '../../utils/motion'
import { findFlightRow, flyTaskHome, NOT_A_FLIGHT_TARGET_ATTR } from './task-fly'
import styles from './RecentTaskPill.module.css'

export function RecentTaskPill() {
  const recent = useUIStore((s) => s.recentlyCreated)
  if (!recent) return null
  return <RecentTaskPillBody key={recent.key} todoId={recent.todoId} />
}

function RecentTaskPillBody({ todoId }: { todoId: number }) {
  const todo = useTodoStore((s) => s.todos.find((t) => t.id === todoId))
  const assignedPeople = usePersonStore((s) => s.assignedPeopleMap.get(todoId))
  const clearRecent = useUIStore((s) => s.clearRecentlyCreated)
  const openEdit = useUIStore((s) => s.openEditPopup)
  const isMobile = useIsMobile()

  // Once, before the first paint: fly to a row on screen instead of showing the pill.
  const decided = useRef(false)
  useLayoutEffect(() => {
    if (decided.current || !todo) return
    decided.current = true
    if (isMobile || prefersReducedMotion()) return
    const row = findFlightRow(todo.id)
    if (!row) return
    flyTaskHome(row, todo.title)
    clearRecent()
  }, [todo, isMobile, clearRecent])

  // Task can be deleted (or never load) while the pill is up — bail out so
  // the timer-driven fade-out animation doesn't linger on a stale row.
  useEffect(() => {
    if (!todo) clearRecent()
  }, [todo, clearRecent])

  if (!todo) return null

  const handleOpenDetail = (id: number) => {
    clearRecent()
    openEdit(id)
  }

  return (
    <div
      className={styles.pill}
      {...{ [NOT_A_FLIGHT_TARGET_ATTR]: '' }}
      role="status"
      aria-live="polite"
      onAnimationEnd={() => clearRecent()}
    >
      <span className={styles.label}>New</span>
      {/* The default split: no divider here. */}
      <TaskRowGrid className={styles.rowWrapper}>
        <TaskRow
          todo={todo}
          assignedPeople={assignedPeople}
          onOpenDetail={handleOpenDetail}
        />
      </TaskRowGrid>
      <button
        type="button"
        className={styles.dismissButton}
        onClick={() => clearRecent()}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
