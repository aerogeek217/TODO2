import { useId, useLayoutEffect, useRef, type ChangeEvent as ReactChangeEvent, type RefObject } from 'react'
import { STATUS_UPDATE_TEXT_MAX, type Person, type PersistedTodoItem, type RecurrenceType, type Tag, type TodoChanges } from '../../models'
import { NEXT_FOLLOWUP_PLACEHOLDER } from '../../hooks/use-followup-input'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { useSelectAllOnFocus } from '../../hooks/use-select-all-on-focus'
import { usePersonStore } from '../../stores/person-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useStatusUpdateStore } from '../../stores/status-update-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { formatDateNumeric, formatRowDate } from '../../utils/date'
import { addFollowupInterval, formatFollowupDate, QUICK_FOLLOWUP_INTERVALS, relativeDayPhrase } from '../../utils/followup'
import { markerSummary, MARKER_LABELS } from '../../utils/markers'
import { dueDateChanges, makeRecurrenceRule } from '../../utils/recurrence'
import { dueState, followupState } from '../../utils/row-date-state'

import { urgentMark, urgentToggleHint } from '../../utils/urgency'
import { FollowupDateButton } from '../shared/followup/FollowupDateButton'
import { FollowupQuickButtons } from '../shared/followup/FollowupQuickButtons'
import { MarkFollowedUpButton } from '../shared/followup/MarkFollowedUpButton'
import followupStyles from '../shared/followup/Followup.module.css'
import { ChevronLeftIcon, ChevronRightIcon, OpenIcon } from '../shared/icons'
import { useTaskNotesSource } from '../task/notes/use-task-notes-source'
import { RowCheckbox } from '../task/row-cells'
import { StatusUpdatesSection } from '../task/status-updates/StatusUpdatesSection'
import { SubtasksSection } from '../task/subtasks/SubtasksSection'
import { storedSubtaskMenuEntries } from '../task/subtasks/subtask-menu'
import { TaskDetailsBody, TaskNotesSection } from '../task/TaskDetailsBody'
import { taskLayoutClasses } from '../task/task-layout-classes'
import { FactDateField, FactDateWords, FactRow, FollowupFacts, PriorityFacts, StatusFacts, type FactDateTone } from '../task/TaskFacts'
import { TaskEditMetadata } from '../task/TaskEditMetadata'
import { useEditorStatusUpdates, useEditorSubtasks } from '../task/use-editor-entries'
import { useReviewSessionApi } from './review-session-context'
import { useReviewFollowUp, type ReviewFollowUp } from './use-review-follow-up'
import styles from './Review.module.css'

const NO_PEOPLE: Person[] = []
const NO_TAGS: Tag[] = []

/**
 * The review card (D26; the deck's and the Review widget's large face): the
 * task editor's layout (boards BJ, BL, the shared `TaskDetailsBody`) for
 * one task, every edit written at once, each its own undo step after the
 * notes typed so far — the box and title; the facts rail (Priority, Status,
 * People, Tags, Due + repeat, then Follow-up: Next — the field Mark
 * followed up reads —, Last as a date only); the writing (Notes and
 * Subtasks above the dock: Status updates oldest first with the review's
 * update line last, so that line is in the same place on every card). One task
 * only, never the selection. Then the footer (`ReviewFooter`): the hint,
 * ‹ Back, Skip › and Mark followed up ›. The host lays the card and the
 * footer out (`data-review-card`, `data-review-footer`).
 */
export function ReviewCard({ todo, keyHints = false, focusOnOpen }: { todo: PersistedTodoItem; keyHints?: boolean; focusOnOpen?: ReviewFocusOnOpen }) {
  const todoId = todo.id
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const statuses = useStatusStore((s) => s.statuses)
  const allPeople = usePersonStore((s) => s.people)
  const assignedPeople = usePersonStore((s) => s.assignedPeopleMap.get(todoId)) ?? NO_PEOPLE
  const allTags = useTagStore((s) => s.tags)
  const assignedTags = useTagStore((s) => s.assignedTagsMap.get(todoId)) ?? NO_TAGS
  const selectOnFocus = useSelectAllOnFocus()
  const uid = useId()

  // Notes: one edit session, written before any other write to the task.
  const notes = useTaskNotesSource({ todoId })
  const flushNotes = notes.flush
  const entryOptions = { isEdit: true, todoId, flushNotes }
  const subtasks = useEditorSubtasks(entryOptions, undefined)
  const updates = useEditorStatusUpdates(entryOptions, undefined)
  const updateRef = useRef<HTMLInputElement>(null)
  const f = useReviewFollowUp(todo, flushNotes, updateRef)
  const { today, afterNotes, input, untouched, current, fieldDate } = f
  const update = (changes: TodoChanges) => afterNotes(() => useTodoStore.getState().update(todoId, changes))
  const nextRef = useRef<HTMLInputElement>(null)

  useFocusUpdateLineOnOpen(updateRef, focusOnOpen)

  const s = input.state

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
  // The Next field's words at rest: the date it holds, coloured as a row's follow-up date.
  const shownNext = fieldDate === 'invalid' ? null : fieldDate
  const shownNextState = shownNext ? followupState({ nextFollowupAt: shownNext, isCompleted: todo.isCompleted }, today) : undefined
  const nextTone: FactDateTone | undefined = shownNextState === 'late' ? 'followup-late' : shownNextState === 'today' ? 'followup-today' : undefined
  const dues = dueState(todo, today, urgentRange)

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
        <TaskDetailsBody
          rail={(
            <>
              <PriorityFacts
                focusOn={todo.focus === true}
                urgentOn={todo.urgent === true}
                importantOn={todo.important === true}
                urgentState={urgentState}
                urgentHint={urgentHint}
                onToggleFocus={() => afterNotes(() => useTodoStore.getState().bulkSetFocus([todoId], todo.focus !== true))}
                onToggleUrgent={() => afterNotes(() => useTodoStore.getState().bulkSetUrgent([todoId], todo.urgent !== true))}
                onToggleImportant={() => afterNotes(() => useTodoStore.getState().bulkSetImportant([todoId], todo.important !== true))}
              />
              <StatusFacts statuses={statuses} statusId={todo.statusId} onStatusChange={(statusId) => update({ statusId })} />
              <TaskEditMetadata
                deadline={todo.dueDate ?? null}
                recurrenceType={recurrenceType}
                dueTone={dues.past ? 'past' : dues.soon ? 'soon' : undefined}
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
              />
              <FollowupFacts>
                <FactRow label="Next">
                  <FactDateField date={shownNext} kind="next" tone={nextTone} empty="None" showWords={untouched}>
                    <div className={`${followupStyles.editorInputWrap} ${s.kind === 'invalid' ? followupStyles.inputWrapError : ''}`}>
                      <input
                        id={`${uid}-next`}
                        ref={nextRef}
                        aria-label="Next follow-up"
                        className={followupStyles.input}
                        value={input.text}
                        placeholder={NEXT_FOLLOWUP_PLACEHOLDER}
                        onChange={(e) => f.typeNext(e.target.value)}
                        {...selectOnFocus}
                        data-review-next=""
                        onKeyDown={f.onNextKeyDown}
                        aria-invalid={s.kind === 'invalid'}
                        aria-describedby={`${uid}-next-help`}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      {input.text !== '' && (
                        <button
                          type="button"
                          className={followupStyles.inputClear}
                          aria-label="Clear next follow-up"
                          title="Clear next follow-up"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={f.clearNext}
                        >
                          &times;
                        </button>
                      )}
                      <FollowupDateButton
                        label="Pick next follow-up date"
                        value={shownNext ?? undefined}
                        onPick={(d) => (d ? f.apply(d) : f.clearNext())}
                      />
                    </div>
                  </FactDateField>
                </FactRow>
                <div className={followupStyles.factIndent}>
                  <span id={`${uid}-next-help`} className={styles.help} aria-live="polite">
                    {s.kind === 'valid' && <>→ {formatFollowupDate(s.date, today)} · {relativeDayPhrase(s.date, today)} · ⏎ to set</>}
                    {s.kind === 'invalid' && <span className={styles.helpError}>{s.message}</span>}
                    {s.kind === 'empty' && (current !== null ? 'No next follow-up · ⏎ to clear' : 'No next follow-up')}
                  </span>
                  <FollowupQuickButtons
                    intervals={QUICK_FOLLOWUP_INTERVALS}
                    labelStyle="short"
                    onPick={(i) => f.apply(addFollowupInterval(today, i))}
                  />
                </div>
                <FactRow label="Last">
                  <span className={styles.lastValue} data-late={lastLate || undefined} data-testid="review-last-followup">
                    <FactDateWords date={last} kind="last" empty="Never followed up" />
                  </span>
                </FactRow>
              </FollowupFacts>
            </>
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
              className={taskLayoutClasses.section}
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
              className={taskLayoutClasses.section}
              labelClassName={taskLayoutClasses.label}
              addLine={<ReviewUpdateLine followUp={f} inputRef={updateRef} id={`${uid}-update`} />}
            />
          )}
        />
      </div>
      <ReviewFooter followUp={f} keyHints={keyHints} />
    </>
  )
}

/**
 * Whether a card opening takes the focus into its update line: the deck's
 * always (absent); a widget's only while the user is working in it — the
 * focus was in the widget when the card changed (a card changing under a
 * list the user is typing in leaves the focus there).
 */
export type ReviewFocusOnOpen = () => boolean

/**
 * Each card opens with the focus in its Status update line — unless the
 * keyboard is stepping through the rail (the focus stays there), or the
 * host says not now (`focusOnOpen`).
 */
function useFocusUpdateLineOnOpen(updateRef: RefObject<HTMLInputElement | null>, focusOnOpen: ReviewFocusOnOpen | undefined) {
  const focusOnOpenRef = useLatestRef(focusOnOpen)
  useLayoutEffect(() => {
    const line = updateRef.current
    if (!line) return
    if (document.activeElement?.closest('[data-review-rail]')) return
    const ask = focusOnOpenRef.current
    if (ask && !ask()) return
    line.focus({ preventScroll: true })
    // In view inside the card's body (a long checklist or log can push it below the fold); the host itself stays put.
    if (typeof line.scrollIntoView === 'function') line.scrollIntoView({ block: 'nearest' })
  }, [updateRef, focusOnOpenRef])
}

/** The update line, last in Status updates: ⏎ is Mark followed up with its text. */
export function ReviewUpdateLine({ followUp: f, inputRef, id, compact = false }: {
  followUp: ReviewFollowUp
  inputRef: RefObject<HTMLInputElement | null>
  id?: string
  compact?: boolean
}) {
  return (
    <div className={`${styles.updateLine} ${compact ? styles.updateLineCompact : ''}`}>
      <input
        id={id}
        ref={inputRef}
        className={styles.updateInput}
        value={f.draft}
        maxLength={STATUS_UPDATE_TEXT_MAX}
        placeholder="What’s the latest?"
        aria-label="Status update · today"
        autoComplete="off"
        data-review-update=""
        onChange={(e) => f.setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
          e.preventDefault()
          if (!e.repeat) f.followUp()
        }}
      />
      <span className={styles.updateHint} aria-hidden="true">{compact ? '⏎ follows up' : '⏎ follows up with it'}</span>
    </div>
  )
}

/**
 * The review's footer: what Mark followed up will do, ‹ Back, Skip › and
 * Mark followed up ›. `keyHints`: the deck's keys beside Back and Skip;
 * `openCard`: the medium face's Open card ↗ (the task in its editor).
 */
export function ReviewFooter({ followUp: f, keyHints = false, compact = false, onOpenCard }: {
  followUp: ReviewFollowUp
  keyHints?: boolean
  compact?: boolean
  onOpenCard?: () => void
}) {
  const session = useReviewSessionApi()
  return (
    <footer className={`${styles.footer} ${compact ? styles.footerCompact : ''}`} data-review-footer="">
      {onOpenCard && (
        <button type="button" className={styles.linkBtn} onClick={onOpenCard}>
          Open card <OpenIcon size={12} />
        </button>
      )}
      <span className={styles.spacer} />
      {!compact && <span className={styles.hint} data-testid="review-hint">{f.hint}</span>}
      <button
        type="button"
        className={styles.secondaryBtn}
        aria-keyshortcuts={keyHints ? 'K Alt+ArrowLeft' : undefined}
        onClick={() => session.getState().back()}
      >
        <ChevronLeftIcon /> Back {keyHints && <kbd className={styles.key} aria-hidden="true">K</kbd>}
      </button>
      <button
        type="button"
        className={styles.secondaryBtn}
        aria-keyshortcuts={keyHints ? 'S Alt+ArrowRight' : undefined}
        onClick={() => session.getState().skip()}
      >
        Skip <ChevronRightIcon /> {keyHints && <kbd className={styles.key} aria-hidden="true">S</kbd>}
      </button>
      <MarkFollowedUpButton
        className={styles.markBtn}
        doneToday={f.doneToday}
        dimmed={f.doneToday && !f.hasUpdate}
        disabled={f.fieldDate === 'invalid'}
        {...f.followUpTipProps}
        adornment={compact ? <ChevronRightIcon /> : <><ChevronRightIcon /> ⏎</>}
        onClick={f.followUp}
      />
      {f.followUpTip}
    </footer>
  )
}

/** How many of a task's status updates the medium face shows (the latest ones). */
const COMPACT_UPDATES = 2

/**
 * The review card's essentials (the Review widget's medium face, item 12;
 * board BM): the box and title, a one-line summary of the facts (due,
 * status, priority, next and last follow-up), then the **updates dock** —
 * the Status updates heading (with the count once there is an entry), the
 * latest two entries oldest first (read-only: Open card ↗ edits them) and
 * the update line (⏎ follows up) — and the footer; Open card ↗ opens the
 * task in its editor. In a short cell the older entry, the log, then the
 * heading give way (`Review.module.css`).
 */
export function ReviewCompactCard({ todo, focusOnOpen }: { todo: PersistedTodoItem; focusOnOpen?: ReviewFocusOnOpen }) {
  const todoId = todo.id
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const rowDates = useSettingsStore((s) => s.rowDates)
  const status = useStatusStore((s) => (todo.statusId != null ? s.statuses.find((st) => st.id === todo.statusId) : undefined))
  // Newest first (the store's order).
  const updates = useStatusUpdateStore((s) => s.byTodo.get(todoId))
  const latest = (updates ?? []).slice(0, COMPACT_UPDATES).toReversed()
  const headingId = useId()
  const updateRef = useRef<HTMLInputElement>(null)
  const f = useReviewFollowUp(todo, NO_NOTES, updateRef)
  useFocusUpdateLineOnOpen(updateRef, focusOnOpen)
  const { today } = f
  const summary = markerSummary(todo, today, urgentRange)
  const dues = dueState(todo, today, urgentRange)

  const facts: { key: string; text: string; tone?: string }[] = []
  if (todo.dueDate) facts.push({ key: 'due', text: `Due ${formatRowDate(todo.dueDate, today, rowDates)}`, tone: dues.past || dues.soon ? 'due' : undefined })
  if (status) facts.push({ key: 'status', text: status.name })
  const markers = (['focus', 'urgent', 'important'] as const).filter((k) => summary[k])
  if (markers.length > 0) facts.push({ key: 'priority', text: markers.map((k) => MARKER_LABELS[k]).join(' + ') })
  if (todo.nextFollowupAt) facts.push({ key: 'next', text: `Next ${formatRowDate(todo.nextFollowupAt, today, rowDates)}`, tone: followupState(todo, today) === 'late' || followupState(todo, today) === 'today' ? 'followup' : undefined })
  facts.push({ key: 'last', text: todo.lastFollowupAt ? `Last ${formatRowDate(todo.lastFollowupAt, today, rowDates)}` : 'Never followed up' })

  const toggleComplete = () => {
    const shownCompleted = todo.isCompleted
    const stored = useTodoStore.getState().todos.find((t) => t.id === todoId)
    if (stored && stored.isCompleted === shownCompleted) void useTodoStore.getState().toggleComplete(todoId)
  }

  return (
    <>
      <div className={styles.compactCard} data-review-card={todoId} data-review-face="medium">
        <div className={styles.compactHead}>
          <div className={styles.compactTop}>
            <RowCheckbox
              summary={summary}
              checked={todo.isCompleted}
              onChange={toggleComplete}
              aria-label={todo.isCompleted ? 'Mark incomplete' : 'Mark complete'}
            />
            <h3 className={`${styles.compactTitle} ${todo.isCompleted ? styles.cardTitleDone : ''}`} data-testid="review-card-title">{todo.title}</h3>
          </div>
          <p className={styles.compactFacts} data-testid="review-facts">
            {facts.map((fact, i) => (
              <span key={fact.key} data-tone={fact.tone}>{i > 0 ? ' · ' : ''}{fact.text}</span>
            ))}
          </p>
        </div>
        <section className={styles.compactDock} aria-labelledby={headingId} data-review-dock="">
          <h4 className={styles.compactHeading} id={headingId}>
            Status updates
            {updates != null && updates.length > 0 && <span className={styles.compactCount} data-status-update-count="">{updates.length}</span>}
          </h4>
          {latest.length > 0 && (
            <ul className={styles.compactLog} aria-label="Latest status updates" data-status-update-list="">
              {latest.map((entry, i) => {
                const newest = i === latest.length - 1
                return (
                  <li
                    key={entry.id}
                    className={styles.compactEntry}
                    data-status-update=""
                    data-newest={newest ? 'true' : undefined}
                    data-testid={newest ? 'review-newest-update' : undefined}
                    title={`${formatDateNumeric(entry.date)} ${entry.text}`}
                  >
                    <span className={styles.compactDay}>{formatDateNumeric(entry.date)}</span>
                    <span className={styles.compactText}>{entry.text}</span>
                  </li>
                )
              })}
            </ul>
          )}
          <ReviewUpdateLine followUp={f} inputRef={updateRef} compact />
        </section>
      </div>
      <ReviewFooter followUp={f} compact onOpenCard={() => useUIStore.getState().openEditPopup(todoId)} />
    </>
  )
}

const NO_NOTES = () => Promise.resolve()
