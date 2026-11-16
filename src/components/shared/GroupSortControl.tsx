import { useEffect, useId, useRef, useState } from 'react'
import type { TodoGroupBy, TodoSortBy, TodoSortDirection } from '../../models/todo-sort-group'
import { AnchoredPicker } from './AnchoredPicker'
import { GroupSortButton } from './GroupSortButton'
import { GroupSortFields } from './ListEditorBody'
import { useTooltip } from './use-tooltip'
import styles from './GroupSortControl.module.css'

/** A grouping, sort and direction. */
interface GroupSortValue {
  grouping: TodoGroupBy
  sort: TodoSortBy
  sortDirection?: TodoSortDirection
}

/** The popover's name (its trigger says `aria-haspopup="dialog"`). */
const GROUP_SORT_LABEL = 'Group and sort'

/** The button's tooltip (and accessible description): what it does, then for which lists and how long. */
const GROUP_SORT_TIP = 'Group and sort these tasks\nEvery task list that opens over the workspace, until a reload'

/**
 * A popup task list's group · sort control: the list's summary button
 * (`GroupSortButton`, `Priority · Due date ▾`) opening Edit list's Group by
 * and Sort by rows (`GroupSortFields`) in a small popover under it
 * (`AnchoredPicker`). Each pick calls `onChange` with the whole value at
 * once; Esc or a press outside closes it, the focus back on the button.
 * What it does is the button's tooltip, and each choice's note its item's
 * (`ChoiceSelect`), as Settings explains its settings.
 */
export function GroupSortControl({ value, onChange, className }: {
  value: GroupSortValue
  onChange: (next: GroupSortValue) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const tip = useTooltip(GROUP_SORT_TIP)
  const tipId = useId()
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
        data-testid="popup-group-sort"
        onClick={() => setOpen((o) => !o)}
        {...tip.triggerProps}
        aria-describedby={tipId}
      />
      <span id={tipId} hidden>{GROUP_SORT_TIP.replace('\n', ': ')}</span>
      {tip.tooltip}
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
