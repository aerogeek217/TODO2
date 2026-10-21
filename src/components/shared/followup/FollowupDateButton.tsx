import { useRef } from 'react'
import { startOfDay, toDateInputValue } from '../../../utils/date'
import { StatusIcon } from '../StatusIcon'
import styles from './Followup.module.css'

interface FollowupDateButtonProps {
  /** The button's accessible name (`Pick next follow-up date`). */
  label: string
  /** The date the browser's picker opens on. */
  value: Date | undefined
  /** The latest day that can be picked (Last follow-up: today). */
  max?: Date
  /** A picked day (local midnight), or null when the picker was cleared. */
  onPick: (date: Date | null) => void
}

/**
 * The calendar button at the end of a follow-up field: opens the browser's
 * date picker on a hidden `type="date"` input (focus is the fallback where
 * `showPicker` isn't there), as the due date's picker does. A press keeps
 * the field's focus, so the field's own blur doesn't commit its text first.
 */
export function FollowupDateButton({ label, value, max, onPick }: FollowupDateButtonProps) {
  const pickerRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        type="button"
        className={styles.inputClear}
        aria-label={label}
        title="Pick a date"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          try { pickerRef.current?.showPicker?.() } catch { pickerRef.current?.focus() }
        }}
      >
        <StatusIcon icon="calendar" />
      </button>
      <input
        ref={pickerRef}
        type="date"
        className={styles.hiddenDateInput}
        tabIndex={-1}
        aria-hidden="true"
        max={max ? toDateInputValue(max) : undefined}
        value={value ? toDateInputValue(value) : ''}
        onChange={(e) => {
          const raw = e.target.value
          const date = raw ? new Date(raw + 'T00:00:00') : null
          if (date && max && date.getTime() > startOfDay(max).getTime()) return
          onPick(date)
        }}
      />
    </>
  )
}
