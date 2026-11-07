import { useCallback, type ReactNode } from 'react'
import type { GlanceTab } from '../../../models/workspace-layout'
import { SELECTION_SCOPE_ATTR } from '../../../utils/dom-contract'
import type { WidgetFace } from '../../../utils/widget-face'
import { ListBulkBar } from '../list/ListBulkBar'
import type { GlanceRows } from './glance-hooks'
import styles from './GlanceWidget.module.css'

/**
 * A glance widget's frame: fills its cell, the section (or the Number)
 * inside it. A row widget's frame is its selection scope, with its bulk bar
 * — not at its small face (D25 R: no rows; the full widget in its popover
 * is the scope then). `faceRef` measures the face (`useWidgetFace`).
 */
export function GlanceFrame({ tab, rows, faceRef, face, children }: {
  tab: GlanceTab
  rows?: GlanceRows
  faceRef?: (el: HTMLElement | null) => void
  face?: WidgetFace
  children: ReactNode
}) {
  const small = face === 'small'
  const scope = rows && !rows.isMobile && !small ? { [SELECTION_SCOPE_ATTR]: tab.id } : {}
  const rootRef = rows?.rootRef
  const ref = useCallback((el: HTMLDivElement | null) => {
    rootRef?.(el)
    faceRef?.(el)
  }, [rootRef, faceRef])
  return (
    <div ref={ref} className={styles.widget} data-glance={tab.kind} data-glance-tab={tab.id} data-face={face} {...scope}>
      {children}
      {rows?.bulkIds && !small && <ListBulkBar ids={rows.bulkIds} bottom={12} />}
    </div>
  )
}
