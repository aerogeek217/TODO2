import { useEffect, useRef, useState } from 'react'
import { PLANNER_UNPLANNED_SORTS, type PlannerUnplannedSort } from '../../../models/workspace-layout'
import type { TodoSortBy, TodoSortDirection } from '../../../models/todo-sort-group'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { sortSummary } from '../../../utils/list-options'
import { AnchoredPicker } from '../../shared/AnchoredPicker'
import { GroupSortButton } from '../../shared/GroupSortButton'
import { SortFields } from '../../shared/ListEditorBody'
import popoverStyles from '../../shared/GroupSortControl.module.css'
import styles from './PlannerWidget.module.css'

/** The popover's name (its trigger says `aria-haspopup="dialog"`). */
const SORT_LABEL = 'Sort Unplanned'

/** The config's sort as Sort by edits it: absent, manual. */
function sortValue(sort: PlannerUnplannedSort | undefined): { sort: TodoSortBy; sortDirection?: TodoSortDirection } {
  return { sort: sort?.by ?? 'manual', ...(sort?.direction ? { sortDirection: sort.direction } : {}) }
}

/**
 * Unplanned's sort at the end of its filter line: the sort as a list's line
 * shows it (`GroupSortButton`: `Manual ▾`, `Due ↓ ▾`), opening Edit list's
 * Sort by row (`SortFields`, the sorts `PLANNER_UNPLANNED_SORTS` offers) in
 * a small popover under it. Each pick is written at once, one undo step
 * (`Sorted Unplanned by Due`): layout config, `config.unplannedSort`.
 */
export function PlannerSortControl({ tabId, sort }: { tabId: string; sort: PlannerUnplannedSort | undefined }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const value = sortValue(sort)
  // Open, the focus goes to Sort by; closed with it inside, back to the button.
  useEffect(() => {
    if (!open) return
    const popover = popoverRef.current
    const button = buttonRef.current
    popover?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
    return () => {
      const active = document.activeElement
      if (active == null || active === document.body || popover?.contains(active)) button?.focus({ preventScroll: true })
    }
  }, [open])
  const pick = (next: { sort: TodoSortBy; sortDirection?: TodoSortDirection }) => {
    if (next.sort === value.sort && next.sortDirection === value.sortDirection) return
    const unplannedSort: PlannerUnplannedSort = { by: next.sort, ...(next.sortDirection === 'desc' ? { direction: 'desc' as const } : {}) }
    useWorkspaceStore.getState().patchTabConfig(tabId, 'planner', { unplannedSort }, `Sorted Unplanned by ${sortSummary(next.sort, next.sortDirection)}`)
  }
  return (
    <>
      <GroupSortButton
        ref={buttonRef}
        grouping="none"
        sort={value.sort}
        sortDirection={value.sortDirection}
        open={open}
        className={styles.sort}
        aria-haspopup="dialog"
        aria-label={`Unplanned sort: ${sortSummary(value.sort, value.sortDirection)}`}
        data-tooltip="Sort Unplanned"
        data-planner-sort={tabId}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <AnchoredPicker anchorRef={buttonRef} onClose={() => setOpen(false)} closeOnEscape dialogLabel={SORT_LABEL}>
          <div ref={popoverRef} className={popoverStyles.popover} data-planner-sort-popover="">
            <SortFields value={value} choices={PLANNER_UNPLANNED_SORTS} onChange={pick} />
          </div>
        </AnchoredPicker>
      )}
    </>
  )
}
