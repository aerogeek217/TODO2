import { useRef } from 'react'
import { toDateInputValue } from '../../utils/date'
import { factDateWords } from '../../utils/fact-dates'
import { useToday } from '../../hooks/use-today'
import { useSettingsStore } from '../../stores/settings-store'
import styles from './DeadlinePicker.module.css'

interface DeadlinePickerProps {
  value: Date | null | undefined
  onChange: (next: Date | null) => void
  /** The due date's state, as its row colours it: `past` bold in the late colour, `soon` in it. */
  tone?: 'past' | 'soon'
}

/**
 * The task layout's due date (board BJ, one date look): the date in the
 * rows' words (`Today`, `Fri`, `11/06`) and, where the words don't say it,
 * how far it is (`3 days late`); the full date in its tooltip. A click
 * opens the browser's date picker (on a hidden `type="date"` input); × beside
 * it clears the date. Without one: `Set a date`.
 */
export function DeadlinePicker({ value, onChange, tone }: DeadlinePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const today = useToday()
  const rowDates = useSettingsStore((s) => s.rowDates)

  const open = () => {
    try { inputRef.current?.showPicker?.() } catch { inputRef.current?.focus() }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    onChange(raw ? new Date(raw + 'T00:00:00') : null)
  }

  const words = value ? factDateWords(value, today, rowDates, 'due') : null

  return (
    <span className={styles.picker}>
      <button
        type="button"
        className={styles.trigger}
        onClick={(e) => { e.stopPropagation(); open() }}
        title={words ? `Due ${words.full}` : 'Set due date'}
        aria-label={words ? `Due date: ${words.full}` : 'Set due date'}
      >
        {words ? (
          <>
            <span className={styles.words} data-tone={tone}>{words.words}</span>
            {words.relative && <span className={styles.relative}>{words.relative}</span>}
          </>
        ) : (
          <span className={styles.empty}>Set a date</span>
        )}
      </button>
      {value && (
        <button
          type="button"
          className={styles.clearButton}
          onClick={(e) => { e.stopPropagation(); onChange(null) }}
          title="Clear due date"
          aria-label="Clear due date"
        >&times;</button>
      )}
      <input
        ref={inputRef}
        type="date"
        className={styles.hiddenDateInput}
        tabIndex={-1}
        aria-hidden="true"
        value={toDateInputValue(value ?? undefined)}
        onChange={handleChange}
      />
    </span>
  )
}
