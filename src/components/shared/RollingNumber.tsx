import { useState } from 'react'
import styles from './RollingNumber.module.css'

const DIGIT = /^\d$/

/** The number in `text` (its digits read as one), for the roll's direction; NaN with none. */
function numeric(text: string): number {
  const digits = text.replace(/[^\d.-]/g, '')
  return digits === '' ? Number.NaN : Number(digits)
}

interface Roll {
  /** The text shown. */
  text: string
  /** The text before the last change while mounted (`null` before any: nothing rolls). */
  prev: string | null
  /** Counts the changes, so a digit that changes again starts its roll over. */
  gen: number
}

/**
 * A figure whose digits roll when it changes while mounted (flair P1): each
 * digit that changed slides out as the new one slides in — up when the
 * number rises, down when it falls (about 280 ms, the spring curve) — in its
 * own clip window, the figure's line box. Nothing rolls on the first render
 * (a layout opening, a face change, a reload); digits that didn't change
 * stay still, and one that appears or goes just does. The element's text is
 * the plain figure (the old digit is a `::before` with empty alt text), so
 * it reads as before; reduced motion swaps the digits.
 */
export function RollingNumber({ value }: { value: string | number }) {
  const text = String(value)
  const [roll, setRoll] = useState<Roll>({ text, prev: null, gen: 0 })
  let current = roll
  if (roll.text !== text) {
    current = { text, prev: roll.text, gen: roll.gen + 1 }
    setRoll(current)
  }
  const { prev, gen } = current
  const dir = prev != null && numeric(text) < numeric(prev) ? 'down' : 'up'
  const chars = [...text]
  const prevChars = prev == null ? [] : [...prev]
  return (
    <span className={styles.roll} data-rolling-number="">
      {chars.map((ch, i) => {
        // Places line up from the right (units under units).
        const place = chars.length - 1 - i
        const old = prevChars[prevChars.length - 1 - place]
        const rolls = old !== undefined && old !== ch && DIGIT.test(ch) && DIGIT.test(old)
        return (
          <span
            key={rolls ? `${place}-${gen}` : `${place}`}
            className={styles.digit}
            data-prev={rolls ? old : undefined}
            data-dir={rolls ? dir : undefined}
          >
            <span className={styles.glyph}>{ch}</span>
          </span>
        )
      })}
    </span>
  )
}
