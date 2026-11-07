import type { CSSProperties, MouseEvent, RefObject } from 'react'
import { describeSubtaskCount, formatSubtaskCount, type SubtaskCount } from '../../../utils/subtasks'
import styles from './Subtasks.module.css'

/**
 * The count's pie (D25 D2): a 12px ring filled by the share done, in the
 * count's colour — the accent once every subtask is done.
 */
function SubtaskPie({ count }: { count: SubtaskCount }) {
  const share = count.total > 0 ? Math.round((count.done / count.total) * 100) : 0
  return (
    <span
      className={styles.pie}
      style={{ '--subtask-share': `${share}%` } as CSSProperties}
      data-subtask-pie={share}
      aria-hidden="true"
    />
  )
}

/**
 * The `2/5` after a row's title (cr28, T2), its pie before it (D25 D2):
 * muted like the rest of a quiet row, the accent when every subtask is done,
 * the open-trigger ring while its popover is open. A click opens the checklist popover (the first click
 * of a run only, so a double-click opens it once); it is a row cell, so the
 * row's double-click leaves it alone.
 */
export function SubtaskCountButton({ count, open, buttonRef, onClick }: {
  count: SubtaskCount
  open: boolean
  buttonRef: RefObject<HTMLButtonElement | null>
  onClick: (e: MouseEvent) => void
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={styles.count}
      data-row-cell="subtasks"
      data-subtask-count=""
      data-open={open ? '' : undefined}
      data-all-done={count.total > 0 && count.done === count.total ? '' : undefined}
      aria-label={`${describeSubtaskCount(count)}, show them`}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation()
        if (e.detail > 1) return
        onClick(e)
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <SubtaskPie count={count} />
      {formatSubtaskCount(count)}
    </button>
  )
}

/** The count as the drag overlay's copy of a row shows it: nothing to press. */
export function SubtaskCountStatic({ count }: { count: SubtaskCount }) {
  return (
    <span
      className={styles.count}
      data-subtask-count=""
      data-all-done={count.total > 0 && count.done === count.total ? '' : undefined}
      aria-label={describeSubtaskCount(count)}
    >
      <SubtaskPie count={count} />
      {formatSubtaskCount(count)}
    </span>
  )
}
