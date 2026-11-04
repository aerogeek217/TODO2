import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useSubtaskStore } from '../../../stores/subtask-store'
import { useTodoStore } from '../../../stores/todo-store'
import { formatDateNumeric } from '../../../utils/date'
import { Dialog, DialogBody } from '../../shared/Dialog'
import styles from './Subtasks.module.css'

/** At most this many tasks are listed; the search narrows them. */
const MAX_SHOWN = 40

/**
 * Picking a task by search (cr28, T3): "Make subtask of…" and "Move to
 * another task…". A small dialog with a search field and the matching
 * tasks — tasks only (never subtasks), open ones first, completed ones
 * muted after them, `excludeIds` left out (the task itself, a subtask's
 * own task). ↑↓ move the highlight, ⏎ picks it, a click picks a row; Esc
 * closes. Stacked above whatever opened it (the editor, the task dialog).
 */
export function TaskPickerDialog({ title, excludeIds, onPick, onClose }: {
  title: string
  excludeIds: ReadonlySet<number>
  onPick: (todoId: number) => void
  onClose: () => void
}) {
  const todos = useTodoStore((s) => s.todos)
  const byTodo = useSubtaskStore((s) => s.byTodo)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hits = todos.filter((t) => !excludeIds.has(t.id) && (q === '' || t.title.toLowerCase().includes(q)))
    const open = hits.filter((t) => !t.isCompleted)
    const done = hits.filter((t) => t.isCompleted)
    return [...open, ...done].slice(0, MAX_SHOWN)
  }, [todos, query, excludeIds])
  const highlighted = Math.min(index, Math.max(0, matches.length - 1))

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex(Math.min(highlighted + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex(Math.max(highlighted - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = matches[highlighted]
      if (pick) onPick(pick.id)
    }
  }

  const meta = (todoId: number, completedAt: Date | undefined, isCompleted: boolean): string => {
    if (isCompleted) return completedAt ? `Completed ${formatDateNumeric(completedAt)}` : 'Completed'
    const n = byTodo.get(todoId)?.length ?? 0
    return n > 0 ? `${n} ${n === 1 ? 'subtask' : 'subtasks'}` : ''
  }

  return (
    <Dialog open title={title} onClose={onClose} initialFocusRef={inputRef} nested className={styles.picker}>
      <DialogBody>
        <input
          ref={inputRef}
          className={styles.pickerSearch}
          value={query}
          placeholder="Find a task…"
          aria-label="Find a task"
          autoComplete="off"
          onChange={(e) => { setQuery(e.target.value); setIndex(0) }}
          onKeyDown={onKeyDown}
        />
        <ul className={styles.pickerList} role="listbox" aria-label="Tasks" data-task-picker="">
          {matches.map((t, i) => (
            <li key={t.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={i === highlighted}
                className={styles.pickerItem}
                data-highlighted={i === highlighted ? '' : undefined}
                data-done={t.isCompleted ? '' : undefined}
                onMouseEnter={() => setIndex(i)}
                onClick={() => onPick(t.id)}
              >
                <span className={styles.pickerTitle}>{t.title}</span>
                <span className={styles.pickerMeta}>{meta(t.id, t.completedAt, t.isCompleted)}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className={styles.pickerEmpty}>No task matches</li>}
        </ul>
      </DialogBody>
    </Dialog>
  )
}
