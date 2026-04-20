import { useEffect, useRef, useState } from 'react'
import type { ScheduledValue, FuzzyToken } from '../../models/scheduled-value'
import { StatusIcon } from './StatusIcon'
import { toDateInputValue } from '../../utils/date'
import { scheduledValuesEqual } from '../../utils/effective-date'
import styles from './SchedulePicker.module.css'

interface PresetChipProps {
  selected?: boolean
  onClick: () => void
  children: React.ReactNode
}

function PresetChip({ selected, onClick, children }: PresetChipProps) {
  const cls = [styles.presetChip, selected ? styles.presetChipSelected : ''].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} onClick={(e) => { e.stopPropagation(); onClick() }}>
      {children}
    </button>
  )
}

interface ScheduledValueMenuProps {
  value: ScheduledValue | null | undefined
  onChange: (next: ScheduledValue | null) => void
  onClose: () => void
  /** When provided, renders an "Add deadline" action in the footer that invokes this callback after closing. */
  onAddDeadline?: () => void
}

/**
 * The menu content of a scheduled-value picker: 3×2 fuzzy-token grid plus action footer.
 * Shared by SchedulePicker (edit popup) and TaskRow (inline chip edit).
 * Callers supply positioning; this component renders the styled `.menu` container.
 */
export function ScheduledValueMenu({ value, onChange, onClose, onAddDeadline }: ScheduledValueMenuProps) {
  const [showDatePicker, setShowDatePicker] = useState(false)
  const dateInputRef = useRef<HTMLInputElement>(null)

  // Changes are staged locally and committed once the menu unmounts, so the
  // host list/view doesn't re-filter (and the task doesn't jump sections)
  // while the picker is still visible. See also commitAndClose below.
  const initialRef = useRef<ScheduledValue | null>(value ?? null)
  const [staged, setStaged] = useState<ScheduledValue | null>(value ?? null)
  const stagedRef = useRef<ScheduledValue | null>(staged)
  stagedRef.current = staged
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    return () => {
      if (!scheduledValuesEqual(stagedRef.current ?? undefined, initialRef.current ?? undefined)) {
        onChangeRef.current(stagedRef.current)
      }
    }
  }, [])

  const stage = (next: ScheduledValue | null) => {
    stagedRef.current = next
    setStaged(next)
  }

  const selectFuzzy = (token: FuzzyToken) => {
    stage({ kind: 'fuzzy', token })
    onClose()
  }

  const selectDate = (iso: string) => {
    if (!iso) { stage(null); onClose(); return }
    stage({ kind: 'date', value: new Date(iso + 'T00:00:00') })
    onClose()
  }

  const openDatePicker = () => {
    setShowDatePicker(true)
    setTimeout(() => {
      try { dateInputRef.current?.showPicker?.() } catch { dateInputRef.current?.focus() }
    }, 0)
  }

  const isActive = (k: FuzzyToken) => staged?.kind === 'fuzzy' && staged.token === k

  return (
    <div className={styles.menu} role="dialog" aria-label="Schedule" onClick={(e) => e.stopPropagation()}>
      <div className={styles.header}>
        <StatusIcon icon="calendar" />
        <span>Scheduled</span>
      </div>
      <div className={styles.grid}>
        <div className={styles.gutter}>Day</div>
        <PresetChip selected={isActive('today')}    onClick={() => selectFuzzy('today')}>Today</PresetChip>
        <PresetChip selected={isActive('tomorrow')} onClick={() => selectFuzzy('tomorrow')}>Tomorrow</PresetChip>

        <div className={styles.gutter}>Week</div>
        <PresetChip selected={isActive('this-week')} onClick={() => selectFuzzy('this-week')}>This week</PresetChip>
        <PresetChip selected={isActive('next-week')} onClick={() => selectFuzzy('next-week')}>Next week</PresetChip>

        <div className={styles.gutter}>Month</div>
        <PresetChip selected={isActive('this-month')} onClick={() => selectFuzzy('this-month')}>This month</PresetChip>
        <PresetChip selected={isActive('next-month')} onClick={() => selectFuzzy('next-month')}>Next month</PresetChip>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.actionRow} onClick={(e) => { e.stopPropagation(); openDatePicker() }}>
          <span className={styles.actionIcon}><StatusIcon icon="calendar" /></span>
          <span>Pick a specific day…</span>
        </button>
        {onAddDeadline && (
          <button
            type="button"
            className={styles.actionRow}
            onClick={(e) => { e.stopPropagation(); onClose(); onAddDeadline() }}
          >
            <span className={styles.actionIcon}><StatusIcon icon="clock" /></span>
            <span>Add deadline…</span>
          </button>
        )}
        {staged && (
          <button
            type="button"
            className={`${styles.actionRow} ${styles.actionClear}`}
            onClick={(e) => { e.stopPropagation(); stage(null); onClose() }}
          >
            <span className={styles.actionIcon} aria-hidden>×</span>
            <span>Clear</span>
          </button>
        )}
      </div>

      <input
        ref={dateInputRef}
        type="date"
        className={styles.hiddenDateInput}
        style={{ display: showDatePicker ? 'block' : 'none' }}
        value={staged?.kind === 'date' ? toDateInputValue(staged.value) : ''}
        onChange={(e) => selectDate(e.target.value)}
      />
    </div>
  )
}
