import { useCallback } from 'react'
import type { DateAnchor, RelativeDateToken } from '../../models'
import { RELATIVE_DATE_TOKENS } from '../../models'
import styles from './DateAnchorInput.module.css'

const RELATIVE_TOKEN_LABELS: Record<RelativeDateToken, string> = {
  'yesterday': 'Yesterday',
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

const NONE_SENTINEL = '__none__'
const OFFSET_SENTINEL = '__offset__'

export interface DateAnchorInputProps {
  value: DateAnchor | null
  onChange: (v: DateAnchor | null) => void
  'aria-label'?: string
  className?: string
}

/**
 * Combined date input. The `<select>` carries every authoring path: a fixed
 * date (typed into the native date input below), a named relative token
 * (today / start-of-week / end-of-month / …), or a custom integer day offset
 * from today (the `Custom offset…` option swaps the date input out for a
 * number-of-days input so users can author windows like `-7` for "stale by a
 * week" without picking a named token). Shared between TopBar, FilterSheet,
 * and any other surface that authors the same DSL.
 */
export function DateAnchorInput({ value, onChange, className, ...aria }: DateAnchorInputProps) {
  const dateStr = value && value.kind === 'fixed' ? value.iso.slice(0, 10) : ''
  const offsetStr = value && value.kind === 'offset' ? String(value.days) : ''
  const tokenStr = value === null
    ? NONE_SENTINEL
    : value.kind === 'relative'
      ? value.token
      : value.kind === 'offset'
        ? OFFSET_SENTINEL
        : ''

  const handleDateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    if (!v) {
      onChange(null)
      return
    }
    onChange({ kind: 'fixed', iso: new Date(v + 'T00:00:00').toISOString() })
  }, [onChange])

  const handleOffsetChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    if (raw === '' || raw === '-') {
      onChange({ kind: 'offset', days: 0 })
      return
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    onChange({ kind: 'offset', days: Math.trunc(n) })
  }, [onChange])

  const handleTokenChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value
    if (v === NONE_SENTINEL || !v) {
      onChange(null)
      return
    }
    if (v === OFFSET_SENTINEL) {
      const prior = value && value.kind === 'offset' ? value.days : 0
      onChange({ kind: 'offset', days: prior })
      return
    }
    onChange({ kind: 'relative', token: v as RelativeDateToken })
  }, [onChange, value])

  return (
    <div className={`${styles.wrapper} ${className ?? ''}`}>
      {value?.kind === 'offset' ? (
        <span className={styles.offsetField}>
          <input
            type="number"
            className={styles.offsetInput}
            value={offsetStr}
            onChange={handleOffsetChange}
            aria-label={aria['aria-label'] ? `${aria['aria-label']} (days offset)` : 'Days from today'}
          />
          <span className={styles.offsetSuffix}>days</span>
        </span>
      ) : (
        <input
          type="date"
          className={styles.dateInput}
          value={dateStr}
          onChange={handleDateChange}
          aria-label={aria['aria-label']}
        />
      )}
      <select
        className={styles.tokenSelect}
        value={tokenStr}
        onChange={handleTokenChange}
        aria-label={aria['aria-label'] ? `${aria['aria-label']} (relative)` : 'Relative date'}
        title="Relative date"
      >
        {value && value.kind === 'fixed' && <option value="">Custom…</option>}
        <option value={NONE_SENTINEL}>None</option>
        {RELATIVE_DATE_TOKENS.map(t => (
          <option key={t} value={t}>{RELATIVE_TOKEN_LABELS[t]}</option>
        ))}
        <option value={OFFSET_SENTINEL}>Custom offset…</option>
      </select>
    </div>
  )
}
