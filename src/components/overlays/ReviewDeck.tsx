import { useCallback, useEffect, type RefObject, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent as ReactChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { STATUS_UPDATE_TEXT_MAX, type Person, type PersistedTodoItem, type RecurrenceType, type Tag, type TodoChanges } from '../../models'
import { NEXT_FOLLOWUP_PLACEHOLDER, useFollowupInput } from '../../hooks/use-followup-input'
import { useToday } from '../../hooks/use-today'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { useSelectAllOnFocus } from '../../hooks/use-select-all-on-focus'
import { isMacLike } from '../../utils/platform'
import { markFollowedUpWithUpdate } from '../../services/mark-followed-up'
import { unrecordedReviewPrompt } from '../../services/review'
import { allReviewed, followedUpCount, shownMark, unrecordedDraftIds, useReviewStore, type ReviewDivider, type ReviewMark } from '../../stores/review-store'
import { usePersonStore } from '../../stores/person-store'
import { autoNextFollowup, useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useStatusUpdateStore } from '../../stores/status-update-store'
import { useSubtaskStore } from '../../stores/subtask-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { formatDateNumeric, formatRowDate, startOfDay } from '../../utils/date'
import {
  addFollowupInterval,
  formatFollowupDate,
  isFollowedUpToday,
  nextAfterFollowup,
  QUICK_FOLLOWUP_INTERVALS,
  relativeDayPhrase,
} from '../../utils/followup'
import { markerSummary, type MarkerSummary } from '../../utils/markers'
import { dueDateChanges, makeRecurrenceRule } from '../../utils/recurrence'
import { dueState, followupState } from '../../utils/row-date-state'
import { statusUpdateText } from '../../utils/status-updates'
import { urgentMark, urgentToggleHint } from '../../utils/urgency'
import { registerModuleReset } from '../../utils/module-reset'
import { DialogFrame } from '../shared/Dialog'
import { FollowupQuickButtons } from '../shared/followup/FollowupQuickButtons'
import { MarkFollowedUpButton } from '../shared/followup/MarkFollowedUpButton'
import { ChevronLeftIcon, ChevronRightIcon } from '../shared/icons'
import { PriorityRing } from '../shared/PriorityRing'
import { useTooltip } from '../shared/use-tooltip'
import { useTaskNotesSource } from '../task/notes/use-task-notes-source'
import { RowCheckbox } from '../task/row-cells'
import { StatusUpdatesSection } from '../task/status-updates/StatusUpdatesSection'
import { SubtasksSection } from '../task/subtasks/SubtasksSection'
import { storedSubtaskMenuEntries } from '../task/subtasks/subtask-menu'
import { DetailsRow, FollowupBlock, TaskDetailsBody, TaskNotesSection } from '../task/TaskDetailsBody'
import { taskLayoutClasses } from '../task/task-layout-classes'
import { TaskEditBadges } from '../task/TaskEditBadges'
import { TaskEditMetadata } from '../task/TaskEditMetadata'
import { useEditorStatusUpdates, useEditorSubtasks } from '../task/use-editor-entries'
import styles from './ReviewDeck.module.css'

/**
 * The review deck (D26): a dialog over the workspace that steps through a
 * frozen set of tasks one card at a time (`review-store`, opened by
 * `services/review.openReview`). Header: Review · the source · what was
 * taken · `k of N` (`All N reviewed` once every task has a mark) · a
 * progress bar · `n followed up` · ×. The queue rail on the left reads like
 * list rows (the priority ring on the box, the follow-up and due dates in
 * words and in their colours), a ✓ on a task followed up here (its new
 * follow-up date in teal), – on a skipped one; a click on a row jumps to it.
 * The card is the task editor's layout (D26 BB, `TaskDetailsBody`): the
 * task's box (it completes the task) and title; the status pill and Focus ·
 * Urgent · Important; Due + repeat, People, Tags; Subtasks | Notes; Status
 * updates oldest first, the deck's update line last (focused as each card
 * opens); the Follow-up group (the Next field, 1w 2w 1m 3m, None; Last as
 * a date only). Footer: a hint of what Mark followed up will do, ‹ Back
 * (K), Skip › (S) and Mark followed up › (⏎).
 *
 * Every edit is its own undo step, after the notes typed so far; Back and
 * Skip write nothing (a typed update waits for the task's card). Keys,
 * inside the deck: ⏎ in the update line marks followed up, ⏎ in the Next
 * field sets that date, Alt + ← / → go Back / Skip (in the update and Next
 * fields too, except on a Mac, where they move the caret by word; never in
 * the notes editor, whose keys they are), J / K / S outside a text field go
 * next / back / skip; Esc closes (an open picker or the editor takes it
 * first) — asking first while a task holds text not recorded yet. It sits on the overlay tier, as the task
 * dialog does, so the pickers and the editor open above it.
 */
export function ReviewDeck() {
  const open = useReviewStore((s) => s.open)
  return open ? <ReviewDeckPanel /> : null
}

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
  const ids = useReviewStore((s) => s.ids)
  const dividers = useReviewStore((s) => s.dividers)
  const index = useReviewStore((s) => s.index)
  const marks = useReviewStore((s) => s.marks)
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
      else skipCurrent()
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
    else if (key === 's') skipCurrent()
    else return
    e.preventDefault()
  }

  const n = ids.length
  const currentId = ids[index]
  const todo = currentId != null ? todoById.get(currentId) : undefined
  const today = useToday()
  // ✓ only while the task is still followed up today: an undo takes it away.
  const followedUpToday = useCallback((id: number) => {
    const t = todoById.get(id)
    return t != null && isFollowedUpToday(t, today)
  }, [todoById, today])
  const done = followedUpCount(marks, ids, followedUpToday)
  const finished = allReviewed(marks, ids, followedUpToday)

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
        <span className={styles.eyebrow}>Review</span>
        <h2 id={titleId} className={styles.title}>{source?.title ?? 'Review'}</h2>
        <span id={descriptionId} className={styles.description}>{source?.description}</span>
        <span className={styles.spacer} />
        <span className={styles.position} data-testid="review-position" aria-live="polite">
          {finished ? `All ${n} reviewed` : n > 0 ? `${index + 1} of ${n}` : 'Nothing to review'}
        </span>
        <span
          className={styles.progress}
          role="progressbar"
          aria-label="Followed up"
          aria-valuemin={0}
          aria-valuemax={n}
          aria-valuenow={done}
        >
          <span className={styles.progressFill} style={{ width: `${n > 0 ? Math.round((done / n) * 100) : 0}%` }} />
        </span>
        <span className={styles.followedUp} data-testid="review-followed-up">{done} followed up</span>
        <button type="button" className={styles.closeBtn} aria-label="Close review" onClick={close}>×</button>
      </header>
      <ReviewRail ids={ids} dividers={dividers} index={index} marks={marks} todoById={todoById} followedUpToday={followedUpToday} />
      {todo ? (
        <ReviewCard key={todo.id} todo={todo} isLast={index === n - 1} />
      ) : (
        <div className={styles.empty}>
          <p>Every task of this review was deleted.</p>
          <button type="button" className={styles.secondaryBtn} onClick={close}>Close</button>
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
  const { ids, drafts, nextDrafts } = useReviewStore.getState()
  const updates = unrecordedDraftIds(drafts, ids)
  const nextDates = unrecordedDraftIds(nextDrafts, ids)
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
  const current = store.ids[store.index]
  let at = current != null && holdsText(current) ? store.index : store.ids.findIndex(holdsText)
  if (at < 0) at = store.index
  store.go(at)
  const target = store.ids[at]
  const field = target != null && !hasText(store.drafts, target) && hasText(store.nextDrafts, target) ? '[data-review-next]' : '[data-review-update]'
  window.setTimeout(() => {
    panelRef.current?.querySelector<HTMLInputElement>(field)?.focus()
  }, 0)
}
registerModuleReset(() => { askingToClose = false })

/** Skip: the current task marked skipped (unless followed up here), then the next card. Writes nothing. */
function skipCurrent() {
  const store = useReviewStore.getState()
  const id = store.ids[store.index]
  if (id != null) store.mark(id, 'skipped')
  store.next()
}

// ── The queue rail ─────────────────────────────────────────────────────────

function ReviewRail({ ids, dividers, index, marks, todoById, followedUpToday }: {
  ids: readonly number[]
  dividers: readonly ReviewDivider[]
  index: number
  marks: Readonly<Record<number, ReviewMark>>
  todoById: ReadonlyMap<number, PersistedTodoItem>
  followedUpToday: (id: number) => boolean
}) {
  const today = useToday()
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const rowDates = useSettingsStore((s) => s.rowDates)
  const listRef = useRef<HTMLOListElement>(null)
  const dividerAt = useMemo(() => new Map(dividers.map((d) => [d.index, d.label])), [dividers])
  /** Each row's group (the label of the divider before it), for its accessible name. */
  const groupAt = useMemo(() => {
    const out: (string | null)[] = []
    for (let i = 0; i < ids.length; i++) out.push(dividerAt.get(i) ?? out[i - 1] ?? null)
    return out
  }, [ids, dividerAt])

  // The current row stays in view as the review moves on; the focus in the
  // rail (stepping with J / K there) moves with it.
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')
    if (!row) return
    if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
    if (listRef.current?.contains(document.activeElement) && document.activeElement !== row) row.focus({ preventScroll: true })
  }, [index])

  return (
    <nav className={styles.rail} aria-label="Review queue" data-review-rail="">
      <ol ref={listRef} className={styles.railList}>
        {ids.flatMap((id, i) => {
          const todo = todoById.get(id)
          const label = dividerAt.get(i)
          const group = groupAt[i] ?? null
          if (!todo) return []
          const mark = shownMark(marks, id, followedUpToday)
          const current = i === index
          const followup = todo.nextFollowupAt
          const due = todo.dueDate
          const fuText = followup ? formatRowDate(followup, today, rowDates) : ''
          const dueText = due ? formatRowDate(due, today, rowDates) : ''
          const dues = dueState(todo, today, urgentRange)
          const markWords = mark === 'done' ? ', followed up' : mark === 'skipped' ? ', skipped' : ''
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
                onClick={() => useReviewStore.getState().go(i)}
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
            ? [<li key={`divider-${i}`} className={styles.railDivider} aria-hidden="true">{label}</li>, row]
            : [row]
        })}
      </ol>
    </nav>
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

// ── The card ───────────────────────────────────────────────────────────────

/** Same day, or both none. */
function sameDay(a: Date | null, b: Date | null): boolean {
  return (a ? startOfDay(a).getTime() : null) === (b ? startOfDay(b).getTime() : null)
}

const NO_PEOPLE: Person[] = []
const NO_TAGS: Tag[] = []

/**
 * The card: the task editor's layout (D26 BB, the shared `TaskDetailsBody`)
 * for one task, every edit written at once, each its own undo step after
 * the notes typed so far — the box and title; the status pill and the
 * Focus · Urgent · Important toggles; Due + repeat, People, Tags; Subtasks |
 * Notes; Status updates (oldest first) with the deck's update line last;
 * the Follow-up group (Next — the field Mark followed up reads —, Last as
 * a date only). One task only, never the selection.
 */
function ReviewCard({ todo, isLast }: { todo: PersistedTodoItem; isLast: boolean }) {
  const todoId = todo.id
  const today = useToday()
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const autoFollowup = useSettingsStore((s) => s.autoFollowup)
  const followupDefaultInterval = useSettingsStore((s) => s.followupDefaultInterval)
  const statuses = useStatusStore((s) => s.statuses)
  const allPeople = usePersonStore((s) => s.people)
  const assignedPeople = usePersonStore((s) => s.assignedPeopleMap.get(todoId)) ?? NO_PEOPLE
  const allTags = useTagStore((s) => s.tags)
  const assignedTags = useTagStore((s) => s.assignedTagsMap.get(todoId)) ?? NO_TAGS
  const draft = useReviewStore((s) => s.drafts[todoId] ?? '')
  const selectOnFocus = useSelectAllOnFocus()
  const uid = useId()
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Notes: one edit session, written before any other write to the task.
  const notes = useTaskNotesSource({ todoId })
  const flushNotes = notes.flush
  const entryOptions = { isEdit: true, todoId, flushNotes }
  const subtasks = useEditorSubtasks(entryOptions, undefined)
  const updates = useEditorStatusUpdates(entryOptions, undefined)
  /** `run` after the notes typed so far (each edit its own undo step, in order). */
  const afterNotes = (run: () => unknown) => { void flushNotes().finally(run) }
  const update = (changes: TodoChanges) => afterNotes(() => useTodoStore.getState().update(todoId, changes))

  const updateRef = useRef<HTMLInputElement>(null)
  const nextRef = useRef<HTMLInputElement>(null)

  // Each card opens with the focus in its Status update line — unless the
  // keyboard is stepping through the rail (the focus stays there).
  useLayoutEffect(() => {
    if (document.activeElement?.closest('[data-review-rail]')) return
    const line = updateRef.current
    line?.focus({ preventScroll: true })
    // In view inside the card's body (a long checklist or log can push it below the fold); the deck itself stays put.
    if (line && typeof line.scrollIntoView === 'function') line.scrollIntoView({ block: 'nearest' })
  }, [])

  // ── Follow-up: the Next field starts on what Mark followed up would leave (the popover's rule).
  const proposal = autoNextFollowup(today, { autoFollowup, followupDefaultInterval })
  const current = todo.nextFollowupAt ?? null
  const ruled = nextAfterFollowup(current, today, proposal)
  const input = useFollowupInput(ruled ?? undefined, 'next', today)
  // A date typed and not set yet is kept for the task (Back brings it back; a close asks over it).
  const typeNext = (text: string) => {
    input.change(text)
    useReviewStore.getState().setNextDraft(todoId, text.trim() === '' ? null : text)
  }
  const settleNext = (date: Date | null) => {
    if (date) input.settle(date)
    else input.change('')
    useReviewStore.getState().setNextDraft(todoId, null)
  }
  // Coming back to the card: the date typed before, as typed.
  const inputLatest = useLatestRef(input)
  useLayoutEffect(() => {
    const typed = useReviewStore.getState().nextDrafts[todoId]
    if (typed != null) inputLatest.current.change(typed)
  }, [todoId, inputLatest])
  const s = input.state
  const untouched = s.kind === 'unchanged'
  const fieldDate: Date | null | 'invalid' =
    untouched ? ruled : s.kind === 'empty' ? null : s.kind === 'valid' ? s.date : 'invalid'
  const hasUpdate = statusUpdateText(draft) !== ''
  const doneToday = isFollowedUpToday(todo, today)

  const setNext = (date: Date | null) => update({ nextFollowupAt: date ?? undefined })
  /** A date for the next follow-up (⏎ in the field, a quick button): set now, the field showing it; then on to the update line. */
  const apply = (date: Date | null) => {
    setNext(date)
    settleNext(date)
    updateRef.current?.focus()
  }
  /** None: no next follow-up, at once; the field stays empty (Mark followed up then leaves none). */
  const clearNext = () => {
    settleNext(null)
    if (current !== null) setNext(null)
  }
  const onNextKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (e.repeat || fieldDate === 'invalid') return
    if (!sameDay(fieldDate, current)) apply(fieldDate)
    else updateRef.current?.focus()
  }

  /**
   * Mark followed up: the notes first, then the follow-up (with the update
   * line's text: one undo step); the next card opens at once. Once the
   * follow-up is written the task is marked ✓ and its typed text cleared —
   * a write that fails leaves both, the text there to try again.
   */
  const followUp = () => {
    if (fieldDate === 'invalid') return
    const options = untouched ? {} : { next: fieldDate }
    const text = draft
    const nextText = useReviewStore.getState().nextDrafts[todoId]
    const before = useTodoStore.getState().todos.find((t) => t.id === todoId)?.lastFollowupAt?.getTime()
    afterNotes(async () => {
      try {
        await markFollowedUpWithUpdate([todoId], options, text)
      } catch (err: unknown) {
        console.error('[review] the follow-up could not be recorded', err)
        return
      }
      // Written: the task's last follow-up moved (a failed write leaves it, and says so itself).
      const after = useTodoStore.getState().todos.find((t) => t.id === todoId)?.lastFollowupAt?.getTime()
      if (after == null || after === before) return
      const store = useReviewStore.getState()
      store.mark(todoId, 'done')
      // Only the text that was sent: what was typed since stays.
      if ((store.drafts[todoId] ?? '') === text) store.setDraft(todoId, '')
      if (store.nextDrafts[todoId] === nextText) store.setNextDraft(todoId, null)
    })
    if (isLast) {
      // The last card stays: it shows what it wrote.
      if (!untouched && fieldDate) input.settle(fieldDate)
      updateRef.current?.focus()
    }
    useReviewStore.getState().next()
  }

  const toggleComplete = () => {
    const shownCompleted = todo.isCompleted
    afterNotes(() => {
      const stored = useTodoStore.getState().todos.find((t) => t.id === todoId)
      if (stored && stored.isCompleted === shownCompleted) return useTodoStore.getState().toggleComplete(todoId)
    })
  }

  // ── The badges: the status and the marker toggles (each its own undo step).
  const summary = markerSummary(todo, today, urgentRange)
  const urgentSubject = { urgent: todo.urgent === true, dueDate: todo.dueDate, isCompleted: todo.isCompleted }
  const urgentState = urgentMark(urgentSubject, today, urgentRange)
  const urgentHint = urgentToggleHint([urgentSubject], today, urgentRange)

  // ── The fields: due + repeat, people, tags.
  const recurrenceType = todo.recurrenceRule?.type ?? ''
  const onRecurrenceChange = (e: ReactChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as RecurrenceType | ''
    update({ recurrenceRule: val && todo.dueDate ? makeRecurrenceRule(val, todo.dueDate) : undefined })
  }
  const togglePerson = (personId: number) => afterNotes(() => {
    const store = usePersonStore.getState()
    const assigned = (store.assignedPeopleMap.get(todoId) ?? []).some((p) => p.id === personId)
    return assigned ? store.unassignPerson(todoId, personId) : store.assignPerson(todoId, personId)
  })
  const toggleTag = (tagId: number) => afterNotes(() => {
    const store = useTagStore.getState()
    const assigned = (store.assignedTagsMap.get(todoId) ?? []).some((t) => t.id === tagId)
    return assigned ? store.unassignTag(todoId, tagId) : store.assignTag(todoId, tagId)
  })
  const createPerson = async (name: string) => {
    const id = await usePersonStore.getState().getOrCreate(name)
    afterNotes(() => usePersonStore.getState().assignPerson(todoId, id))
  }
  const createTag = async (name: string) => {
    const id = await useTagStore.getState().add(name)
    afterNotes(() => useTagStore.getState().assignTag(todoId, id))
  }

  const lastLate = followupState(todo, today) === 'late'
  const last = todo.lastFollowupAt

  const nextWords = fieldDate === 'invalid'
    ? 'Fix the next follow-up date'
    : fieldDate ? `next ${formatFollowupDate(fieldDate, today)}` : 'no next follow-up'
  // What Mark followed up will do, as the follow-up popover's tooltip says it.
  const kept = untouched && current !== null && ruled === current
  const followUpWords = kept
    ? 'Record a follow-up today and keep the next follow-up'
    : fieldDate === null
      ? (current === null ? 'Record a follow-up today (no next follow-up)' : 'Record a follow-up today and clear the next follow-up')
      : 'Record a follow-up today and set the next follow-up to the date in the field'
  const { triggerProps: followUpTipProps, tooltip: followUpTip } = useTooltip(
    followUpWords + (hasUpdate ? ', and add the status update' : ''),
  )
  const hint = hasUpdate ? `With the update · ${nextWords}` : nextWords.charAt(0).toUpperCase() + nextWords.slice(1)

  return (
    <>
      <div className={styles.card} data-review-card={todoId}>
        <div className={styles.cardTop}>
          <div className={styles.cardBox}>
            <RowCheckbox
              summary={summary}
              checked={todo.isCompleted}
              onChange={toggleComplete}
              aria-label={todo.isCompleted ? 'Mark incomplete' : 'Mark complete'}
            />
          </div>
          <h3 className={`${styles.cardTitle} ${todo.isCompleted ? styles.cardTitleDone : ''}`} data-testid="review-card-title">{todo.title}</h3>
        </div>
        <TaskEditBadges
          statuses={statuses}
          statusId={todo.statusId}
          onStatusChange={(statusId) => update({ statusId })}
          focusOn={todo.focus === true}
          urgentOn={todo.urgent === true}
          importantOn={todo.important === true}
          urgentState={urgentState}
          urgentHint={urgentHint}
          onToggleFocus={() => afterNotes(() => useTodoStore.getState().bulkSetFocus([todoId], todo.focus !== true))}
          onToggleUrgent={() => afterNotes(() => useTodoStore.getState().bulkSetUrgent([todoId], todo.urgent !== true))}
          onToggleImportant={() => afterNotes(() => useTodoStore.getState().bulkSetImportant([todoId], todo.important !== true))}
        />
        <TaskDetailsBody
          dropdownOpen={dropdownOpen}
          fields={(
            <TaskEditMetadata
              deadline={todo.dueDate ?? null}
              recurrenceType={recurrenceType}
              onDeadlineChange={(next) => update(dueDateChanges(next, todo.recurrenceRule?.type))}
              onRecurrenceChange={onRecurrenceChange}
              assignedPeople={assignedPeople}
              assignedTags={assignedTags}
              allPeople={allPeople}
              allTags={allTags}
              onTogglePerson={togglePerson}
              onToggleTag={toggleTag}
              onCreatePerson={createPerson}
              onCreateTag={createTag}
              onDropdownChange={setDropdownOpen}
            />
          )}
          subtasks={(
            <SubtasksSection
              items={subtasks.items}
              onAdd={subtasks.add}
              onRename={subtasks.rename}
              onSetDone={subtasks.setDone}
              onRemove={subtasks.remove}
              onMove={subtasks.move}
              extraMenuEntries={storedSubtaskMenuEntries}
              className={taskLayoutClasses.pairSection}
              labelClassName={taskLayoutClasses.label}
            />
          )}
          notes={<TaskNotesSection source={notes.source} subtaskTarget={subtasks.noteTarget} />}
          statusUpdates={(
            <StatusUpdatesSection
              entries={updates.entries}
              onAdd={updates.add}
              onEdit={updates.edit}
              onRemove={updates.remove}
              className={taskLayoutClasses.updatesSection}
              labelClassName={taskLayoutClasses.label}
              addLine={(
                <input
                  id={`${uid}-update`}
                  ref={updateRef}
                  className={styles.updateInput}
                  value={draft}
                  maxLength={STATUS_UPDATE_TEXT_MAX}
                  placeholder="What’s the latest?"
                  aria-label="Status update · today"
                  autoComplete="off"
                  data-review-update=""
                  onChange={(e) => useReviewStore.getState().setDraft(todoId, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                    e.preventDefault()
                    if (!e.repeat) followUp()
                  }}
                />
              )}
            />
          )}
          followup={(
            <FollowupBlock>
              <DetailsRow label="Next">
                <input
                  id={`${uid}-next`}
                  ref={nextRef}
                  aria-label="Next follow-up"
                  className={`${styles.nextInput} ${s.kind === 'invalid' ? styles.nextInputError : ''}`}
                  value={input.text}
                  placeholder={NEXT_FOLLOWUP_PLACEHOLDER}
                  onChange={(e) => typeNext(e.target.value)}
                  {...selectOnFocus}
                  data-review-next=""
                  onKeyDown={onNextKeyDown}
                  aria-invalid={s.kind === 'invalid'}
                  aria-describedby={`${uid}-next-help`}
                  autoComplete="off"
                  spellCheck={false}
                />
                <span id={`${uid}-next-help`} className={styles.help} aria-live="polite">
                  {s.kind === 'valid' && <>→ {formatFollowupDate(s.date, today)} · {relativeDayPhrase(s.date, today)} · ⏎ to set</>}
                  {s.kind === 'invalid' && <span className={styles.helpError}>{s.message}</span>}
                  {s.kind === 'empty' && (current !== null ? 'No next follow-up · ⏎ to clear' : 'No next follow-up')}
                </span>
                <FollowupQuickButtons
                  intervals={QUICK_FOLLOWUP_INTERVALS}
                  labelStyle="short"
                  onPick={(i) => apply(addFollowupInterval(today, i))}
                />
                <button type="button" className={styles.noneBtn} aria-label="No next follow-up" onClick={clearNext}>None</button>
              </DetailsRow>
              <DetailsRow label="Last">
                <span className={styles.lastValue} data-late={lastLate || undefined} data-testid="review-last-followup">
                  {last ? `${formatDateNumeric(last)} · ${relativeDayPhrase(last, today)}` : 'Never followed up'}
                </span>
              </DetailsRow>
            </FollowupBlock>
          )}
        />
      </div>
      <footer className={styles.footer}>
        <span className={styles.spacer} />
        <span className={styles.hint} data-testid="review-hint">{hint}</span>
        <button type="button" className={styles.secondaryBtn} aria-keyshortcuts="K Alt+ArrowLeft" onClick={() => useReviewStore.getState().back()}>
          <ChevronLeftIcon /> Back <kbd className={styles.key} aria-hidden="true">K</kbd>
        </button>
        <button type="button" className={styles.secondaryBtn} aria-keyshortcuts="S Alt+ArrowRight" onClick={skipCurrent}>
          Skip <ChevronRightIcon /> <kbd className={styles.key} aria-hidden="true">S</kbd>
        </button>
        <MarkFollowedUpButton
          className={styles.markBtn}
          doneToday={doneToday}
          dimmed={doneToday && !hasUpdate}
          disabled={fieldDate === 'invalid'}
          {...followUpTipProps}
          adornment={<><ChevronRightIcon /> ⏎</>}
          onClick={followUp}
        />
        {followUpTip}
      </footer>
    </>
  )
}
