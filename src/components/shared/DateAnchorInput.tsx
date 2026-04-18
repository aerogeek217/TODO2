import { useCallback } from 'react'
import type { DateAnchor, RelativeDateToken } from '../../models'
import { RELATIVE_DATE_TOKENS } from '../../models'
import styles from './DateAnchorInput.module.css'

const RELATIVE_TOKEN_LABELS: Record<RelativeDateToken, string> = {
  'today': 'Today',
  'tomorrow': 'Tomorrow',
  'start-of-week': 'Start of week',
  'end-of-week': 'End of week',
  'start-of-next-week': 'Start of next week',
  'end-of-next-week': 'End of next week',
  'start-of-month': 'Start of month',
  'end-of-month': 'End of month',
  'start-of-next-month': 'Start of next month',
  'end-of-next-month': 'End of next month',
  'end-of-month-plus-3': 'End of (month + 3)',
}

export interface DateAnchorInputProps {
  value: DateAnchor | null
  onChange: (v: DateAnchor | null) => void
  'aria-label'?: string
  className?: string
}

/**
 * Combined date input: native `<input type="date">` for fixed dates alongside a
 * `<select>` of relative tokens (today, start-of-week, end-of-month, ...). When
 * the user picks a relative token the fixed date clears and vice versa. Shared
 * between TopBar and FilterSheet so both surfaces author the same DSL.
 */
export function DateAnchorInput({ value, onChange, className, ...aria }: DateAnchorInputProps) {
  const dateStr = value && value.kind === 'fixed' ? value.iso.slice(0, 10) : ''
  const tokenStr = value && value.kind === 'relative' ? value.token : ''

  const handleDateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    if (!v) {
      onChange(null)
      return
    }
    onChange({ kind: 'fixed', iso: new Date(v + 'T00:00:00').toISOString() })
  }, [onChange])

  const handleTokenChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value
    if (!v) {
      if (value && value.kind === 'relative') onChange(null)
      return
    }
    onChange({ kind: 'relative', token: v as RelativeDateToken })
  }, [onChange, value])

  return (
    <div className={`${styles.wrapper} ${className ?? ''}`}>
      <input
        type="date"
        className={styles.dateInput}
        value={dateStr}
        onChange={handleDateChange}
        aria-label={aria['aria-label']}
      />
      <select
        className={styles.tokenSelect}
        value={tokenStr}
        onChange={handleTokenChange}
        aria-label={aria['aria-label'] ? `${aria['aria-label']} (relative)` : 'Relative date'}
        title="Relative date"
      >
        <option value="">Custom…</option>
        {RELATIVE_DATE_TOKENS.map(t => (
          <option key={t} value={t}>{RELATIVE_TOKEN_LABELS[t]}</option>
        ))}
      </select>
    </div>
  )
}
