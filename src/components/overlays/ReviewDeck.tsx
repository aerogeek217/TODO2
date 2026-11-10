import { useCallback, useEffect, useId, useMemo, useRef, type RefObject, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useToday } from '../../hooks/use-today'
import { isMacLike } from '../../utils/platform'
import { toggleReviewLens, unrecordedReviewPrompt } from '../../services/review'
import type { LensMark } from '../../hooks/use-widget-lens'
import { useAppliedLens } from '../../stores/screen-filter'
import { allReviewed, followedUpCount, shownMark, unrecordedDraftIds, useReviewStore } from '../../stores/review-store'
import { useStatusUpdateStore } from '../../stores/status-update-store'
import { useSubtaskStore } from '../../stores/subtask-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { isFollowedUpToday } from '../../utils/followup'
import { registerModuleReset } from '../../utils/module-reset'
import { DialogFrame } from '../shared/Dialog'
import { CloseIcon, ReviewIcon } from '../shared/icons'
import { LensSwitch } from '../shared/LensSwitch'
import { ReviewCard } from '../review/ReviewCard'
import { ReviewRail } from '../review/ReviewRail'
import { ReviewSessionContext } from '../review/review-session-context'
import reviewStyles from '../review/Review.module.css'
import styles from './ReviewDeck.module.css'

/**
 * The review deck (D26, board BL): a dialog over the workspace that steps
 * through a frozen set of tasks one card at a time (`review-store`, opened
 * by `services/review.openReview`). `min(1200px, 100vw − 32px)` wide; **its
 * height fits the task** — never under 650px (about the facts column),
 * taller only when a lot is written, up to `100vh − 32px`, where the
 * writing scrolls above its dock. Header: the review tile; who / what is
 * reviewed over a small line (`Review · N open tasks`, then the source's
 * own words where they add to its name — a list's, several people's); then
 * on the right **a dot per task** in the order shown (followed up: accent,
 * filled; skipped: grey, filled; current: an accent ring; to do: hollow —
 * decorative; past `REVIEW_DOTS_MAX` tasks a thin progress bar instead) ·
 * `k of N` (`All N reviewed` once every task has a mark) · `n followed up`
 * (` · m skipped` while any is) · the lens switch (item 10: the standard
 * `LensSwitch` — glasses and `−N` while the top bar's lens hides tasks of
 * this queue, slashed while the review ignores it, absent with no lens; a
 * click takes the queue again from its source with / without the lens,
 * `services/review.toggleReviewLens`) · ×. The queue rail on the left
 * (300px; `components/review/ReviewRail`, shared with the Review widget) has
 * the sort at its top (item 7) and a two-line row per task (the priority
 * ring on the box and the whole title; under it the follow-up and due dates
 * in words and in their colours), a ✓ on a task followed up today — here or
 * anywhere else (its title dimmed) —, – on one skipped here and not followed
 * up today; a click on a row jumps to it. The header's `n followed up`
 * counts the ✓ rows.
 * The card (`components/review/ReviewCard`, shared with the widget) is the
 * task editor's layout (boards BJ, BL, `TaskDetailsBody`): the task's box
 * (it completes the task) and title; then the facts rail — Priority (Focus ·
 * Urgent · Important), Status, People, Tags, Due + repeat and Follow-up last
 * (the Next field — × clears it —, 1w 2w 1m 3m; Last as a date only; no Mark
 * followed up there, the footer's is the one) — beside the writing: Notes
 * and Subtasks above the dock — Status updates oldest first with the deck's
 * update line last (focused as each card opens), in the same place on every
 * card of the same height. Queue, facts and writing read left to right.
 * Footer: a hint of what Mark followed up will do, ‹ Back (K), Skip › (S)
 * and Mark followed up › (⏎). Back and Skip step in the order shown.
 *
 * Every edit is its own undo step, after the notes typed so far; Back and
 * Skip write nothing (a typed update waits for the task's card). Keys,
 * inside the deck: ⏎ in the update line marks followed up, ⏎ in the Next
 * field sets that date, Alt + ← / → go Back / Skip (in the update and Next
 * fields too, except on a Mac, where they move the caret by word; never in
 * the notes editor, whose keys they are), J / K / S outside a text field go
 * next / back / skip, ← / → on a rail row back / skip; Esc closes (an open
 * picker or the editor takes it first) — asking first while a task holds
 * text not recorded yet. It sits on the overlay tier, as the task dialog
 * does, so the pickers and the editor open above it.
 */
export function ReviewDeck() {
  const open = useReviewStore((s) => s.open)
  return open ? <ReviewSessionContext.Provider value={useReviewStore}><ReviewDeckPanel /></ReviewSessionContext.Provider> : null
}

/** The header draws a dot per task up to this many; a longer queue gets a thin progress bar. */
const REVIEW_DOTS_MAX = 20

const editorIsOpen = () => useUIStore.getState().editPopupMode != null

/** Alt + ← / → are the focused field's own: the notes editor's, or (on a Mac) any text field's. */
function altArrowIsTheFields(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement) || !isTextEntry(target)) return false
  return isMacLike() || target.isContentEditable || target.closest('[contenteditable="true"], [contenteditable=""]') !== null
}

/** A key typed into a field (J / K / S are text there). */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target.closest('[contenteditable="true"], [contenteditable=""]')) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (!(target instanceof HTMLInputElement)) return false
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(target.type)
}

function ReviewDeckPanel() {
  const source = useReviewStore((s) => s.source)
  const order = useReviewStore((s) => s.order)
  const index = useReviewStore((s) => s.index)
  const marks = useReviewStore((s) => s.marks)
  const lens = useReviewStore((s) => s.lens)
  const appliedLens = useAppliedLens()
  // The top bar's lens on this queue (item 10), shown as a widget's: while it hides something here, the review ignores it, or the switch was used.
  const lensMark: LensMark | undefined = appliedLens && lens && (lens.ignored || lens.hides > 0 || lens.used)
    ? { name: appliedLens.name, ignored: lens.ignored, hides: lens.hides }
    : undefined
  const todos = useTodoStore((s) => s.todos)
  const editPopupMode = useUIStore((s) => s.editPopupMode)
  const todoById = useMemo(() => new Map(todos.map((t) => [t.id, t])), [todos])
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => { void requestCloseReview(panelRef) }, [])

  // The checklist and the status updates load on demand.
  useEffect(() => {
    void useSubtaskStore.getState().ensureLoaded()
    void useStatusUpdateStore.getState().ensureLoaded()
  }, [])

  // The editor closed: the focus comes back to the card's update line (the next Esc closes the deck).
  const editorWasOpen = useRef(false)
  useEffect(() => {
    if (editPopupMode) {
      editorWasOpen.current = true
    } else if (editorWasOpen.current) {
      editorWasOpen.current = false
      const field = panelRef.current?.querySelector<HTMLInputElement>('[data-review-update]')
      ;(field ?? panelRef.current)?.focus()
    }
  }, [editPopupMode])

  // Alt + ← / → step the cards — before a field's own keys, except where
  // they are the field's: the notes editor's (CodeMirror binds them), and on
  // a Mac any text field's (Option + arrows move by word). Elsewhere a text
  // field has no use for them, and the browser would go back in its history.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const isAltArrow = (e: KeyboardEvent) =>
      e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
    const onKey = (e: KeyboardEvent) => {
      if (!isAltArrow(e) || altArrowIsTheFields(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      const store = useReviewStore.getState()
      if (e.key === 'ArrowLeft') store.back()
      else store.skip()
    }
    // Left to the notes editor and unused there: not the browser's Back either (a Mac's word move stays).
    const afterField = (e: KeyboardEvent) => {
      if (isAltArrow(e) && !e.defaultPrevented && !isMacLike()) e.preventDefault()
    }
    panel.addEventListener('keydown', onKey, true)
    panel.addEventListener('keydown', afterField)
    return () => {
      panel.removeEventListener('keydown', onKey, true)
      panel.removeEventListener('keydown', afterField)
    }
  }, [])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTextEntry(e.target)) return
    const key = e.key.toLowerCase()
    const store = useReviewStore.getState()
    if (key === 'j') store.next()
    else if (key === 'k') store.back()
    else if (key === 's') store.skip()
    else return
    e.preventDefault()
  }

  const n = order.length
  const currentId = order[index]
  const todo = currentId != null ? todoById.get(currentId) : undefined
  const today = useToday()
  // ✓ while the task is followed up today (item 11): an undo takes it away.
  const followedUpToday = useCallback((id: number) => {
    const t = todoById.get(id)
    return t != null && isFollowedUpToday(t, today)
  }, [todoById, today])
  const done = followedUpCount(marks, order, followedUpToday)
  const skipped = order.filter((id) => shownMark(marks, id, followedUpToday) === 'skipped').length
  const finished = allReviewed(marks, order, followedUpToday)
  // Under the title: how many tasks (open ones, unless the source brought completed ones too), then the
  // source's own words where they add to its name (a list's group · sort, several people's names).
  const openCount = order.filter((id) => todoById.get(id)?.isCompleted === false).length
  const taskCountWords = openCount === n
    ? `${n} open ${n === 1 ? 'task' : 'tasks'}`
    : `${n} ${n === 1 ? 'task' : 'tasks'}`
  const sourceWords = source && source.kind !== 'person' && source.kind !== 'tag' ? source.description : ''

  return (
    <DialogFrame
      onClose={close}
      layer="overlay"
      initialFocus="panel"
      escapeBelongsElsewhere={editorIsOpen}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={styles.deck}
      data={{ 'review-deck': '' }}
      panelRef={panelRef}
      onKeyDown={onKeyDown}
    >
      <header className={styles.header}>
        <span className={styles.tile} aria-hidden="true"><ReviewIcon size={15} /></span>
        <div className={styles.heading}>
          <h2 id={titleId} className={styles.title}>{source?.title ?? 'Review'}</h2>
          <span id={descriptionId} className={styles.description} data-testid="review-description" title={sourceWords || undefined}>
            Review · {taskCountWords}{sourceWords && ` · ${sourceWords}`}
          </span>
        </div>
        <span className={styles.spacer} />
        {n > 0 && n <= REVIEW_DOTS_MAX ? (
          // A dot per task, in the order shown. Decorative: the counts beside them say it.
          <span className={styles.dots} aria-hidden="true" data-testid="review-dots">
            {order.map((id, i) => (
              <span key={id} className={styles.dot} data-dot={i === index ? 'current' : shownMark(marks, id, followedUpToday) ?? 'todo'} />
            ))}
          </span>
        ) : n > 0 && (
          <span
            className={styles.progress}
            role="progressbar"
            aria-label="Followed up"
            aria-valuemin={0}
            aria-valuemax={n}
            aria-valuenow={done}
            data-testid="review-progress"
          >
            <span className={styles.progressFill} style={{ width: `${Math.round((done / n) * 100)}%` }} />
          </span>
        )}
        <span className={styles.position} data-testid="review-position" aria-live="polite">
          {finished ? `All ${n} reviewed` : n > 0 ? `${index + 1} of ${n}` : 'Nothing to review'}
        </span>
        <span className={styles.counts}>
          <span data-testid="review-followed-up">{done} followed up</span>
          {skipped > 0 && <span data-testid="review-skipped"> · {skipped} skipped</span>}
        </span>
        {lensMark && <LensSwitch lens={lensMark} noun="review" onToggle={toggleReviewLens} />}
        <button type="button" className={styles.closeBtn} aria-label="Close review" onClick={close}><CloseIcon size={12} /></button>
      </header>
      <ReviewRail todoById={todoById} followedUpToday={followedUpToday} />
      {todo ? (
        <ReviewCard key={todo.id} todo={todo} keyHints />
      ) : (
        <div className={reviewStyles.empty}>
          <p>{lens && !lens.ignored && appliedLens ? `The lens “${appliedLens.name}” hides every task of this review.` : 'Every task of this review was deleted.'}</p>
          <button type="button" className={reviewStyles.secondaryBtn} onClick={close}>Close</button>
        </div>
      )}
    </DialogFrame>
  )
}

/** A close asked while its question is on screen (a second Esc reaches the prompt, not here; × or the backdrop might). */
let askingToClose = false

/**
 * Closes the deck (Esc, ×, the backdrop) — at once, unless a task holds
 * text not recorded yet (its Status update line's, or a date typed in its
 * Next follow-up field and not set): then it asks first. Discard closes,
 * the text gone; Keep reviewing (the default) stays, on a card with text
 * (this one if it has some), the field that holds it focused. Nothing is
 * ever recorded or set on close.
 */
async function requestCloseReview(panelRef: RefObject<HTMLDivElement | null>): Promise<void> {
  if (askingToClose) return
  const { order, drafts, nextDrafts } = useReviewStore.getState()
  const updates = unrecordedDraftIds(drafts, order)
  const nextDates = unrecordedDraftIds(nextDrafts, order)
  if (updates.length === 0 && nextDates.length === 0) {
    useReviewStore.getState().close()
    return
  }
  const titleOf = new Map(useTodoStore.getState().todos.map((t) => [t.id, t.title]))
  const titles = (pending: readonly number[]) => pending.map((id) => titleOf.get(id) ?? 'Untitled task')
  askingToClose = true
  let discard: boolean
  try {
    discard = await useUIStore.getState().askConfirmation({
      ...unrecordedReviewPrompt({ updates: titles(updates), nextDates: titles(nextDates) }),
      confirmLabel: 'Discard',
      cancelLabel: 'Keep reviewing',
      danger: true,
      cancelIsDefault: true,
    })
  } finally {
    askingToClose = false
  }
  const store = useReviewStore.getState()
  if (discard) {
    store.close()
    return
  }
  // Keep reviewing: on a card that holds text (this one if it does), the
  // field that holds it focused once the prompt has gone — the update line
  // first.
  const hasText = (drafts: Readonly<Record<number, string>>, id: number) => (drafts[id] ?? '').trim() !== ''
  const holdsText = (id: number) => hasText(store.drafts, id) || hasText(store.nextDrafts, id)
  const current = store.order[store.index]
  let at = current != null && holdsText(current) ? store.index : store.order.findIndex(holdsText)
  if (at < 0) at = store.index
  store.go(at)
  const target = store.order[at]
  const field = target != null && !hasText(store.drafts, target) && hasText(store.nextDrafts, target) ? '[data-review-next]' : '[data-review-update]'
  window.setTimeout(() => {
    panelRef.current?.querySelector<HTMLInputElement>(field)?.focus()
  }, 0)
}
registerModuleReset(() => { askingToClose = false })
