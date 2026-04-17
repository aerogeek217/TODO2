import { useRef, useState, useEffect } from 'react'
import type { ScheduledValue, FuzzyToken } from '../../models/scheduled-value'
import { StatusIcon } from './StatusIcon'
import { toDateInputValue } from '../../utils/date'
import { scheduledLabel, isScheduledExpired } from '../../utils/effective-date'
import styles from './SchedulePicker.module.css'

interface SchedulePickerProps {
  value: ScheduledValue | null | undefined
  onChange: (next: ScheduledValue | null) => void
  /** Override "today" — tests may inject; production callers pass nothing. */
  today?: Date
}

interface OptionChipProps {
  selected?: boolean
  small?: boolean
  onClick: () => void
  children: React.ReactNode
}

function OptionChip({ selected, small, onClick, children }: OptionChipProps) {
  const cls = [
    styles.optionChip,
    selected ? styles.optionChipSelected : '',
    small ? styles.optionChipSmall : '',
  ].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} onClick={(e) => { e.stopPropagation(); onClick() }}>
      {children}
    </button>
  )
}

export function SchedulePicker({ value, onChange, today }: SchedulePickerProps) {
  const [open, setOpen] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const dateInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
        setShowDatePicker(false)
      }
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [open])

  const todayDate = today ?? new Date()
  const label = value ? scheduledLabel(value, todayDate) : 'Schedule'
  const expired = !!(value && isScheduledExpired({ scheduledDate: value }, todayDate))

  const selectFuzzy = (token: FuzzyToken) => {
    onChange({ kind: 'fuzzy', token })
    setOpen(false)
  }

  const selectDate = (iso: string) => {
    if (!iso) { onChange(null); return }
    onChange({ kind: 'date', value: new Date(iso + 'T00:00:00') })
    setOpen(false)
    setShowDatePicker(false)
  }

  const isActive = (k: FuzzyToken) => value?.kind === 'fuzzy' && value.token === k

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
      </button>
      {open && (
        <div className={styles.menu}>
          <div className={styles.primaryRow}>
            <OptionChip selected={isActive('today')}     onClick={() => selectFuzzy('today')}>Today</OptionChip>
            <OptionChip selected={isActive('tomorrow')}  onClick={() => selectFuzzy('tomorrow')}>Tomorrow</OptionChip>
            <OptionChip selected={isActive('this-week')} onClick={() => selectFuzzy('this-week')}>This week</OptionChip>
            <OptionChip onClick={() => {
              setShowDatePicker(true)
              setTimeout(() => {
                try { dateInputRef.current?.showPicker?.() } catch { dateInputRef.current?.focus() }
              }, 0)
            }}>Pick day…</OptionChip>
            <OptionChip onClick={() => { onChange(null); setOpen(false) }}>Clear</OptionChip>
          </div>
          <div className={styles.secondaryRow}>
            <OptionChip selected={isActive('next-week')}  onClick={() => selectFuzzy('next-week')}  small>Next week</OptionChip>
            <OptionChip selected={isActive('this-month')} onClick={() => selectFuzzy('this-month')} small>This month</OptionChip>
            <OptionChip selected={isActive('next-month')} onClick={() => selectFuzzy('next-month')} small>Next month</OptionChip>
          </div>
          <input
            ref={dateInputRef}
            type="date"
            className={styles.hiddenDateInput}
            style={{ display: showDatePicker ? 'block' : 'none' }}
            value={value?.kind === 'date' ? toDateInputValue(value.value) : ''}
            onChange={(e) => selectDate(e.target.value)}
          />
        </div>
      )}
    </div>
  )
}
