import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { STATUS_UPDATE_TEXT_MAX } from '../../../models'
import { useStatusUpdateDay } from '../../../hooks/use-status-update-day'
import { useToday } from '../../../hooks/use-today'
import { formatDateNumeric } from '../../../utils/date'
import { statusUpdateText } from '../../../utils/status-updates'
import { PencilIcon, TrashIcon } from '../../shared/icons'
import { StatusUpdateDayField } from './StatusUpdateDayField'
import styles from './StatusUpdates.module.css'

/** An entry as the section shows it: a stored one (its id) or one waiting for Create (a local key). */
export interface StatusUpdateEntry {
  id: number
  date: Date
  text: string
}

/** A new or edited entry's day and text (one trimmed line). */
export interface StatusUpdateFields {
  date: Date
  text: string
}

/** The add line's placeholder (the task editor's and the review card's alike). */
const STATUS_UPDATE_ADD_PLACEHOLDER = 'What’s the latest?'

/**
 * The task layout's **Status updates** (boards BJ, BL — the task editor
 * and the review card, in the writing's dock): the label — always shown,
 * the count beside it once there is an entry —, then every entry **oldest
 * first**, like a log, one line each `MM/DD text` (the newest — the last —
 * in the primary colour), then the **add line**. The list grows to its
 * limit, then scrolls inside, opening scrolled to the bottom (and going
 * back there as an entry is added). Hover or focus shows an entry's edit
 * and delete; a click on its text edits too. Editing puts the day and text
 * fields in its place — ⏎ saves, Esc cancels (and is the entry's, not the
 * editor's). Delete asks nothing: the store's undo snackbar takes it back.
 * What the callbacks write is the host's (the store in edit mode, the
 * pending entries in create mode).
 *
 * The add line (`AddUpdateLine`): type, ⏎ adds the entry dated today
 * (the host's `onAdd`: `addStatusUpdate`'s rules in edit mode). Its text
 * sticks: the section going away (the editor closed, by Esc or a press
 * outside) adds what was typed. A host with its own line (the review card:
 * ⏎ records the update with the follow-up) passes it as `addLine`.
 *
 * `commitRef` (create mode): the host's way to write an entry still being
 * edited, or an update still being typed, before it reads its entries —
 * Create task / ⏎ / Save draft, and the close's "anything to lose?" check,
 * run before the open field unmounts.
 */
export function StatusUpdatesSection({ entries, onAdd, onEdit, onRemove, className, labelClassName, commitRef, addLine }: {
  /** Newest first (the store's order); shown oldest first. */
  entries: readonly StatusUpdateEntry[]
  onAdd: (entry: StatusUpdateFields) => void
  onEdit: (id: number, changes: StatusUpdateFields) => void
  onRemove: (id: number) => void
  className?: string
  labelClassName?: string
  commitRef?: { current: (() => void) | null }
  /** The host's own add line, in place of the default one. */
  addLine?: ReactNode
}) {
  const today = useToday()
  // The open edit's / add line's commit, for `commitRef`.
  const openCommits = useRef(new Set<() => void>())
  useLayoutEffect(() => {
    if (!commitRef) return
    const commit = () => { for (const c of [...openCommits.current]) c() }
    commitRef.current = commit
    return () => { if (commitRef.current === commit) commitRef.current = null }
  }, [commitRef])
  const registerCommit = useCallback((commit: () => void) => {
    openCommits.current.add(commit)
    return () => { openCommits.current.delete(commit) }
  }, [])
  const labelId = useId()
  const [editingId, setEditingId] = useState<number | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const addLineRef = useRef<HTMLDivElement>(null)
  // Each entry's edit button, to hand the focus back to after an edit or a delete.
  const editButtons = useRef(new Map<number, HTMLButtonElement>())
  const focusAfter = useRef<number | 'add' | null>(null)

  useEffect(() => {
    const target = focusAfter.current
    if (target === null || editingId !== null) return
    focusAfter.current = null
    if (target === 'add') addLineRef.current?.querySelector('input')?.focus({ preventScroll: true })
    else editButtons.current.get(target)?.focus()
  })

  // Oldest first: the store's order reversed.
  const shown = entries.toReversed()

  // Opens scrolled to the bottom (the newest), and goes back there as an entry is added.
  const count = entries.length
  const shownCount = useRef(-1)
  useLayoutEffect(() => {
    const list = listRef.current
    if (list && count > shownCount.current) list.scrollTop = list.scrollHeight
    shownCount.current = count
  }, [count])

  const remove = (id: number) => {
    const at = shown.findIndex((e) => e.id === id)
    const next = shown[at + 1] ?? shown[at - 1]
    focusAfter.current = next ? next.id : 'add'
    onRemove(id)
  }

  const finishEdit = (id: number) => {
    focusAfter.current = id
    setEditingId(null)
  }

  const renderEntry = (entry: StatusUpdateEntry, newest: boolean) => (
    <li
      key={entry.id}
      className={`${styles.entry} ${newest ? styles.entryNewest : ''}`}
      data-status-update=""
      data-newest={newest ? 'true' : undefined}
    >
      {editingId === entry.id ? (
        <EntryEditor
          entry={entry}
          today={today}
          onSave={(changes) => { onEdit(entry.id, changes); finishEdit(entry.id) }}
          onSaveOnClose={(changes) => onEdit(entry.id, changes)}
          onCancel={() => finishEdit(entry.id)}
          registerCommit={registerCommit}
        />
      ) : (
        <>
          {/* A click on the text edits; the keyboard has the edit button. */}
          <button type="button" className={styles.entryText} tabIndex={-1} onClick={() => setEditingId(entry.id)}>
            <span className={styles.entryDate}>{formatDateNumeric(entry.date)}</span>
            <span className={styles.entryBody}>{entry.text}</span>
          </button>
          <span className={styles.entryActions}>
            <button
              type="button"
              ref={(el) => { if (el) editButtons.current.set(entry.id, el); else editButtons.current.delete(entry.id) }}
              className={styles.iconButton}
              aria-label={`Edit status update: ${formatDateNumeric(entry.date)} ${entry.text}`}
              title="Edit"
              onClick={() => setEditingId(entry.id)}
            >
              <PencilIcon size={13} />
            </button>
            <button
              type="button"
              className={`${styles.iconButton} ${styles.iconButtonDanger}`}
              aria-label={`Delete status update: ${formatDateNumeric(entry.date)} ${entry.text}`}
              title="Delete"
              onClick={() => remove(entry.id)}
            >
              <TrashIcon size={13} />
            </button>
          </span>
        </>
      )}
    </li>
  )

  return (
    <section className={className} aria-labelledby={labelId} data-status-updates="" data-empty={entries.length === 0 || undefined}>
      <div className={styles.headingRow}>
        {/* Always shown (board BL): without it an empty section read as gone. */}
        <div className={`${labelClassName ?? ''} ${styles.heading}`} id={labelId}>
          Status updates
          {entries.length > 0 && <span className={styles.count} data-status-update-count="">{entries.length}</span>}
        </div>
      </div>
      {entries.length > 0 && (
        <ul ref={listRef} className={styles.list} aria-label="Status updates" data-status-update-list="">
          {shown.map((e, i) => renderEntry(e, i === shown.length - 1))}
        </ul>
      )}
      <div ref={addLineRef} className={styles.addLine}>
        {addLine ?? <AddUpdateLine today={today} onAdd={onAdd} registerCommit={registerCommit} />}
      </div>
    </section>
  )
}

/**
 * The default add line: the update's text; ⏎ adds it dated today and
 * clears the line for the next. What was typed and not added sticks: the
 * line going away (the editor closed) adds it, and so does the host's
 * commit (create mode: Create task, the close check).
 */
function AddUpdateLine({ today, onAdd, registerCommit }: {
  today: Date
  onAdd: (entry: StatusUpdateFields) => void
  registerCommit: (commit: () => void) => () => void
}) {
  const [text, setTextState] = useState('')
  // Also a ref: read as the line goes, and written with the state, so nothing adds twice.
  const textRef = useRef('')
  const setText = (next: string) => {
    textRef.current = next
    setTextState(next)
  }
  const addRef = useLatestRef(() => {
    const clean = statusUpdateText(textRef.current)
    if (clean === '') return
    textRef.current = ''
    onAdd({ date: today, text: clean })
    setTextState('')
  })
  // In the commit that closes it, so a click right behind the closing press (Create) reads the result.
  useLayoutEffect(() => () => addRef.current(), [addRef])
  useLayoutEffect(() => registerCommit(() => addRef.current()), [registerCommit, addRef])
  return (
    <input
      className={styles.textInput}
      value={text}
      maxLength={STATUS_UPDATE_TEXT_MAX}
      placeholder={STATUS_UPDATE_ADD_PLACEHOLDER}
      aria-label="New status update"
      autoComplete="off"
      data-status-update-add=""
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
        e.preventDefault()
        if (!e.repeat) addRef.current()
      }}
    />
  )
}

/**
 * An entry being edited, in its place: its text, then its day with Cancel /
 * Save. Esc and Cancel drop the edit; the editor closing around it saves it
 * (a day that isn't one: the text, on the day it had).
 */
function EntryEditor({ entry, today, onSave, onSaveOnClose, onCancel, registerCommit }: {
  entry: StatusUpdateEntry
  today: Date
  onSave: (changes: StatusUpdateFields) => void
  onSaveOnClose: (changes: StatusUpdateFields) => void
  onCancel: () => void
  registerCommit: (commit: () => void) => () => void
}) {
  // Saved or cancelled: nothing left to save as it goes.
  const finished = useRef(false)
  const [text, setText] = useState(entry.text)
  const day = useStatusUpdateDay(entry.date, today)
  const textRef = useRef<HTMLInputElement>(null)
  useEffect(() => { textRef.current?.focus() }, [])
  const clean = statusUpdateText(text)
  const canSave = clean !== '' && day.day !== 'invalid'
  const save = () => {
    if (canSave && day.day !== 'invalid') {
      finished.current = true
      onSave({ date: day.day, text: clean })
    }
  }
  const cancel = () => {
    finished.current = true
    onCancel()
  }
  const saveOnCloseRef = useLatestRef(() => {
    if (finished.current || clean === '') return
    const date = day.day === 'invalid' ? entry.date : day.day
    if (clean !== entry.text || date.getTime() !== entry.date.getTime()) onSaveOnClose({ date, text: clean })
  })
  // In the commit that closes it, so a click right behind the closing press (Create) reads the result.
  useLayoutEffect(() => () => saveOnCloseRef.current(), [saveOnCloseRef])
  // The host reading its entries first (`commitRef`): the edit so far (saving it again on close writes the same).
  useLayoutEffect(() => registerCommit(() => saveOnCloseRef.current()), [registerCommit, saveOnCloseRef])
  return (
    <div
      className={styles.editRow}
      // Esc cancels the edit here — before the editor's frame, which would close.
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        e.stopPropagation()
        cancel()
      }}
    >
      <input
        ref={textRef}
        className={styles.textInput}
        value={text}
        maxLength={STATUS_UPDATE_TEXT_MAX}
        aria-label="Status update"
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
          e.preventDefault()
          save()
        }}
      />
      <div className={styles.dayRow}>
        <StatusUpdateDayField input={day} label="Status update’s day" today={today} onEnter={save} />
        <button type="button" className={styles.cancelButton} onClick={cancel}>Cancel</button>
        <button type="button" className={styles.saveButton} onClick={save} disabled={!canSave}>Save</button>
      </div>
    </div>
  )
}
