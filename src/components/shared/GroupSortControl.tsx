import { useEffect, useRef, useState } from 'react'
import type { TodoGroupBy, TodoSortBy, TodoSortDirection } from '../../models/todo-sort-group'
import { AnchoredPicker } from './AnchoredPicker'
import { GroupSortButton } from './GroupSortButton'
import { GroupSortFields } from './ListEditorBody'
import styles from './GroupSortControl.module.css'

/** A grouping, sort and direction. */
interface GroupSortValue {
  grouping: TodoGroupBy
  sort: TodoSortBy
  sortDirection?: TodoSortDirection
}

/** The popover's name (its trigger says `aria-haspopup="dialog"`). */
const GROUP_SORT_LABEL = 'Group and sort'

/**
 * A popup task list's group · sort control: the list's summary button
 * (`GroupSortButton`, `Priority · Due date ▾`) opening Edit list's Group by
 * and Sort by rows (`GroupSortFields`) in a small popover under it
 * (`AnchoredPicker`). Each pick calls `onChange` with the whole value at
 * once; Esc or a press outside closes it, the focus back on the button.
 */
export function GroupSortControl({ value, onChange, className }: {
  value: GroupSortValue
  onChange: (next: GroupSortValue) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // Open, the focus goes to Group by; closed with it inside, back to the button.
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
  return (
    <>
      <GroupSortButton
        ref={buttonRef}
        grouping={value.grouping}
        sort={value.sort}
        sortDirection={value.sortDirection}
        open={open}
        className={className}
        aria-haspopup="dialog"
        title="Group and sort these tasks (every task list that opens over the workspace, until a reload)"
        data-testid="popup-group-sort"
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <AnchoredPicker anchorRef={buttonRef} onClose={() => setOpen(false)} closeOnEscape dialogLabel={GROUP_SORT_LABEL}>
          <div ref={popoverRef} className={styles.popover} data-popup-group-sort="">
            <GroupSortFields value={value} onChange={onChange} />
          </div>
        </AnchoredPicker>
      )}
    </>
  )
}
