import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { PersistedTodoItem } from '../../models'
import { AnchoredPicker } from '../shared/AnchoredPicker'
import { useTooltip } from '../shared/use-tooltip'
import { ReviewRail } from './ReviewRail'
import styles from './Review.module.css'

/**
 * **Queue ▾** while the review's queue is folded away (task layout A: a
 * Review widget under 820px wide): a button that opens the queue — `ReviewRail`, with its sort — in a popover under it
 * (`AnchoredPicker` over `PopoverRoot`: level 1 in a cell, level 2 in the
 * small face's popover). Picking a row goes to it and closes the popover; Esc or a press
 * outside closes it. ‹ Back and Skip › in the footer still step.
 */
export function ReviewQueueButton({ todoById, followedUpToday, label, className, onToggleComplete }: {
  todoById: ReadonlyMap<number, PersistedTodoItem>
  followedUpToday: (id: number) => boolean
  /** The queue's accessible name (the rail's). */
  label: string
  className?: string
  /** The rail's: a row's box checked or unchecked (the popover stays open). */
  onToggleComplete?: (id: number) => void
}) {
  const [open, setOpen] = useState(false)
  const { triggerProps: tipProps, tooltip } = useTooltip('Show the review queue')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // Open, the focus goes to the current row (← / → step there; Esc is the popover's, not a layer's
  // under it — the small face's popover); closed with it inside, back to the button.
  useEffect(() => {
    if (!open) return
    const popover = popoverRef.current
    const button = buttonRef.current
    const row = popover?.querySelector<HTMLElement>('[aria-current="true"]') ?? popover?.querySelector<HTMLElement>('[data-review-row]')
    row?.focus({ preventScroll: true })
    return () => {
      const active = document.activeElement
      if (active == null || active === document.body || popover?.contains(active)) button?.focus({ preventScroll: true })
    }
  }, [open])
  // A row picked: the card it opens takes over.
  const onClick = (e: ReactMouseEvent) => {
    if (e.target instanceof Element && e.target.closest('[data-review-row]')) setOpen(false)
  }
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.queueButton} ${className ?? ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        // The word alone: the style's ▾ (generated content) would join the name.
        aria-label="Queue"
        data-review-queue-button=""
        {...tipProps}
        onClick={() => setOpen((o) => !o)}
      >
        Queue
      </button>
      {tooltip}
      {open && (
        <AnchoredPicker anchorRef={buttonRef} onClose={() => setOpen(false)} closeOnEscape>
          {/* Not a menu: a list of rows to pick from, with its sort. */}
          <div ref={popoverRef} className={styles.queuePopover} onClick={onClick} data-review-queue-popover="">
            <ReviewRail todoById={todoById} followedUpToday={followedUpToday} className={styles.queuePopoverRail} label={label} onToggleComplete={onToggleComplete} />
          </div>
        </AnchoredPicker>
      )}
    </>
  )
}
