import { useRef, useState, useEffect } from 'react'
import type { ScheduledValue } from '../../models/scheduled-value'
import { StatusIcon } from './StatusIcon'
import { scheduledLabel, isScheduledExpired } from '../../utils/effective-date'
import { useSettingsStore } from '../../stores/settings-store'
import { ScheduledValueMenu } from './ScheduledValueMenu'
import styles from './SchedulePicker.module.css'

interface SchedulePickerProps {
  value: ScheduledValue | null | undefined
  onChange: (next: ScheduledValue | null) => void
  /** Override "today" — tests may inject; production callers pass nothing. */
  today?: Date
}

export function SchedulePicker({ value, onChange, today }: SchedulePickerProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [open])

  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const todayDate = today ?? new Date()
  const label = value ? scheduledLabel(value, todayDate) : 'Schedule'
  const expired = !!(value && isScheduledExpired({ scheduledDate: value }, todayDate, weekStartsOn))

  const triggerCls = [
    styles.triggerChip,
    value ? styles.triggerChipActive : '',
    expired ? styles.triggerChipExpired : '',
  ].filter(Boolean).join(' ')

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <button
        type="button"
        className={triggerCls}
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v) }}
        title={value ? `Scheduled: ${label}` : 'Set scheduled date'}
      >
        <StatusIcon icon="calendar" />
        <span className={styles.triggerLabel}>{label}</span>
        {expired && <span className={styles.expiredMarker} aria-label="Expired" />}
        {value && (
          <span
            className={styles.clearButton}
            onClick={(e) => { e.stopPropagation(); onChange(null) }}
            title="Clear scheduled date"
          >&times;</span>
        )}
      </button>
      {open && (
        <ScheduledValueMenu
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
