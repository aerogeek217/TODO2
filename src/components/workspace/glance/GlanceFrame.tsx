import { useContext, type ReactNode } from 'react'
import { lensHidesFor, useLensHidden } from '../../../hooks/use-glance-data'
import type { GlanceTab, NumberTab } from '../../../models/workspace-layout'
import type { WidgetFace } from '../../../utils/widget-face'
import { CellControlsContext } from '../cell-controls'
import { TabLensSwitch } from '../LensSwitch'
import styles from './GlanceWidget.module.css'

/**
 * A glance widget's frame: fills its cell, the section (or the Number)
 * inside it. `faceRef` measures the face (`useWidgetFace`). A Number's
 * lens switch (G3) sits in its top-right corner, before the cell's ⋯ — its
 * label is inside its button, which can't hold one.
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
      {tab.kind === 'number' && tab.config.show !== 'list' && <NumberLensCorner tab={tab} />}
    </div>
  )
}

/** A Number's lens switch, over its top-right corner (left of the cell's floating ⋯ while it is alone in its cell). */
function NumberLensCorner({ tab }: { tab: NumberTab }) {
  const alone = useContext(CellControlsContext) != null
  const config = tab.config
  const filters = config.show === 'group' ? (config.items ?? []).map((i) => i.filter) : [config.filter]
  const hides = lensHidesFor(useLensHidden(), ...filters)
  return (
    <span className={`${styles.lensCorner} ${alone ? styles.lensCornerAlone : ''}`}>
      <TabLensSwitch tab={tab} hides={hides} />
    </span>
  )
}
