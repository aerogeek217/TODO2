import type { ReactNode } from 'react'
import type { GlanceTab } from '../../../models/workspace-layout'
import type { WidgetFace } from '../../../utils/widget-face'
import styles from './GlanceWidget.module.css'

/**
 * A glance widget's frame: fills its cell, the section (or the Number)
 * inside it. `faceRef` measures the face (`useWidgetFace`).
 */
export function GlanceFrame({ tab, faceRef, face, children }: {
  tab: GlanceTab
  faceRef?: (el: HTMLElement | null) => void
  face?: WidgetFace
  children: ReactNode
}) {
  return (
    <div ref={faceRef} className={styles.widget} data-glance={tab.kind} data-glance-tab={tab.id} data-face={face}>
      {children}
    </div>
  )
}
