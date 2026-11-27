import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { STATUS_UPDATE_TEXT_MAX, type Person, type Interval, type PersistedTodoItem, type Tag, type TodoChanges } from '../../models'
import { NEXT_FOLLOWUP_PLACEHOLDER } from '../../hooks/use-followup-input'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { useToday } from '../../hooks/use-today'
import { useSelectAllOnFocus } from '../../hooks/use-select-all-on-focus'
import { usePersonStore } from '../../stores/person-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useStatusUpdateStore } from '../../stores/status-update-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { formatDate, formatDateNumeric, formatRelativeTime, formatRowDate } from '../../utils/date'
import { addFollowupInterval, formatFollowupDate, relativeDayPhrase } from '../../utils/followup'
import { markerSummary, MARKER_LABELS } from '../../utils/markers'
import { dueDateChanges, makeRecurrenceRule } from '../../utils/recurrence'
import { dueState, followupState } from '../../utils/row-date-state'
import { plannerConflicts, plannerPlannedDay } from '../../utils/planner'

import { urgentMark, urgentToggleHint } from '../../utils/urgency'
import { FollowupDateButton } from '../shared/followup/FollowupDateButton'
import { FollowupQuickButtons } from '../shared/followup/FollowupQuickButtons'
import { MarkFollowedUpButton } from '../shared/followup/MarkFollowedUpButton'
import followupStyles from '../shared/followup/Followup.module.css'
import { RemoveButton } from '../shared/RemoveButton'
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, IndentIcon, MoreIcon, OpenIcon, TrashIcon, WidgetKindIcon } from '../shared/icons'
import { MenuPopover, type MenuEntry } from '../shared/MenuPopover'
import { useTaskNotesSource } from '../task/notes/use-task-notes-source'
import { RowCheckbox } from '../task/row-cells'
import { StatusUpdatesSection } from '../task/status-updates/StatusUpdatesSection'
import { SubtasksSection } from '../task/subtasks/SubtasksSection'
import { storedSubtaskMenuEntries } from '../task/subtasks/subtask-menu'
import { TaskDetailsBody, TaskNotesSection } from '../task/TaskDetailsBody'
import { planForDayEntries, planForDayMenu } from '../task/plan-menu'
import { taskLayoutClasses } from '../task/task-layout-classes'
import { FactDateField, PriorityFacts, StatusFacts, type FactDateTone } from '../task/TaskFacts'
import { TaskFollowupFields, type FollowupFieldParts } from '../task/TaskFollowupFields'
import { TaskEditMetadata } from '../task/TaskEditMetadata'
import { TaskPlannedFacts } from '../task/PlannedFacts'
import { useEditorStatusUpdates, useEditorSubtasks } from '../task/use-editor-entries'
import { useReviewSessionApi } from './review-session-context'
import { useReviewFollowUp, type ReviewFollowUp } from './use-review-follow-up'
import { useReviewTaskMenu } from './review-task-menu'
import { ReviewTitleField } from './ReviewTitleField'
import styles from './Review.module.css'

const NO_PEOPLE: Person[] = []
const NO_TAGS: Tag[] = []

/**
 * The review card (D26; the Review widget's large face): the task editor's
 * layout (task layout B — the shared `TaskDetailsBody`) for one task, every
 * edit written at once, each its own undo step after the notes typed so far
 * — the box and title; the fact band (Priority, Status, People, Tags, Due +
 * repeat); Subtasks and Notes on the left, Status updates on the right,
 * oldest first with the review's update line last. One task only, never the
 * selection. Then the footer (`ReviewFooter`): ‹ Back and Skip › at its left
 * end; at its right the follow-up fields — Last, then Next (the field Mark
 * followed up reads) and its quick intervals — and Mark followed up ›. The
 * host lays the card and the footer out (`data-review-card`,
 * `data-review-footer`).
 */
export function ReviewCard({ todo, focusOnOpen }: { todo: PersistedTodoItem; focusOnOpen?: ReviewFocusOnOpen }) {
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
  const { today, afterNotes } = f
  const update = (changes: TodoChanges) => afterNotes(() => useTodoStore.getState().update(todoId, changes))

  useFocusUpdateLineOnOpen(updateRef, focusOnOpen)
  const taskMenu = useReviewTaskMenu()

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
  const onRepeatChange = (every: Interval | null) => {
    update({ recurrenceRule: every && todo.dueDate ? makeRecurrenceRule(every, todo.dueDate) : undefined })
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

  const { last } = f
  const ls = last.input.state
  const dues = dueState(todo, today, urgentRange)

  return (
    <>
      <div className={styles.card} data-review-card={todoId}>
        {/* A right-click on the title row: the task menu (notes typed so far written first). */}
        <div className={styles.cardTop} onContextMenu={taskMenu.onContextMenu(todoId, () => { void flushNotes() })}>
          <div className={styles.cardBox}>
            <RowCheckbox
              summary={summary}
              checked={todo.isCompleted}
              onChange={toggleComplete}
              aria-label={todo.isCompleted ? 'Mark incomplete' : 'Mark complete'}
            />
          </div>
          <ReviewTitleField
            todo={todo}
            className={`${styles.cardTitle} ${todo.isCompleted ? styles.cardTitleDone : ''}`}
            write={(title) => update({ title })}
          />
          <span className={styles.cardMeta} data-task-meta="">
            Created {formatDate(todo.createdAt)} · Modified {formatRelativeTime(todo.modifiedAt)}
          </span>
          <ReviewCardMenu todoId={todoId} afterNotes={afterNotes} />
        </div>
        {taskMenu.menu(todo)}
        <TaskDetailsBody
          facts={(
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
                repeat={todo.recurrenceRule?.every ?? null}
                dueTone={dues.past ? 'past' : dues.soon ? 'soon' : undefined}
                onDeadlineChange={(next) => update(dueDateChanges(next, todo.recurrenceRule?.every))}
                onRepeatChange={onRepeatChange}
                assignedPeople={assignedPeople}
                assignedTags={assignedTags}
                allPeople={allPeople}
                allTags={allTags}
                onTogglePerson={togglePerson}
                onToggleTag={toggleTag}
                onCreatePerson={createPerson}
                onCreateTag={createTag}
                planned={<TaskPlannedFacts todo={todo} />}
              />
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
      <ReviewFooter
        followUp={f}
        followup={(
          <TaskFollowupFields
            last={{
              field: (
                <FactDateField date={last.stored} kind="last" empty="Never" showWords={!last.input.dirty} testId="review-last-followup">
                  <div className={`${followupStyles.editorInputWrap} ${ls.kind === 'invalid' ? followupStyles.inputWrapError : ''}`}>
                    <input
                      aria-label="Last follow-up"
                      className={followupStyles.input}
                      value={last.input.text}
                      placeholder="Never"
                      onChange={(e) => last.input.change(e.target.value)}
                      onFocus={last.onFocus}
                      onBlur={last.onBlur}
                      onKeyDown={last.onKeyDown}
                      aria-invalid={ls.kind === 'invalid'}
                      aria-describedby={`${uid}-last-help`}
                      data-review-last=""
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <FollowupDateButton
                      label="Pick last follow-up date"
                      value={last.stored}
                      max={today}
                      onPick={last.pick}
                    />
                  </div>
                </FactDateField>
              ),
              help: (
                <span id={`${uid}-last-help`} className={followupStyles.rowHelp} aria-live="polite">
                  {ls.kind === 'valid' && <>→ {formatFollowupDate(ls.date, today)} · {relativeDayPhrase(ls.date, today)} · ⏎ to set</>}
                  {ls.kind === 'invalid' && <span className={followupStyles.helpError}>{ls.message}</span>}
                  {ls.kind === 'empty' && last.stored ? 'Never followed up · ⏎ to clear' : null}
                </span>
              ),
            }}
            next={reviewNextParts(f, `${uid}-next`, selectOnFocus)}
          />
        )}
      />
    </>
  )
}

/**
 * The card's ⋯ (the task editor header's): Open in editor, Duplicate (the
 * copy opens in the editor, as the editor's Duplicate switches to it), Make
 * subtask of…, Plan for day › (`task/plan-menu`) and Delete — each after the notes typed so far. A task that
 * goes (Delete, Make subtask of…) leaves the live queue; the review moves on
 * to the next card.
 */
function ReviewCardMenu({ todoId, afterNotes }: { todoId: number; afterNotes: ReviewFollowUp['afterNotes'] }) {
  const [open, setOpen] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)
  const ui = () => useUIStore.getState()
  const today = useToday()
  const todo = useTodoStore((s) => s.todos.find((t) => t.id === todoId))
  const planEntries = todo ? planForDayEntries(todo, today) : []
  const entries: MenuEntry[] = [
    { kind: 'item', label: 'Open in editor', icon: <OpenIcon />, onSelect: () => afterNotes(() => ui().openEditPopup(todoId)) },
    {
      kind: 'item',
      label: 'Duplicate',
      icon: <CopyIcon />,
      onSelect: () => afterNotes(async () => {
        const copy = await useTodoStore.getState().duplicate(todoId)
        if (copy) ui().openEditPopup(copy)
      }),
    },
    { kind: 'item', label: 'Make subtask of…', icon: <IndentIcon />, onSelect: () => afterNotes(() => ui().openTaskPicker({ kind: 'make-subtask', todoId })) },
    ...(planEntries.length > 0 ? [{ kind: 'separator' as const }, ...planEntries] : []),
    { kind: 'separator' },
    { kind: 'item', label: 'Delete', icon: <TrashIcon />, danger: true, onSelect: () => afterNotes(() => ui().showBulkConfirmation('delete', [todoId])) },
  ]
  return (
    <>
      <button
        ref={moreRef}
        type="button"
        className={styles.cardMore}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip="More actions"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreIcon size={16} />
      </button>
      {open && (
        <MenuPopover
          anchorRef={moreRef}
          placement="bottom-end"
          label="Task actions"
          entries={entries}
          width={200}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/**
 * The review's Next follow-up field (the card's footer and the medium face's row): the
 * field — starting on what Mark followed up would leave; ⏎ or a quick button
 * sets the date at once and hands the focus back to the update line; ×
 * clears it —, the quick intervals (Settings › Tasks), then what the typed text
 * means (`aria-live`).
 */
function reviewNextParts(f: ReviewFollowUp, id: string, selectOnFocus: ReturnType<typeof useSelectAllOnFocus>): FollowupFieldParts {
  const { input, fieldDate, current, today, todo } = f
  const s = input.state
  // The field's words at rest: the date it holds, coloured as a row's follow-up date.
  const shownNext = fieldDate === 'invalid' ? null : fieldDate
  const shownNextState = shownNext ? followupState({ nextFollowupAt: shownNext, isCompleted: todo.isCompleted }, today) : undefined
  const nextTone: FactDateTone | undefined = shownNextState === 'late' ? 'followup-late' : shownNextState === 'today' ? 'followup-today' : undefined
  return {
    field: (
      <FactDateField date={shownNext} kind="next" tone={nextTone} empty="None" showWords={f.untouched}>
        <div className={`${followupStyles.editorInputWrap} ${s.kind === 'invalid' ? followupStyles.inputWrapError : ''}`}>
          <input
            id={id}
            aria-label="Next follow-up"
            className={followupStyles.input}
            value={input.text}
            placeholder={NEXT_FOLLOWUP_PLACEHOLDER}
            onChange={(e) => f.typeNext(e.target.value)}
            {...selectOnFocus}
            data-review-next=""
            onKeyDown={f.onNextKeyDown}
            aria-invalid={s.kind === 'invalid'}
            aria-describedby={`${id}-help`}
            autoComplete="off"
            spellCheck={false}
          />
          {input.text !== '' && (
            <RemoveButton
              size={24}
              className={followupStyles.inputClear}
              label="Clear next follow-up"
              tooltip
              data-field-clear=""
              keepFocus
              onClick={f.clearNext}
            />
          )}
          <FollowupDateButton
            label="Pick next follow-up date"
            value={shownNext ?? undefined}
            onPick={(d) => (d ? f.apply(d) : f.clearNext())}
          />
        </div>
      </FactDateField>
    ),
    quick: (
      <FollowupQuickButtons
        labelStyle="short"
        onPick={(i) => f.apply(addFollowupInterval(today, i))}
      />
    ),
    help: (
      <span id={`${id}-help`} className={followupStyles.rowHelp} aria-live="polite">
        {s.kind === 'valid' && <>→ {formatFollowupDate(s.date, today)} · {relativeDayPhrase(s.date, today)} · ⏎ to set</>}
        {s.kind === 'invalid' && <span className={followupStyles.helpError}>{s.message}</span>}
        {s.kind === 'empty' && (current !== null ? 'No next follow-up · ⏎ to clear' : 'No next follow-up')}
      </span>
    ),
  }
}

/**
 * Whether a card opening takes the focus into its update line (absent:
 * always); a widget's only while the user is working in it — the
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
function ReviewUpdateLine({ followUp: f, inputRef, id, compact = false }: {
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
 * **Plan ▾** (the review footer's): the card ⋯'s Plan for day › as its own
 * menu — the week's days and Pick a date… (`planForDayMenu`), each a plan
 * write. A secondary button on the card's footer; on the medium face's, a
 * word button. None for a completed task.
 */
function ReviewPlanButton({ todo, today, compact }: { todo: PersistedTodoItem; today: Date; compact: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const entries = planForDayMenu(todo, today)
  if (entries.length === 0) return null
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={compact ? styles.linkBtn : styles.secondaryBtn}
        aria-haspopup="menu"
        aria-expanded={open}
        data-review-plan=""
        onClick={() => setOpen((v) => !v)}
      >
        {!compact && <WidgetKindIcon kind="planner" />}
        Plan
        <ChevronDownIcon size={10} />
      </button>
      {open && (
        <MenuPopover
          anchorRef={ref}
          placement={compact ? 'top-start' : 'top-end'}
          label="Plan for day"
          entries={entries}
          width={216}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/**
 * The review's footer. With the follow-up fields (the card, task layout B):
 * ‹ Back and Skip › at its left end, then the fields — Last, Next and its
 * quick intervals —, Plan ▾ and Mark followed up › (its tooltip says what it will
 * do; the Next field it reads is right beside it). In the DOM the fields,
 * Plan ▾ and Mark followed up come first, so the update line's Tab reaches Last,
 * then Next, before Back and Skip (which the rail's ← / → also do). Without
 * them (the medium face): Open card ↗ (`onOpenCard`, the task in its
 * editor) and Plan ▾, then Back, Skip and Mark followed up ›. The main
 * button reads `Mark reviewed` while it would leave no next follow-up
 * (`useReviewFollowUp`'s `markLabel`); it does the same either way.
 */
function ReviewFooter({ followUp: f, compact = false, onOpenCard, followup }: {
  followUp: ReviewFollowUp
  compact?: boolean
  onOpenCard?: () => void
  /** The follow-up fields (`TaskFollowupFields`), before Mark followed up. */
  followup?: ReactNode
}) {
  const session = useReviewSessionApi()
  const steps = (
    <>
      <button type="button" className={styles.secondaryBtn} onClick={() => session.getState().back()}>
        <ChevronLeftIcon /> Back
      </button>
      <button type="button" className={styles.secondaryBtn} onClick={() => session.getState().skip()}>
        Skip <ChevronRightIcon />
      </button>
    </>
  )
  return (
    <footer className={`${styles.footer} ${compact ? styles.footerCompact : ''}`} data-review-footer="">
      {onOpenCard && (
        <button type="button" className={styles.linkBtn} onClick={onOpenCard}>
          Open card <OpenIcon size={12} />
        </button>
      )}
      {!followup && <ReviewPlanButton todo={f.todo} today={f.today} compact />}
      {followup ?? <span className={styles.spacer} />}
      {!followup && steps}
      {followup && <ReviewPlanButton todo={f.todo} today={f.today} compact={false} />}
      <MarkFollowedUpButton
        className={styles.markBtn}
        label={f.markLabel}
        doneToday={f.doneToday}
        dimmed={f.doneToday && !f.hasUpdate}
        disabled={f.fieldDate === 'invalid'}
        {...f.followUpTipProps}
        adornment={compact ? <ChevronRightIcon /> : <><ChevronRightIcon /> ⏎</>}
        onClick={f.followUp}
      />
      {f.followUpTip}
      {followup && <div className={styles.footerSteps} data-review-steps="">{steps}</div>}
    </footer>
  )
}

/** How many of a task's status updates the medium face shows (the latest ones). */
const COMPACT_UPDATES = 2

/**
 * The review card's essentials (the Review widget's medium face, item 12;
 * board BM): the box and title, a one-line summary of the
 * facts (due, status, priority, next and last follow-up), then the **updates
 * dock** — the Status updates heading (with the count once there is an
 * entry), the latest two entries oldest first (read-only: Open card ↗ edits
 * them), the update line (⏎ follows up) and the Next row (the field and the
 * quick intervals, as the card's) — and the footer; Open card ↗ opens the
 * task in its editor (where Last is edited). In a short cell the older
 * entry, the log, the heading, then the Next row give way
 * (`Review.module.css`); the update line and the footer stay.
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
  const selectOnFocus = useSelectAllOnFocus()
  useFocusUpdateLineOnOpen(updateRef, focusOnOpen)
  const taskMenu = useReviewTaskMenu()
  const { today } = f
  const summary = markerSummary(todo, today, urgentRange)
  const dues = dueState(todo, today, urgentRange)

  // `bar`: the planned day's hollow bar before the text.
  const facts: { key: string; text: string; tone?: string; bar?: boolean }[] = []
  if (todo.dueDate) facts.push({ key: 'due', text: `Due ${formatRowDate(todo.dueDate, today, rowDates)}`, tone: dues.past || dues.soon ? 'due' : undefined })
  if (status) facts.push({ key: 'status', text: status.name })
  const markers = (['focus', 'urgent', 'important'] as const).filter((k) => summary[k])
  if (markers.length > 0) facts.push({ key: 'priority', text: markers.map((k) => MARKER_LABELS[k]).join(' + ') })
  // The planned day, after the priority: in the deadline color while it falls after a real date (the Planned cell's conflict).
  const planned = plannerPlannedDay(todo)
  if (planned) {
    const late = planned.getTime() >= today.getTime() && plannerConflicts(todo, planned, today).length > 0
    facts.push({ key: 'planned', text: `Planned ${formatRowDate(planned, today, rowDates)}`, tone: late ? 'due' : undefined, bar: true })
  }
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
          <div className={styles.compactTop} onContextMenu={taskMenu.onContextMenu(todoId)}>
            <RowCheckbox
              summary={summary}
              checked={todo.isCompleted}
              onChange={toggleComplete}
              aria-label={todo.isCompleted ? 'Mark incomplete' : 'Mark complete'}
            />
            <ReviewTitleField
              todo={todo}
              compact
              className={`${styles.compactTitle} ${todo.isCompleted ? styles.cardTitleDone : ''}`}
              write={(title) => { void useTodoStore.getState().update(todoId, { title }) }}
            />
          </div>
          {taskMenu.menu(todo)}
          <p className={styles.compactFacts} data-testid="review-facts">
            {facts.map((fact, i) => (
              <span key={fact.key} data-tone={fact.tone} data-fact={fact.key}>
                {i > 0 ? ' · ' : ''}
                {fact.bar && <span className={styles.compactPlanBar} aria-hidden="true" />}
                {fact.text}
              </span>
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
                    data-tooltip={`${formatDateNumeric(entry.date)} ${entry.text}`}
                  >
                    <span className={styles.compactDay}>{formatDateNumeric(entry.date)}</span>
                    <span className={styles.compactText}>{entry.text}</span>
                  </li>
                )
              })}
            </ul>
          )}
          <ReviewUpdateLine followUp={f} inputRef={updateRef} compact />
          <div className={styles.compactNext} data-review-compact-next="">
            <TaskFollowupFields next={reviewNextParts(f, `${headingId}-next`, selectOnFocus)} placement="row" />
          </div>
        </section>
      </div>
      <ReviewFooter followUp={f} compact onOpenCard={() => useUIStore.getState().openEditPopup(todoId)} />
    </>
  )
}

const NO_NOTES = () => Promise.resolve()
