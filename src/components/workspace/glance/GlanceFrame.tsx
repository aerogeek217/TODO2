import type { ReactNode } from 'react'
import type { GlanceTab } from '../../../models/workspace-layout'
import { SELECTION_SCOPE_ATTR } from '../../../utils/dom-contract'
import { ListBulkBar } from '../list/ListBulkBar'
import type { GlanceRows } from './glance-hooks'
import styles from './GlanceWidget.module.css'

/**
 * A glance widget's frame: fills its cell, the section (or the Number)
 * inside it. A row widget's frame is its selection scope, with its bulk bar.
 */
export function GlanceFrame({ tab, rows, children }: { tab: GlanceTab; rows?: GlanceRows; children: ReactNode }) {
  const scope = rows && !rows.isMobile ? { [SELECTION_SCOPE_ATTR]: tab.id } : {}
  return (
    <div ref={rows?.rootRef} className={styles.widget} data-glance={tab.kind} data-glance-tab={tab.id} {...scope}>
      {children}
      {rows?.bulkIds && <ListBulkBar ids={rows.bulkIds} bottom={12} />}
    </div>
  )
}
