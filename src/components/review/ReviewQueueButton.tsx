import { useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { PersistedTodoItem } from '../../models'
import { AnchoredPicker } from '../shared/AnchoredPicker'
import { ReviewRail } from './ReviewRail'
import styles from './Review.module.css'

/**
 * The review's progress (`3 of 12`) while its queue is folded away (task
 * layout A: a Review widget or the deck under 820px wide): a button that
 * opens the queue — `ReviewRail`, with its sort — in a popover under it
 * (`AnchoredPicker` over `PopoverRoot`: level 1 in a cell, level 2 in the
 * deck). Picking a row goes to it and closes the popover; Esc or a press
 * outside closes it. ‹ Back and Skip › in the footer still step.
 */
export function ReviewQueueButton({ todoById, followedUpToday, label, words, className, children }: {
  todoById: ReadonlyMap<number, PersistedTodoItem>
  followedUpToday: (id: number) => boolean
  /** The queue's accessible name (the rail's). */
  label: string
  /** The progress in words (`3 of 12`), for the button's name. */
  words: string
  className?: string
  /** The progress as drawn. */
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
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
        aria-label={`${words} · show the queue`}
        data-review-queue-button=""
        onClick={() => setOpen((o) => !o)}
      >
        {children}
      </button>
      {open && (
        <AnchoredPicker anchorRef={buttonRef} onClose={() => setOpen(false)} closeOnEscape>
          {/* Not a menu: a list of rows to pick from, with its sort. */}
          <div className={styles.queuePopover} onClick={onClick} data-review-queue-popover="">
            <ReviewRail todoById={todoById} followedUpToday={followedUpToday} className={styles.queuePopoverRail} label={label} />
          </div>
        </AnchoredPicker>
      )}
    </>
  )
}
