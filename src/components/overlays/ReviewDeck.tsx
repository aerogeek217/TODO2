import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { DEFAULT_STATUS_ICON, STATUS_UPDATE_TEXT_MAX, type PersistedTodoItem } from '../../models'
import { NEXT_FOLLOWUP_PLACEHOLDER, useFollowupInput } from '../../hooks/use-followup-input'
import { useToday } from '../../hooks/use-today'
import { markFollowedUpWithUpdate } from '../../services/mark-followed-up'
import { allReviewed, followedUpCount, useReviewStore, type ReviewDivider, type ReviewMark } from '../../stores/review-store'
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
import { MARKER_LABELS, markerSummary, type MarkerSummary } from '../../utils/markers'
import { dueDateChanges } from '../../utils/recurrence'
import { dueState, followupState } from '../../utils/row-date-state'
import { statusUpdateText } from '../../utils/status-updates'
import { AnchoredPicker } from '../shared/AnchoredPicker'
import { DeadlinePicker } from '../shared/DeadlinePicker'
import { DialogFrame } from '../shared/Dialog'
import { FollowupQuickButtons } from '../shared/followup/FollowupQuickButtons'
import { MarkFollowedUpButton } from '../shared/followup/MarkFollowedUpButton'
import { ChecklistIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, NotesIcon } from '../shared/icons'
import { PriorityRing } from '../shared/PriorityRing'
import { StatusIcon } from '../shared/StatusIcon'
import { useTooltip } from '../shared/use-tooltip'
import { NotesBody } from '../task/notes/NotesBody'
import { useTaskNotesSource } from '../task/notes/use-task-notes-source'
import { RowCheckbox, StatusMenu } from '../task/row-cells'
import { StatusUpdatesSection } from '../task/status-updates/StatusUpdatesSection'
import { SubtaskChecklist } from '../task/subtasks/SubtaskChecklist'
import { storedSubtaskMenuEntries } from '../task/subtasks/subtask-menu'
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
 * The card: the task's box (it completes the task) and title; its status,
 * due date, priority and tags; Notes and the checklist; the Status update
 * line (focused as each card opens) over the recent updates; the follow-up
 * strip (Last followed up, the Next follow-up field, 1w 2w 1m 3m, None).
 * Footer: Open in editor (it stacks over the deck), a hint of what Mark
 * followed up will do, ‹ Back (K), Skip › (S) and Mark followed up › (⏎).
 *
 * Every edit is its own undo step, after the notes typed so far; Back and
 * Skip write nothing (a typed update waits for the task's card). Keys,
 * inside the deck: ⏎ in the update line marks followed up, ⏎ in the Next
 * field sets that date, Alt + ← / → anywhere go Back / Skip, J / K / S
 * outside a text field go next / back / skip; Esc closes (an open picker or
 * the editor takes it first). It sits on the overlay tier, as the task
 * dialog does, so the pickers and the editor open above it.
 */
export function ReviewDeck() {
  const open = useReviewStore((s) => s.open)
  return open ? <ReviewDeckPanel /> : null
}

const editorIsOpen = () => useUIStore.getState().editPopupMode != null

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
  const close = useCallback(() => useReviewStore.getState().close(), [])

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

  // Alt + ← / → anywhere in the deck — the notes editor too, before its own keys.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
      e.preventDefault()
      e.stopPropagation()
      const store = useReviewStore.getState()
      if (e.key === 'ArrowLeft') store.back()
      else skipCurrent()
    }
    panel.addEventListener('keydown', onKey, true)
    return () => panel.removeEventListener('keydown', onKey, true)
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
  const done = followedUpCount(marks, ids)
  const finished = allReviewed(marks, ids)

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
      <ReviewRail ids={ids} dividers={dividers} index={index} marks={marks} todoById={todoById} />
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

/** Skip: the current task marked skipped (unless followed up here), then the next card. Writes nothing. */
function skipCurrent() {
  const store = useReviewStore.getState()
  const id = store.ids[store.index]
  if (id != null) store.mark(id, 'skipped')
  store.next()
}

// ── The queue rail ─────────────────────────────────────────────────────────

function ReviewRail({ ids, dividers, index, marks, todoById }: {
  ids: readonly number[]
  dividers: readonly ReviewDivider[]
  index: number
  marks: Readonly<Record<number, ReviewMark>>
  todoById: ReadonlyMap<number, PersistedTodoItem>
}) {
  const today = useToday()
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const rowDates = useSettingsStore((s) => s.rowDates)
  const listRef = useRef<HTMLOListElement>(null)
  const dividerAt = useMemo(() => new Map(dividers.map((d) => [d.index, d.label])), [dividers])

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
          if (!todo) return []
          const label = dividerAt.get(i)
          const mark = marks[id]
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
                aria-label={`${todo.title}${fuText ? `, follow-up ${fuText}` : ''}${dueText ? `, due ${dueText}` : ''}${todo.isCompleted ? ', completed' : ''}${markWords}`}
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

/** The priority chip's words: `Urgent + Important`, `Urgent · by due date`, `Focus`; empty for none. */
function priorityWords(summary: MarkerSummary): string {
  const parts: string[] = []
  if (summary.focus) parts.push(MARKER_LABELS.focus)
  if (summary.urgent === 'flag') parts.push(MARKER_LABELS.urgent)
  if (summary.urgent === 'date') parts.push(`${MARKER_LABELS.urgent} · by due date`)
  if (summary.important) parts.push(MARKER_LABELS.important)
  return parts.join(' + ')
}

function ReviewCard({ todo, isLast }: { todo: PersistedTodoItem; isLast: boolean }) {
  const todoId = todo.id
  const today = useToday()
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const autoFollowup = useSettingsStore((s) => s.autoFollowup)
  const followupDefaultInterval = useSettingsStore((s) => s.followupDefaultInterval)
  const statuses = useStatusStore((s) => s.statuses)
  const tags = useTagStore((s) => s.assignedTagsMap.get(todoId))
  const draft = useReviewStore((s) => s.drafts[todoId] ?? '')
  const uid = useId()

  // Notes: one edit session, written before any other write to the task.
  const notes = useTaskNotesSource({ todoId })
  const flushNotes = notes.flush
  const entryOptions = { isEdit: true, todoId, flushNotes }
  const subtasks = useEditorSubtasks(entryOptions, undefined)
  const updates = useEditorStatusUpdates(entryOptions, undefined)
  /** `run` after the notes typed so far (each edit its own undo step, in order). */
  const afterNotes = (run: () => unknown) => { void flushNotes().finally(run) }

  const updateRef = useRef<HTMLInputElement>(null)
  const nextRef = useRef<HTMLInputElement>(null)
  const statusRef = useRef<HTMLButtonElement>(null)
  const [statusOpen, setStatusOpen] = useState(false)

  // Each card opens with the focus in its Status update line — unless the
  // keyboard is stepping through the rail (the focus stays there).
  useLayoutEffect(() => {
    if (document.activeElement?.closest('[data-review-rail]')) return
    updateRef.current?.focus({ preventScroll: true })
  }, [])

  // ── Follow-up: the Next field starts on what Mark followed up would leave (the popover's rule).
  const proposal = autoNextFollowup(today, { autoFollowup, followupDefaultInterval })
  const current = todo.nextFollowupAt ?? null
  const ruled = nextAfterFollowup(current, today, proposal)
  const input = useFollowupInput(ruled ?? undefined, 'next', today)
  const s = input.state
  const untouched = s.kind === 'unchanged'
  const fieldDate: Date | null | 'invalid' =
    untouched ? ruled : s.kind === 'empty' ? null : s.kind === 'valid' ? s.date : 'invalid'
  const hasUpdate = statusUpdateText(draft) !== ''
  const doneToday = isFollowedUpToday(todo, today)

  const setNext = (date: Date | null) => afterNotes(() => useTodoStore.getState().update(todoId, { nextFollowupAt: date ?? undefined }))
  /** A date for the next follow-up (⏎ in the field, a quick button): set now, the field showing it; then on to the update line. */
  const apply = (date: Date | null) => {
    setNext(date)
    if (date) input.settle(date)
    else input.change('')
    updateRef.current?.focus()
  }
  /** None: no next follow-up, at once; the field stays empty (Mark followed up then leaves none). */
  const clearNext = () => {
    input.change('')
    if (current !== null) setNext(null)
  }
  const onNextKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (e.repeat || fieldDate === 'invalid') return
    if (!sameDay(fieldDate, current)) apply(fieldDate)
    else updateRef.current?.focus()
  }

  /** Mark followed up: the notes first, then the follow-up (with the update line's text: one undo step); then the next card. */
  const followUp = () => {
    if (fieldDate === 'invalid') return
    const options = untouched ? {} : { next: fieldDate }
    const text = draft
    afterNotes(() => markFollowedUpWithUpdate([todoId], options, text).catch((err: unknown) => {
      console.error('[review] the follow-up could not be recorded', err)
    }))
    const store = useReviewStore.getState()
    store.setDraft(todoId, '')
    store.mark(todoId, 'done')
    if (isLast) {
      // The last card stays: it shows what it wrote.
      if (!untouched && fieldDate) input.settle(fieldDate)
      updateRef.current?.focus()
    }
    store.next()
  }

  const toggleComplete = () => {
    const shownCompleted = todo.isCompleted
    afterNotes(() => {
      const stored = useTodoStore.getState().todos.find((t) => t.id === todoId)
      if (stored && stored.isCompleted === shownCompleted) return useTodoStore.getState().toggleComplete(todoId)
    })
  }

  const summary = markerSummary(todo, today, urgentRange)
  const priority = priorityWords(summary)
  const status = statuses.find((st) => st.id === todo.statusId)
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
        <div className={styles.meta}>
          <button
            ref={statusRef}
            type="button"
            className={styles.metaChip}
            aria-label={`Status: ${status?.name ?? 'No status'}`}
            aria-haspopup="menu"
            aria-expanded={statusOpen}
            onClick={() => setStatusOpen((o) => !o)}
          >
            <span style={status ? { color: status.color } : undefined}>
              <StatusIcon icon={status?.icon || DEFAULT_STATUS_ICON} filled={status != null} />
            </span>
            {status?.name ?? 'No status'}
            <ChevronDownIcon size={10} />
          </button>
          <DeadlinePicker
            value={todo.dueDate}
            onChange={(next) => afterNotes(() => useTodoStore.getState().update(todoId, dueDateChanges(next, todo.recurrenceRule?.type)))}
          />
          {priority && <span className={styles.priorityChip} data-urgent={summary.urgent ?? undefined} data-important={summary.important || undefined} data-focus={summary.focus || undefined}>{priority}</span>}
          {(tags ?? []).map((tag) => <span key={tag.id} className={styles.tagChip}>#{tag.name}</span>)}
        </div>
        {statusOpen && (
          <AnchoredPicker anchorRef={statusRef} onClose={() => setStatusOpen(false)} closeOnEscape>
            <StatusMenu
              statuses={statuses}
              statusId={todo.statusId}
              onPick={(statusId) => {
                afterNotes(() => useTodoStore.getState().update(todoId, { statusId }))
                setStatusOpen(false)
              }}
            />
          </AnchoredPicker>
        )}
        <div className={styles.columns}>
          <div className={styles.column}>
            <section className={styles.section} aria-labelledby={`${uid}-notes`}>
              <h4 id={`${uid}-notes`} className={styles.sectionLabel}><NotesIcon size={12} /> Notes</h4>
              <div className={styles.notes}>
                <NotesBody
                  source={notes.source}
                  showToolbar={false}
                  placeholder="No notes yet. Type here to add some."
                  subtaskTarget={subtasks.noteTarget}
                />
              </div>
            </section>
            <section className={styles.section} aria-labelledby={`${uid}-checklist`}>
              <h4 id={`${uid}-checklist`} className={styles.sectionLabel}><ChecklistIcon size={12} /> Checklist</h4>
              <SubtaskChecklist
                items={subtasks.items}
                density="editor"
                label="Checklist"
                onAdd={subtasks.add}
                onRename={subtasks.rename}
                onSetDone={subtasks.setDone}
                onRemove={subtasks.remove}
                extraMenuEntries={storedSubtaskMenuEntries}
              />
            </section>
          </div>
          <div className={styles.column}>
            <label className={styles.sectionLabel} htmlFor={`${uid}-update`}>Status update · today</label>
            <input
              id={`${uid}-update`}
              ref={updateRef}
              className={styles.updateInput}
              value={draft}
              maxLength={STATUS_UPDATE_TEXT_MAX}
              placeholder="What’s the latest?"
              autoComplete="off"
              data-review-update=""
              onChange={(e) => useReviewStore.getState().setDraft(todoId, e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                e.preventDefault()
                if (!e.repeat) followUp()
              }}
            />
            <StatusUpdatesSection
              entries={updates.entries}
              onAdd={updates.add}
              onEdit={updates.edit}
              onRemove={updates.remove}
              heading="Recent updates"
              className={styles.updates}
              labelClassName={styles.sectionLabel}
            />
          </div>
        </div>
        <div className={styles.strip}>
          <div className={styles.last}>
            <span className={styles.stripLabel}>Last followed up</span>
            <span className={styles.lastValue} data-late={lastLate || undefined} data-testid="review-last-followup">
              {last ? `${formatDateNumeric(last)} · ${relativeDayPhrase(last, today)}` : 'Never followed up'}
            </span>
          </div>
          <div className={styles.next}>
            <label className={styles.stripLabel} htmlFor={`${uid}-next`}>Next follow-up</label>
            <div className={styles.nextRow}>
              <input
                id={`${uid}-next`}
                ref={nextRef}
                className={`${styles.nextInput} ${s.kind === 'invalid' ? styles.nextInputError : ''}`}
                value={input.text}
                placeholder={NEXT_FOLLOWUP_PLACEHOLDER}
                onChange={(e) => input.change(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={onNextKeyDown}
                aria-invalid={s.kind === 'invalid'}
                aria-describedby={`${uid}-next-help`}
                autoComplete="off"
                spellCheck={false}
              />
              <FollowupQuickButtons
                intervals={QUICK_FOLLOWUP_INTERVALS}
                labelStyle="long"
                onPick={(i) => apply(addFollowupInterval(today, i))}
              />
              <button type="button" className={styles.noneBtn} aria-label="No next follow-up" onClick={clearNext}>None</button>
            </div>
            <div id={`${uid}-next-help`} className={styles.help} aria-live="polite">
              {s.kind === 'valid' && <>→ {formatFollowupDate(s.date, today)} · {relativeDayPhrase(s.date, today)} · ⏎ to set</>}
              {s.kind === 'invalid' && <span className={styles.helpError}>{s.message}</span>}
              {s.kind === 'empty' && (current !== null ? 'No next follow-up · ⏎ to clear' : 'No next follow-up')}
            </div>
          </div>
        </div>
      </div>
      <footer className={styles.footer}>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => afterNotes(() => useUIStore.getState().openEditPopup(todoId))}
        >
          Open in editor
        </button>
        <span className={styles.spacer} />
        <span className={styles.hint} data-testid="review-hint">{hint}</span>
        <button type="button" className={styles.secondaryBtn} onClick={() => useReviewStore.getState().back()}>
          <ChevronLeftIcon /> Back <kbd className={styles.key}>K</kbd>
        </button>
        <button type="button" className={styles.secondaryBtn} onClick={skipCurrent}>
          Skip <ChevronRightIcon /> <kbd className={styles.key}>S</kbd>
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
