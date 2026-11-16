import { useState, type CSSProperties } from 'react'
import styles from './NumberWidget.module.css'

/**
 * A Number losing its light (flair P1): when a figure that was lit stops
 * being lit while mounted — its Light up when rule, reaching zero the common
 * case — one ring in its lit colour (`color`) expands from it and fades.
 * Nothing on becoming lit. A one-shot `aria-hidden` element inside the
 * figure (which is positioned), removed when its animation ends; not drawn
 * under reduced motion.
 */
export function LightRing({ lit, color }: { lit: boolean; color: string }) {
  const [state, setState] = useState({ lit, ring: 0 })
  let current = state
  if (state.lit !== lit) {
    current = { lit, ring: state.lit ? state.ring + 1 : state.ring }
    setState(current)
  }
  if (current.ring === 0) return null
  return (
    <span
      key={current.ring}
      className={styles.lightRing}
      style={{ '--light-ring-color': color } as CSSProperties}
      aria-hidden="true"
      data-light-ring=""
      onAnimationEnd={() => setState((s) => ({ ...s, ring: 0 }))}
    />
  )
}
