import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { PersistedTodoItem } from '../../../models'
import { useSubtasks, useSubtaskStore } from '../../../stores/subtask-store'
import { subtaskCount } from '../../../utils/subtasks'
import type { MenuEntry } from '../../shared/MenuPopover'
import { SubtaskChecklist, type ChecklistItem } from './SubtaskChecklist'
import styles from './Subtasks.module.css'

/**
 * The phone's checklist (cr28, T2): a bottom sheet over a scrim, opened by
 * the row's `2/5 subtasks` chip — the task's title and count, the checklist
 * with touch-height rows, the add row. The scrim's tap and Esc close it.
 */
export function SubtasksSheet({ todo, onClose, extraMenuEntries }: {
  todo: PersistedTodoItem
  onClose: () => void
  extraMenuEntries?: (item: ChecklistItem) => MenuEntry[]
}) {
  const subtasks = useSubtasks(todo.id)
  const count = subtaskCount(subtasks)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const store = () => useSubtaskStore.getState()
  return createPortal(
    <>
      <div className={styles.backdrop} onClick={onClose} onTouchMove={(e) => e.preventDefault()} />
      <div
        className={styles.sheet}
        role="dialog"
        aria-label={`Subtasks of ${todo.title}`}
        data-subtasks-sheet=""
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.sheetHead}>
          <span className={styles.sheetTitle}>{todo.title}</span>
          <span className={styles.sheetCount} data-subtask-count-text="">{count.done} of {count.total}</span>
        </div>
        <div className={styles.sheetBody}>
          <SubtaskChecklist
            items={subtasks}
            density="touch"
            label="Subtasks"
            onAdd={(title) => { void store().add(todo.id, title) }}
            onRename={(id, title) => { void store().rename(id, title) }}
            onSetDone={(id, done) => { void store().setDone(id, done) }}
            onRemove={(id) => { void store().remove(id) }}
            extraMenuEntries={extraMenuEntries}
          />
        </div>
      </div>
    </>,
    document.body,
  )
}
