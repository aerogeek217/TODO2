import type { ReactNode } from 'react'
import styles from './sections.module.css'

interface SettingRowProps {
  label: ReactNode
  /** Muted help text under the label. */
  help?: ReactNode
  /** Lays the control out as a column (stacked lines) instead of a wrapping row. */
  column?: boolean
  children: ReactNode
}

/** One settings row: label (+ help) on the left, the control on the right. */
export function SettingRow({ label, help, column = false, children }: SettingRowProps) {
  return (
    <div className={styles.row}>
      <div className={styles.labelCell}>
        <span className={styles.label}>{label}</span>
        {help && <span className={styles.help}>{help}</span>}
      </div>
      <div className={column ? styles.controlColumn : styles.control}>{children}</div>
    </div>
  )
}
