import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NEUTRAL_PERSON_COLOR } from '../../../constants'
import type { MarkerKey, PersistedTodoItem, Person, Status, Tag } from '../../../models'
import { useFollowupInput, NEXT_FOLLOWUP_PLACEHOLDER } from '../../../hooks/use-followup-input'
import { useInlineEdit } from '../../../hooks/use-inline-edit'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import { useSelectAllOnFocus } from '../../../hooks/use-select-all-on-focus'
import type { ConvertLine } from '../../../services/note-lines'
import { draftToTodo, type TaskDraft } from '../../../services/task-draft'
import { startOfDay } from '../../../utils/date'
import { addFollowupInterval, QUICK_FOLLOWUP_INTERVALS } from '../../../utils/followup'
import { generateInitials, personPickerItems, PERSON_PICKER_PLACEHOLDER } from '../../../utils/person'
import { AnchoredPicker } from '../../shared/AnchoredPicker'
import { ChipSelector } from '../../shared/ChipSelector'
import { FollowupDateButton } from '../../shared/followup/FollowupDateButton'
import { FollowupQuickButtons } from '../../shared/followup/FollowupQuickButtons'
import followupStyles from '../../shared/followup/Followup.module.css'
import { PopoverRoot } from '../../shared/PopoverRoot'
import { TagPicker } from '../../shared/TagChipSelector'
import { useTooltip } from '../../shared/use-tooltip'
import { PriorityMenu } from '../PriorityMenu'
import { DatesCell, MarkerGutter, NotesCell, PeopleCell, StatusCell, StatusMenu, TagsCell } from '../row-cells'
import { keepRowTextUnselected } from '../row-events'
import { useTaskRowColumn, useTaskRowTracks } from '../task-row-grid-context'
import rowStyles from '../TaskRow.module.css'
import styles from './NotesConvert.module.css'

export interface PreviewRow {
  key: number
  line: ConvertLine
  draft: TaskDraft
  /** Changed since the note's line was read: closing the preview asks first. */
  edited: boolean
  /** Checked off: no task, and its line goes from the note when the preview is confirmed. */
  checked?: boolean
}

export interface PreviewLookups {
  people: readonly Person[]
  tags: readonly Tag[]
  statuses: readonly Status[]
  /** The next follow-up a task gets by default; `null` = none. */
  defaultFollowup: Date | null
  today: Date
}

/** Ids for people and tags that exist only by name in a draft (created with the task): below every stored id. */
const newEntityId = (index: number): number => -1 - index
const newEntityIndex = (id: number): number => -1 - id

const without = <T,>(list: readonly T[], item: T): T[] => list.filter((x) => x !== item)

/** The draft without `key` (an optional field absent, not undefined). */
function dropping<K extends keyof TaskDraft>(draft: TaskDraft, key: K): TaskDraft {
  const next = { ...draft }
  delete next[key]
  return next
}

/**
 * A draft's next follow-up: a date or an interval, a quick interval, a day
 * from the picker, × for none. Nothing else: a draft has no follow-up to
 * record, so no Mark followed up and no status line. A date set closes it;
 * however it closes, a date typed sticks. Text that isn't a date holds the
 * close once, saying so.
 */
function DraftFollowupPopover({ value, today, anchorRef, onSet, onClose }: {
  value: Date | undefined
  today: Date
  anchorRef: React.RefObject<HTMLElement | null>
  onSet: (date: Date | null) => void
  onClose: () => void
}) {
  const input = useFollowupInput(value, 'next', today)
  const [closeHeld, setCloseHeld] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectOnFocus = useSelectAllOnFocus()
  const s = input.state
  const { panelRef, style, caret } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: anchorRef },
    open: true,
    caret: true,
    consumeEscape: true,
    closeOnScroll: 'user',
    onClose: () => {
      if (s.kind === 'invalid' && !closeHeld) setCloseHeld(true)
      else onClose()
    },
  })
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  // Set and closed in one batch: the popover unmounts before rendering the
  // settled field, so the close's save would read the date typed before and
  // write it over the pick.
  const committed = useRef(false)
  const set = (date: Date | null) => {
    committed.current = true
    input.settle(date)
    onSet(date)
    onClose()
  }
  const saveOnCloseRef = useLatestRef(() => {
    if (committed.current) return
    if (s.kind === 'valid') onSet(s.date)
    else if (s.kind === 'empty' && value) onSet(null)
  })
  // In the commit that closes it, so a click right behind the closing press (Create) reads the result.
  useLayoutEffect(() => () => saveOnCloseRef.current(), [saveOnCloseRef])
  return createPortal(
    <PopoverRoot
      ref={panelRef}
      caret={caret}
      className={followupStyles.popover}
      // Above the preview, a dialog on a higher tier than the row popovers' own.
      style={{ position: style.position, left: style.left, top: style.top, zIndex: 'var(--z-dialog-nested)' }}
      role="dialog"
      aria-label="Next follow-up"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <label className={followupStyles.fieldLabel}>
        Next follow-up
        <div className={`${followupStyles.inputWrap} ${s.kind === 'invalid' ? followupStyles.inputWrapError : ''}`}>
          <input
            ref={inputRef}
            className={followupStyles.input}
            value={input.text}
            placeholder={NEXT_FOLLOWUP_PLACEHOLDER}
            aria-invalid={s.kind === 'invalid'}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => { setCloseHeld(false); input.change(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              if (s.kind === 'valid') set(s.date)
              else if (s.kind === 'empty') set(null)
              else if (s.kind === 'unchanged') onClose()
            }}
            {...selectOnFocus}
          />
          {input.text !== '' && (
            <button type="button" className={followupStyles.inputClear} aria-label="Clear next follow-up" title="Clear the date" onClick={() => set(null)}>
              &times;
            </button>
          )}
          <FollowupDateButton label="Pick next follow-up date" value={s.kind === 'valid' ? s.date : value} onPick={set} />
        </div>
      </label>
      {s.kind === 'invalid' && (
        <div className={followupStyles.help}>
          <span className={followupStyles.helpError}>{closeHeld ? `${s.message} · close again to discard it` : s.message}</span>
        </div>
      )}
      <FollowupQuickButtons intervals={QUICK_FOLLOWUP_INTERVALS} labelStyle="long" onPick={(i) => set(addFollowupInterval(today, i))} />
    </PopoverRoot>,
    document.body,
  )
}

/**
 * One draft in the convert preview, on a task row's columns and cells (the
 * shared `row-cells`, inside the preview's `TaskRowGrid`), its changes going
 * to the draft through `onChange`: nothing is stored until the preview is
 * confirmed. A click on the title renames it; a double-click on the title or
 * empty space opens the full editor (`onEdit`). The dashed square checks the
 * draft off, × (outside the columns) drops it, leaving its line in the note.
 */
export function DraftTaskRow({ row, lookups, onChange, onCheck, onEdit, onRemove, rowRef }: {
  row: PreviewRow
  lookups: PreviewLookups
  onChange: (draft: TaskDraft) => void
  onCheck: (checked: boolean) => void
  onEdit: () => void
  onRemove: () => void
  rowRef: (el: HTMLLIElement | null) => void
}) {
  const { draft } = row
  const { people, tags, statuses, defaultFollowup, today } = lookups
  const checked = row.checked === true
  const hasPeople = useTaskRowColumn((c) => c.people > 0)
  const hasTags = useTaskRowColumn((c) => c.tags > 0)
  const gridRef = useRef<HTMLDivElement>(null)
  useTaskRowTracks(gridRef)
  const [open, setOpen] = useState<'markers' | 'people' | 'tags' | 'status' | 'followup' | null>(null)
  const close = () => setOpen(null)
  const toggle = (which: NonNullable<typeof open>) => setOpen((v) => (v === which ? null : which))
  const markersRef = useRef<HTMLButtonElement>(null)
  const notesRef = useRef<HTMLButtonElement>(null)
  const peopleRef = useRef<HTMLElement>(null)
  const tagsRef = useRef<HTMLButtonElement>(null)
  const dueRef = useRef<HTMLInputElement>(null)
  const followupRef = useRef<HTMLButtonElement>(null)
  const statusRef = useRef<HTMLButtonElement>(null)

  // The row's cells read a task: the one this draft would make.
  const todo = useMemo<PersistedTodoItem>(() => ({
    ...draftToTodo(draft, today, defaultFollowup ?? undefined),
    id: -1 - row.key,
    uid: `draft-${row.key}`,
    sortOrder: row.key,
    isCompleted: checked,
  }), [draft, today, defaultFollowup, row.key, checked])

  const newPeople = useMemo<Person[]>(() => draft.newPeople.map((name, i) => ({
    id: newEntityId(i),
    name,
    initials: generateInitials(name),
    color: NEUTRAL_PERSON_COLOR,
  })), [draft.newPeople])
  const assignedPeople = useMemo(
    () => [...draft.personIds.flatMap((id) => people.find((p) => p.id === id) ?? []), ...newPeople],
    [draft.personIds, people, newPeople],
  )
  const newTags = useMemo<Tag[]>(() => draft.newTags.map((name, i) => ({ id: newEntityId(i), name, color: NEUTRAL_PERSON_COLOR })), [draft.newTags])
  const assignedTags = useMemo(
    () => [...draft.tagIds.flatMap((id) => tags.find((t) => t.id === id) ?? []), ...newTags],
    [draft.tagIds, tags, newTags],
  )

  const togglePerson = (id: number) => {
    if (id < 0) onChange({ ...draft, newPeople: draft.newPeople.filter((_, i) => i !== newEntityIndex(id)) })
    else onChange({ ...draft, personIds: draft.personIds.includes(id) ? without(draft.personIds, id) : [...draft.personIds, id] })
  }
  const toggleTag = (id: number) => {
    if (id < 0) onChange({ ...draft, newTags: draft.newTags.filter((_, i) => i !== newEntityIndex(id)) })
    else onChange({ ...draft, tagIds: draft.tagIds.includes(id) ? without(draft.tagIds, id) : [...draft.tagIds, id] })
  }
  const addNewName = (list: readonly string[], name: string): string[] => {
    const clean = name.trim()
    return clean === '' || list.some((n) => n.toLowerCase() === clean.toLowerCase()) ? [...list] : [...list, clean]
  }
  const setMarker = (marker: MarkerKey, on: boolean) => onChange({ ...draft, [marker]: on })

  const {
    isEditing, editTitle, setEditTitle, inputRef: titleInputRef,
    save: saveTitle, handleKeyDown: handleTitleKeyDown, scheduleEdit, cancelScheduledEdit,
  } = useInlineEdit(draft.title, (title) => onChange({ ...draft, title }))
  const { triggerProps: lineTip, tooltip: lineTooltip } = useTooltip(`From line ${row.line.line}\n${row.line.text.trim()}`)

  const nextFollowup = draft.nextFollowupAt === undefined ? (defaultFollowup ?? undefined) : (draft.nextFollowupAt ?? undefined)
  const openDuePicker = () => {
    setTimeout(() => {
      try { dueRef.current?.showPicker?.() } catch { dueRef.current?.focus() }
    }, 0)
  }

  return (
    <li ref={rowRef} className={styles.item} tabIndex={0} data-draft-row data-checked={checked || undefined} aria-label={draft.title}>
      <div
        ref={gridRef}
        className={`${rowStyles.row} ${styles.draftRow} ${checked ? rowStyles.completed : ''} ${open ? rowStyles.rowDropdownOpen : ''}`}
        onMouseDown={keepRowTextUnselected}
        onDoubleClick={(e) => {
          // A double-click on a cell opened its picker (once); only the title and empty space open the editor.
          if (e.target instanceof Element && e.target.closest('[data-row-cell]')) return
          cancelScheduledEdit()
          if (!isEditing) onEdit()
        }}
      >
        <MarkerGutter todo={todo} today={today} anchorRef={markersRef} open={open === 'markers'} onToggle={() => toggle('markers')} />

        <span className={rowStyles.checkWrap}>
          <input
            type="checkbox"
            className={`${rowStyles.checkbox} ${styles.draftCheck}`}
            checked={checked}
            onChange={(e) => onCheck(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            aria-label={checked ? `Keep "${draft.title}"` : `Done: remove "${draft.title}" from the note`}
            title={checked ? 'Keep this draft' : 'Done: no task, the line goes from the note when you confirm'}
            data-row-cell="checkbox"
          />
          <svg className={rowStyles.checkMark} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M3.5 8.5l3 3 6-7" pathLength={1} />
          </svg>
        </span>

        {isEditing ? (
          <input
            ref={titleInputRef}
            className={rowStyles.titleInput}
            value={editTitle}
            maxLength={500}
            aria-label="Draft title"
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              // Esc ends the rename: the dialog's own Esc skips a handled key.
              if (e.key === 'Escape') e.preventDefault()
              handleTitleKeyDown(e)
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className={`${rowStyles.title} ${checked ? rowStyles.completedTitle : ''}`}
            data-task-title={draft.title}
            onClick={(e) => { if (e.detail === 1) scheduleEdit() }}
            onPointerEnter={lineTip.onPointerEnter}
            onPointerLeave={lineTip.onPointerLeave}
            onPointerDown={lineTip.onPointerDown}
          >
            <span className={rowStyles.titleText} data-title-text="">{draft.title}</span>
            {lineTooltip}
          </span>
        )}

        <NotesCell update={draft.statusUpdates?.at(0)} notes={draft.notes} anchorRef={notesRef} open={false} onToggle={onEdit} />
        {hasPeople && <PeopleCell people={assignedPeople} anchorRef={peopleRef} open={open === 'people'} onToggle={() => toggle('people')} />}
        {hasTags && <TagsCell tags={assignedTags} anchorRef={tagsRef} open={open === 'tags'} onToggle={() => toggle('tags')} />}
        <DatesCell
          todo={todo}
          today={today}
          deadlineInputRef={dueRef}
          onOpenDue={openDuePicker}
          onClearDue={() => onChange(dropping(draft, 'dueDate'))}
          onDueInputChange={(e) => {
            const raw = e.target.value
            onChange(raw ? { ...draft, dueDate: startOfDay(new Date(`${raw}T00:00:00`)) } : dropping(draft, 'dueDate'))
          }}
          followupAnchorRef={followupRef}
          followupOpen={open === 'followup'}
          onToggleFollowup={() => toggle('followup')}
          onClearFollowup={() => onChange({ ...draft, nextFollowupAt: null })}
        />
        <StatusCell status={statuses.find((s) => s.id === draft.statusId)} anchorRef={statusRef} open={open === 'status'} onToggle={() => toggle('status')} />

        {open === 'markers' && (
          <PriorityMenu todo={todo} anchorRef={markersRef} onSetMarker={setMarker} onClose={close} />
        )}
        {open === 'people' && (
          <AnchoredPicker anchorRef={peopleRef} onClose={close}>
            <div className={rowStyles.chipDropdown}>
              <ChipSelector
                items={[...personPickerItems(people), ...personPickerItems(newPeople)]}
                selectedIds={new Set(assignedPeople.map((p) => p.id ?? 0))}
                onToggle={togglePerson}
                onCreate={(name) => onChange({ ...draft, newPeople: addNewName(draft.newPeople, name) })}
                onClose={close}
                avatars
                placeholder={PERSON_PICKER_PLACEHOLDER}
              />
            </div>
          </AnchoredPicker>
        )}
        {open === 'tags' && (
          <TagPicker
            anchorRef={tagsRef}
            assignedTags={assignedTags}
            allTags={[...tags, ...newTags]}
            onToggle={toggleTag}
            onCreate={(name) => onChange({ ...draft, newTags: addNewName(draft.newTags, name) })}
            onClose={close}
          />
        )}
        {open === 'status' && (
          <AnchoredPicker anchorRef={statusRef} onClose={close} closeOnEscape>
            <StatusMenu
              statuses={statuses}
              statusId={draft.statusId}
              onPick={(statusId) => {
                onChange(statusId === undefined ? dropping(draft, 'statusId') : { ...draft, statusId })
                close()
              }}
            />
          </AnchoredPicker>
        )}
        {open === 'followup' && (
          <DraftFollowupPopover
            value={nextFollowup}
            today={today}
            anchorRef={followupRef}
            onSet={(date) => onChange({ ...draft, nextFollowupAt: date })}
            onClose={close}
          />
        )}
      </div>

      <div className={styles.rowActions}>
        <button
          type="button"
          className={`${styles.iconBtn} ${styles.editBtn}`}
          aria-label={`Edit "${draft.title}"`}
          title="Edit every detail"
          tabIndex={-1}
          onClick={onEdit}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.5 2.5l3 3L6 13H3v-3l7.5-7.5z" />
          </svg>
        </button>
        <button
          type="button"
          className={`${styles.iconBtn} ${styles.removeBtn}`}
          aria-label={`Remove "${draft.title}"`}
          title="Leave this line out: it stays in the note"
          tabIndex={-1}
          onClick={onRemove}
        >
          ×
        </button>
      </div>

      {draft.subtasks && draft.subtasks.length > 0 && (
        <ul className={styles.subtaskLines} aria-label={`Subtasks of ${draft.title}`}>
          {draft.subtasks.map((s, i) => (
            <li key={i} data-done={s.isCompleted ? '' : undefined}>{s.isCompleted ? '☑' : '☐'} {s.title}</li>
          ))}
        </ul>
      )}
    </li>
  )
}
