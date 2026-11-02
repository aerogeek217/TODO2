import { useCallback, useState } from 'react'
import type { DateAnchor, RelativeDateToken } from '../../models'
import type { DateAnchorSide } from '../../utils/date-anchor'
import { OFFSET_PRESETS, RELATIVE_TOKEN_LABELS, SIDE_RELATIVE_TOKENS, offsetPresetFor } from '../../utils/date-anchor'
import styles from './DateAnchorInput.module.css'

const NONE_SENTINEL = '__none__'
const OFFSET_SENTINEL = '__offset__'
const OFFSET_PRESET_PREFIX = '__offset:'
const OFFSET_DRAFT_PATTERN = /^-?\d*$/

function presetValue(days: number): string {
  return `${OFFSET_PRESET_PREFIX}${days}`
}

/** The select's value for a stored anchor: its token, its named offset, else a sentinel. */
function selectValueOf(value: DateAnchor | null): string {
  if (value === null) return NONE_SENTINEL
  switch (value.kind) {
    case 'fixed': return ''
    case 'relative': return value.token
    case 'offset': return offsetPresetFor(value.days) ? presetValue(value.days) : OFFSET_SENTINEL
  }
}

export interface DateAnchorInputProps {
  value: DateAnchor | null
  /** Which end of the range: From lists Start of week, To lists End of week. */
  side: DateAnchorSide
  onChange: (v: DateAnchor | null) => void
  'aria-label'?: string
  className?: string
}

/**
 * Combined date input for one end of a date range (`DateFilterPanel`'s From /
 * To). The `<select>` carries every authoring path: a fixed date (typed into
 * the native date input), a named day (Today, and Start of week on From / End
 * of week on To), a named day offset (`1 week ago` … `In 1 month`, from
 * `utils/date-anchor.OFFSET_PRESETS`), or `Custom offset…`. An offset — named
 * or custom — swaps the date input for the number-of-days field, which stays
 * editable: the select names the offset while its days match a preset, else
 * reads `Custom offset…`. A stored token the list doesn't offer (an older
 * filter's `end-of-month`, a search token's `end-of-next-week`) is listed
 * after None, only while it is the value.
 */
export function DateAnchorInput({ value, side, onChange, className, ...aria }: DateAnchorInputProps) {
  const dateStr = value && value.kind === 'fixed' ? value.iso.slice(0, 10) : ''
  const tokenStr = selectValueOf(value)
  const sideTokens = SIDE_RELATIVE_TOKENS[side]
  const extraToken = value?.kind === 'relative' && !sideTokens.includes(value.token) ? value.token : null

  // Local draft so users can transit through partial states the controlled
  // value can't represent — `''` (cleared input) and `'-'` (about to type a
  // negative). type="number" reports `e.target.value` as `''` when the
  // displayed text is just `'-'`, so we route the offset input through
  // `type="text" inputMode="numeric"` and accept `-?\d*` as draft input. The
  // committed `value.days` only updates when the draft parses to an integer;
  // otherwise the draft holds the input's display so the caret stays put.
  const isOffset = value?.kind === 'offset'
  const [offsetDraft, setOffsetDraft] = useState<string | null>(null)
  // Leaving offset mode discards the draft (adjusted during render, not in an
  // effect, so re-entering offset mode never flashes a stale draft).
  if (!isOffset && offsetDraft !== null) setOffsetDraft(null)
  const offsetStr = isOffset
    ? offsetDraft ?? String(value.days)
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
    if (!OFFSET_DRAFT_PATTERN.test(raw)) return
    setOffsetDraft(raw)
    if (raw === '' || raw === '-') return
    const n = parseInt(raw, 10)
    if (!Number.isFinite(n)) return
    onChange({ kind: 'offset', days: n })
  }, [onChange])

  const handleOffsetBlur = useCallback(() => {
    setOffsetDraft(null)
  }, [])

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
    if (v.startsWith(OFFSET_PRESET_PREFIX)) {
      setOffsetDraft(null)
      onChange({ kind: 'offset', days: parseInt(v.slice(OFFSET_PRESET_PREFIX.length), 10) })
      return
    }
    onChange({ kind: 'relative', token: v as RelativeDateToken })
  }, [onChange, value])

  return (
    <div className={`${styles.wrapper} ${className ?? ''}`}>
      {isOffset ? (
        <span className={styles.offsetField}>
          <input
            type="text"
            inputMode="numeric"
            pattern="-?[0-9]*"
            className={styles.offsetInput}
            value={offsetStr}
            onChange={handleOffsetChange}
            onBlur={handleOffsetBlur}
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
        {extraToken && <option value={extraToken}>{RELATIVE_TOKEN_LABELS[extraToken]}</option>}
        {sideTokens.map(t => (
          <option key={t} value={t}>{RELATIVE_TOKEN_LABELS[t]}</option>
        ))}
        {OFFSET_PRESETS.map(p => (
          <option key={p.days} value={presetValue(p.days)}>{p.label}</option>
        ))}
        <option value={OFFSET_SENTINEL}>Custom offset…</option>
      </select>
    </div>
  )
}
