import { useLayoutEffect, useRef } from 'react'
import { useToday } from '../../../hooks/use-today'
import { usePlannerStore } from '../../../stores/planner-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { PLANNER_UNPLANNED_KEY, plannerDropLabel } from '../../../utils/planner'
import { getTab } from '../../../utils/workspace-layout-queries'
import styles from './PlannerWidget.module.css'

/** A row moved within a sorted Unplanned: the drop switches it to manual. */
const MANUAL_ORDER_LABEL = 'Manual order'

/** The room the label takes under the lifted row, px: its gap and height (`.dragLabel`). */
const LABEL_ROOM_PX = 26

/**
 * The label a dragged task carries over a Planner, under the lifted row
 * (the page's drag overlay): what a drop there would do to its plan —
 * `Plan · Wed, Nov 25`, `Unplan`, or `Its date · Wed, Nov 25` when the drop
 * clears the plan on its own date's day (`utils/planner.plannerDropLabel`,
 * from `stores/planner-store`'s drag preview), or `Manual order` for a row
 * moved within an Unplanned the tab sorts (the drop switches it to manual,
 * `services/planner-drop`) — in one neutral color: no
 * real date changes. Nothing while the drag is
 * over no Planner target, or over one that would refuse the drop or change
 * nothing. Where it would leave the window at the bottom it sits above the
 * row (`data-above`, set as the pointer moves: the overlay moves without a
 * render of this).
 */
export function PlannerDragLabel() {
  const drop = usePlannerStore((s) => s.drag?.drop ?? null)
  const reorderIn = usePlannerStore((s) => (s.drag?.over === 'group' && s.drag.key === PLANNER_UNPLANNED_KEY && s.drag.drop.kind === 'none' && s.drag.index != null ? s.drag.tabId : null))
  const sorted = useWorkspaceStore((s) => {
    const tab = reorderIn != null && s.working ? getTab(s.working, reorderIn) : undefined
    const by = tab?.kind === 'planner' ? tab.config.unplannedSort?.by : undefined
    return by != null && by !== 'manual'
  })
  const today = useToday()
  const label = sorted ? MANUAL_ORDER_LABEL : drop ? plannerDropLabel(drop, today) : null
  const ref = useRef<HTMLSpanElement>(null)
  const shown = label != null
  useLayoutEffect(() => {
    const el = ref.current
    if (!shown || !el) return
    const place = () => {
      const row = el.parentElement?.getBoundingClientRect()
      if (row) el.toggleAttribute('data-above', row.bottom + LABEL_ROOM_PX > window.innerHeight)
    }
    place()
    window.addEventListener('pointermove', place)
    return () => window.removeEventListener('pointermove', place)
  }, [shown])
  if (!label) return null
  return <span ref={ref} className={styles.dragLabel} data-testid="planner-drag-label">{label}</span>
}
