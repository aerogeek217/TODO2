import type { ReactNode } from 'react'
import styles from './Slot.module.css'

interface SlotProps {
  header: ReactNode
  children: ReactNode
  bodyRole?: string
  bodyLabelledBy?: string
}

export function Slot({ header, children, bodyRole, bodyLabelledBy }: SlotProps) {
  return (
    <section className={styles.slot} role="group">
      {header}
      <div
        className={styles.body}
        role={bodyRole}
        aria-labelledby={bodyLabelledBy}
      >
        {children}
      </div>
    </section>
  )
}
