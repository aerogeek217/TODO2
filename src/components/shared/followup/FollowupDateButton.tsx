import { useRef } from 'react'
import { startOfDay, toDateInputValue } from '../../../utils/date'
import { StatusIcon } from '../StatusIcon'
import styles from './Followup.module.css'

interface FollowupDateButtonProps {
  /** The button's accessible name (`Pick next follow-up date`). */
  label: string
  /** The date the browser's picker opens on. */
  value: Date | undefined
  /** The earliest day that can be picked (Planned: today). */
  min?: Date
  /** The latest day that can be picked (Last follow-up: today). */
  max?: Date
  /** A picked day (local midnight), or null when the picker was cleared. */
  onPick: (date: Date | null) => void
}

/**
 * The calendar button at the end of a typed date field (the follow-up
 * fields, a status update's day, the task layout's Due and Planned): one
 * click opens the browser's date picker on a hidden `type="date"` input
 * (focus is the fallback where `showPicker` isn't there). A press keeps the
 * field's focus, so the field's own blur doesn't commit its text first.
 */
export function FollowupDateButton({ label, value, min, max, onPick }: FollowupDateButtonProps) {
  const pickerRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        type="button"
        className={styles.inputClear}
        aria-label={label}
        data-tooltip="Pick a date"
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
        min={min ? toDateInputValue(min) : undefined}
        max={max ? toDateInputValue(max) : undefined}
        value={value ? toDateInputValue(value) : ''}
        onChange={(e) => {
          const raw = e.target.value
          const date = raw ? new Date(raw + 'T00:00:00') : null
          if (date && max && date.getTime() > startOfDay(max).getTime()) return
          if (date && min && date.getTime() < startOfDay(min).getTime()) return
          onPick(date)
        }}
      />
    </>
  )
}
