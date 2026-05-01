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
 *   • click "+ Taskboard" to one-shot add it to the singleton taskboard
 *   • click × to dismiss immediately
 *
 * Render lifetime is keyed on `recentlyCreated.key` so a fresh creation
 * remounts the pill — the CSS animation restarts cleanly.
 */
import { useEffect } from 'react'
import { useUIStore } from '../../stores/ui-store'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useTaskboardStore } from '../../stores/taskboard-store'
import { TaskRow } from '../task/TaskRow'
import styles from './RecentTaskPill.module.css'

export function RecentTaskPill() {
  const recent = useUIStore((s) => s.recentlyCreated)
  if (!recent) return null
  return <RecentTaskPillBody key={recent.key} todoId={recent.todoId} />
}

function RecentTaskPillBody({ todoId }: { todoId: number }) {
  const todo = useTodoStore((s) => s.todos.find((t) => t.id === todoId))
  const assignedPeople = usePersonStore((s) => s.assignedPeopleMap.get(todoId))
  const onTaskboard = useTaskboardStore((s) => s.board?.entries.some((e) => e.todoId === todoId) ?? false)
  const clearRecent = useUIStore((s) => s.clearRecentlyCreated)
  const openEdit = useUIStore((s) => s.openEditPopup)

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

  const handleAddToTaskboard = () => {
    if (onTaskboard) return
    void useTaskboardStore.getState().add(todoId)
    clearRecent()
  }

  return (
    <div
      className={styles.pill}
      role="status"
      aria-live="polite"
      onAnimationEnd={() => clearRecent()}
    >
      <span className={styles.label}>New</span>
      <div className={styles.rowWrapper}>
        <TaskRow
          todo={todo}
          assignedPeople={assignedPeople}
          onOpenDetail={handleOpenDetail}
        />
      </div>
      <button
        type="button"
        className={styles.boardButton}
        onClick={handleAddToTaskboard}
        disabled={onTaskboard}
        title={onTaskboard ? 'Already on taskboard' : 'Add to taskboard'}
      >
        {onTaskboard ? '✓ Taskboard' : '+ Taskboard'}
      </button>
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
