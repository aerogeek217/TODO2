import type { ReactNode } from 'react'
import styles from './Slot.module.css'

interface SlotProps {
  header: ReactNode
  children: ReactNode
}

export function Slot({ header, children }: SlotProps) {
  return (
    <section className={styles.slot} role="group">
      {header}
      <div className={styles.body}>{children}</div>
    </section>
  )
}
