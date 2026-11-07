import { useContext, type ReactNode } from 'react'
import { HelpTip } from '../../shared/HelpTip'
import { SettingsMobileContext } from './settings-layer'
import styles from './sections.module.css'

interface SettingRowProps {
  label: string
  /** What the setting does: an ⓘ after the label on desktop, muted text under it on a phone. */
  help?: string
  /** Live state under the label (a count, when it last saved, a warning), always shown. */
  status?: ReactNode
  /** Lays the control out as a column (stacked lines) instead of a wrapping row. */
  column?: boolean
  children: ReactNode
}

/** One settings row: label (+ ⓘ, + status) on the left, the control on the right. */
export function SettingRow({ label, help, status, column = false, children }: SettingRowProps) {
  const mobile = useContext(SettingsMobileContext)
  return (
    <div className={styles.row}>
      <div className={styles.labelCell}>
        <span className={styles.labelLine}>
          <span className={styles.label}>{label}</span>
          {help && !mobile && <HelpTip label={label} text={help} />}
        </span>
        {help && mobile && <span className={styles.help}>{help}</span>}
        {status && <span className={styles.help}>{status}</span>}
      </div>
      <div className={column ? styles.controlColumn : styles.control}>{children}</div>
    </div>
  )
}
