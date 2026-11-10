import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { PersistedTodoItem } from '../../models'
import { useToday } from '../../hooks/use-today'
import { setReviewSort } from '../../services/review-queue'
import { REVIEW_SORTS, reviewSortLabel, shownMark, type ReviewSort } from '../../stores/review-session'
import { useSettingsStore } from '../../stores/settings-store'
import { formatRowDate } from '../../utils/date'
import { markerSummary, type MarkerSummary } from '../../utils/markers'
import { dueState, followupState } from '../../utils/row-date-state'
import { ChevronDownIcon } from '../shared/icons'
import { MenuPopover, type MenuEntry } from '../shared/MenuPopover'
import { PriorityRing } from '../shared/PriorityRing'
import { useReviewSession, useReviewSessionApi } from './review-session-context'
import styles from './Review.module.css'

/**
 * A review's queue rail (D26 — the deck's and the Review widget's): at its
 * top the sort (item 7: `Sort: Queue order ▾` — Queue order, Due, Next
 * follow-up, Last follow-up, Priority, Title; the session's, never saved by
 * the deck), then a row per task in the order shown, reading like list rows
 * — its mark first (✓ followed up today, item 11; – skipped here), the box
 * with the priority ring, the title, the follow-up and due dates in words
 * and their colours. The source's group dividers show in Queue order only.
 * A click on a row jumps to it; ← / → on a row go Back / Skip.
 */
export function ReviewRail({ todoById, followedUpToday, className, label = 'Review queue' }: {
  todoById: ReadonlyMap<number, PersistedTodoItem>
  followedUpToday: (id: number) => boolean
  className?: string
  /** The rail's accessible name. */
  label?: string
}) {
  const session = useReviewSessionApi()
  const ids = useReviewSession((s) => s.ids)
  const order = useReviewSession((s) => s.order)
  const dividers = useReviewSession((s) => s.dividers)
  const sort = useReviewSession((s) => s.sort)
  const index = useReviewSession((s) => s.index)
  const marks = useReviewSession((s) => s.marks)
  const today = useToday()
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const rowDates = useSettingsStore((s) => s.rowDates)
  const listRef = useRef<HTMLOListElement>(null)

  /** The divider before each task (by id: a kept current task in a live queue doesn't shift them) — Queue order only. */
  const dividerBefore = useMemo(() => {
    if (sort !== 'queue') return new Map<number, string>()
    const out = new Map<number, string>()
    for (const d of dividers) {
      const id = ids[d.index]
      if (id != null) out.set(id, d.label)
    }
    return out
  }, [sort, dividers, ids])
  /** Each row's group (the label of the divider before it), for its accessible name. */
  const groupOf = useMemo(() => {
    const out = new Map<number, string>()
    let label: string | null = null
    for (const id of order) {
      label = dividerBefore.get(id) ?? label
      if (label != null) out.set(id, label)
    }
    return out
  }, [order, dividerBefore])

  // The current row stays in view as the review moves on; the focus in the
  // rail (stepping with J / K, ← / → there) moves with it.
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')
    if (!row) return
    if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
    if (listRef.current?.contains(document.activeElement) && document.activeElement !== row) row.focus({ preventScroll: true })
  }, [index, order])

  const onRowKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    if (e.key === 'ArrowLeft') session.getState().back()
    else if (e.key === 'ArrowRight') session.getState().skip()
    else return
    e.preventDefault()
  }

  return (
    <nav className={`${styles.rail} ${className ?? ''}`} aria-label={label} data-review-rail="">
      <ReviewSortControl sort={sort} onSort={(next) => setReviewSort(session, next)} />
      <ol ref={listRef} className={styles.railList}>
        {order.flatMap((id, i) => {
          const todo = todoById.get(id)
          if (!todo) return []
          const label = dividerBefore.get(id)
          const group = groupOf.get(id) ?? null
          const mark = shownMark(marks, id, followedUpToday)
          const current = i === index
          const followup = todo.nextFollowupAt
          const due = todo.dueDate
          const fuText = followup ? formatRowDate(followup, today, rowDates) : ''
          const dueText = due ? formatRowDate(due, today, rowDates) : ''
          const dues = dueState(todo, today, urgentRange)
          const markWords = mark === 'done' ? ', followed up today' : mark === 'skipped' ? ', skipped' : ''
          const row = (
            <li key={id} className={styles.railItem}>
              <button
                type="button"
                className={styles.railRow}
                aria-current={current ? 'true' : undefined}
                aria-label={`${todo.title}${fuText ? `, follow-up ${fuText}` : ''}${dueText ? `, due ${dueText}` : ''}${todo.isCompleted ? ', completed' : ''}${markWords}${group != null ? `, in ${group}` : ''}`}
                data-review-row={id}
                data-mark={mark}
                // A click doesn't take the focus: the card it opens puts it in its update line.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => session.getState().go(i)}
                onKeyDown={onRowKeyDown}
              >
                <span className={styles.railMark} aria-hidden="true">{mark === 'done' ? '✓' : mark === 'skipped' ? '–' : ''}</span>
                <StaticBox summary={markerSummary(todo, today, urgentRange)} completed={todo.isCompleted} />
                <span className={styles.railTitle}>{todo.title}</span>
                <span className={styles.railFollowup} data-followup={followupState(todo, today)} data-marked={mark === 'done' || undefined}>{fuText}</span>
                <span className={styles.railDue} data-due-soon={dues.soon || undefined} data-due-past={dues.past || undefined}>{dueText}</span>
              </button>
            </li>
          )
          return label != null
            // The group is in each row's name (`, in Aisha`); the divider is its picture.
            ? [<li key={`divider-${id}`} className={styles.railDivider} aria-hidden="true">{label}</li>, row]
            : [row]
        })}
      </ol>
    </nav>
  )
}

/** The rail's sort (item 7): `Sort: <name> ▾`, a menu of the sorts (radio rows). */
function ReviewSortControl({ sort, onSort }: { sort: ReviewSort; onSort: (sort: ReviewSort) => void }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const entries: MenuEntry[] = REVIEW_SORTS.map((s) => ({
    kind: 'item',
    label: s.label,
    radio: true,
    checked: s.sort === sort,
    onSelect: () => onSort(s.sort),
  }))
  return (
    <div className={styles.railHead}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.sortButton}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Sort the queue: ${reviewSortLabel(sort)}`}
        data-testid="review-sort"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.sortWord}>Sort:</span> {reviewSortLabel(sort)} <ChevronDownIcon size={11} />
      </button>
      {open && (
        <MenuPopover anchorRef={buttonRef} entries={entries} label="Sort the queue" width={180} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}

/** A rail row's box: the task's priority ring as on its checkbox (read-only), checked once completed. */
function StaticBox({ summary, completed }: { summary: MarkerSummary; completed: boolean }) {
  return (
    <span className={styles.railBox} data-completed={completed || undefined} aria-hidden="true">
      {completed && (
        <svg className={styles.railCheck} viewBox="0 0 16 16" focusable="false">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      )}
      <PriorityRing summary={summary} completed={completed} size={14} />
    </span>
  )
}
