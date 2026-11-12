import type { ReactNode } from 'react'
import { Tooltip } from '../../shared/Tooltip'
import styles from './NumberWidget.module.css'

/**
 * A Number's 14-day line, its box (a count's and a Share of…'s): while the
 * history log doesn't hold all it reads for the whole line, `approximate`
 * (`glance-copy.approximateNote`) is its tooltip — no mark of its own
 * beside it (widget feedback 2D: a lone ≈ under the line read as noise);
 * the Number's accessible name says "About" before its change.
 */
export function NumberLine({ approximate, children }: { approximate: string | null; children: ReactNode }) {
  return (
    <Tooltip text={approximate} className={styles.spark} data-number-line="" data-approximate={approximate ? 'true' : undefined}>
      {children}
    </Tooltip>
  )
}
