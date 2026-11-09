import { useState } from 'react'
import { NUMBER_LIT_AT_MAX, type NumberLitWhen } from '../../../models/glance-widgets'
import styles from './NumberEditor.module.css'

const LIT_WHEN: ReadonlyArray<{ value: NumberLitWhen; label: string }> = [
  { value: 'never', label: 'Never' },
  { value: 'above', label: 'Above' },
  { value: 'below', label: 'Below' },
]

/** A threshold: a whole number 0 – `NUMBER_LIT_AT_MAX`, written once it reads; a blur puts back the value. */
function LitAtField({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  const [text, setText] = useState(String(value))
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    setText(String(value))
  }
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={NUMBER_LIT_AT_MAX}
      step={1}
      className={styles.number}
      aria-label={label}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= NUMBER_LIT_AT_MAX) onChange(n)
      }}
      onBlur={() => setText(String(value))}
    />
  )
}

/**
 * Light up when (D18): Never / Above / Below and, but for Never, the
 * threshold (and its unit) — a Number's, a Breakdown count column's.
 * Picking Never drops the threshold; Above / Below keep it, else 0.
 */
export function LitWhenControl({ litWhen, litAt, unit, label = 'Light up when', onChange }: {
  litWhen: NumberLitWhen
  litAt: number | undefined
  /** The threshold's unit (a share's %, an oldest's days). */
  unit?: string | null
  /** The select's accessible name (the threshold's starts with it). */
  label?: string
  onChange: (next: { litWhen: NumberLitWhen; litAt: number | undefined }) => void
}) {
  return (
    <span className={styles.litRow}>
      <select
        className={styles.select}
        aria-label={label}
        value={litWhen}
        onChange={(e) => {
          const next = e.target.value as NumberLitWhen
          onChange(next === 'never' ? { litWhen: next, litAt: undefined } : { litWhen: next, litAt: litAt ?? 0 })
        }}
      >
        {LIT_WHEN.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {litWhen !== 'never' && (
        <LitAtField value={litAt ?? 0} label={`${label} ${litWhen}${unit ? ` (${unit})` : ''}`} onChange={(n) => onChange({ litWhen, litAt: n })} />
      )}
      {litWhen !== 'never' && unit && <span className={styles.unit}>{unit}</span>}
    </span>
  )
}
