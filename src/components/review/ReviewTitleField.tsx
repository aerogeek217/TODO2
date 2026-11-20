import { useRef, useState } from 'react'
import type { PersistedTodoItem } from '../../models'
import styles from './Review.module.css'

/** A task title's longest text, as the task editor's title field takes it. */
const TITLE_MAX = 500

/**
 * The review card's title, edited in place as the task editor's is: a plain
 * field drawn as the title (no box; the caret marks the focus) that writes on
 * ⏎ and on blur — one undo step, after the notes typed so far (`write`) — and
 * never a blank title (the stored one comes back). Esc puts the stored title
 * back and leaves the field. While it isn't being typed in it follows the
 * stored title (an undo, an edit elsewhere).
 *
 * The large face's wraps, growing with its text (a textarea over a hidden copy
 * of it, `data-replicated`); the medium face's is one line (`compact`).
 */
export function ReviewTitleField({ todo, compact = false, className, write }: {
  todo: PersistedTodoItem
  compact?: boolean
  className: string | undefined
  /** Stores the new title (trimmed, never blank, only when changed). */
  write: (title: string) => void
}) {
  // What is typed; null while not typing — the stored title shows.
  const [draft, setDraft] = useState<string | null>(null)
  const cancelRef = useRef(false)
  const value = draft ?? todo.title

  const commit = () => {
    const typed = draft
    setDraft(null)
    if (cancelRef.current) {
      cancelRef.current = false
      return
    }
    const next = typed?.trim()
    if (next && next !== todo.title) write(next)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      // The field's own: it doesn't close the widget popup around it.
      e.preventDefault()
      e.stopPropagation()
      cancelRef.current = true
      e.currentTarget.blur()
    }
  }
  const common = {
    className: `${styles.titleInput} ${className ?? ''}`,
    value,
    maxLength: TITLE_MAX,
    'aria-label': 'Task title',
    placeholder: 'Task title',
    spellCheck: false,
    autoComplete: 'off',
    'data-testid': 'review-card-title',
    onBlur: commit,
    onKeyDown,
  }

  if (compact) {
    return <input {...common} onChange={(e) => setDraft(e.target.value)} />
  }
  return (
    <div className={styles.titleField} data-replicated={value}>
      <textarea
        {...common}
        rows={1}
        // One line of text: a newline typed or pasted is a space.
        onChange={(e) => setDraft(e.target.value.replace(/\r?\n/g, ' '))}
      />
    </div>
  )
}
