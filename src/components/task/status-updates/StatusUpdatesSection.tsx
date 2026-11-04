import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { createPortal } from 'react-dom'
import { STATUS_UPDATE_TEXT_MAX } from '../../../models'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import { useStatusUpdateDay } from '../../../hooks/use-status-update-day'
import { useToday } from '../../../hooks/use-today'
import { formatDateNumeric } from '../../../utils/date'
import { statusUpdateText } from '../../../utils/status-updates'
import { PencilIcon, TrashIcon } from '../../shared/icons'
import { PopoverRoot } from '../../shared/PopoverRoot'
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

/** Entries shown before the `▸ N older updates` disclosure. */
const SHOWN = 3

const STATUS_UPDATE_PLACEHOLDER = 'e.g. waiting on legal, 50% done'

/**
 * The task editor's **Status updates**: the label with the count and an
 * **Add update** button, which opens a popover with the text and its day
 * (words or a date, the calendar button, never after today, empty = today;
 * ⏎ in either, or Add, adds and closes it), then the entries newest first,
 * one line each `MM/DD text` (the newest in the primary colour). Three show; the rest wait behind
 * `▸ N older updates`, which opens them under an "Older" rule (closed again
 * by `▾ Hide older`; closed whenever the editor opens). Hover or focus shows
 * an entry's edit and delete; a click on its text edits too. Editing puts
 * the day and text fields in its place — ⏎ saves, Esc cancels (and is the
 * entry's, not the editor's). Delete asks nothing: the store's undo snackbar
 * takes it back. What the callbacks write is the host's (the store in edit
 * mode, the pending entries in create mode).
 */
export function StatusUpdatesSection({ entries, onAdd, onEdit, onRemove, className, labelClassName }: {
  /** Newest first. */
  entries: readonly StatusUpdateEntry[]
  onAdd: (entry: StatusUpdateFields) => void
  onEdit: (id: number, changes: StatusUpdateFields) => void
  onRemove: (id: number) => void
  className?: string
  labelClassName?: string
}) {
  const today = useToday()
  const labelId = useId()
  const [adding, setAdding] = useState(false)
  const [olderOpen, setOlderOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  // Each entry's edit button, to hand the focus back to after an edit or a delete.
  const editButtons = useRef(new Map<number, HTMLButtonElement>())
  const focusAfter = useRef<number | 'add' | null>(null)

  useEffect(() => {
    const target = focusAfter.current
    if (target === null || editingId !== null) return
    focusAfter.current = null
    if (target === 'add') addButtonRef.current?.focus()
    else editButtons.current.get(target)?.focus()
  })

  // Closed by Add, Cancel or Esc the focus goes back to the button; closed by
  // a press elsewhere it stays where that press put it.
  const closeAdd = () => {
    setAdding(false)
    requestAnimationFrame(() => {
      const active = document.activeElement
      if (!active || active === document.body || !active.isConnected) addButtonRef.current?.focus()
    })
  }

  const remove = (id: number) => {
    const at = entries.findIndex((e) => e.id === id)
    const next = entries[at + 1] ?? entries[at - 1]
    focusAfter.current = next ? next.id : 'add'
    onRemove(id)
  }

  const finishEdit = (id: number) => {
    focusAfter.current = id
    setEditingId(null)
  }

  const older = entries.slice(SHOWN)
  // An entry being edited among the older ones keeps them open.
  const showOlder = olderOpen || older.some((e) => e.id === editingId)

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
    <section className={className} aria-labelledby={labelId} data-status-updates="">
      <div className={styles.headingRow}>
        <div className={`${labelClassName ?? ''} ${styles.heading}`} id={labelId}>
          Status updates
          {entries.length > 0 && <span className={styles.count}>{entries.length}</span>}
        </div>
        <button
          ref={addButtonRef}
          type="button"
          className={styles.addButton}
          aria-haspopup="dialog"
          aria-expanded={adding}
          data-open={adding ? 'true' : undefined}
          onClick={() => (adding ? closeAdd() : setAdding(true))}
        >
          + Add update
        </button>
      </div>
      {adding && (
        <AddUpdatePopover
          anchorRef={addButtonRef}
          today={today}
          onAdd={(entry) => { onAdd(entry); closeAdd() }}
          onAddOnClose={onAdd}
          onClose={closeAdd}
        />
      )}
      {entries.length > 0 && (
        <ul className={styles.list} aria-label="Status updates">
          {entries.slice(0, SHOWN).map((e, i) => renderEntry(e, i === 0))}
          {older.length > 0 && (
            showOlder ? (
              <>
                <li className={styles.olderRule}>
                  <span>Older</span>
                  <span className={styles.ruleLine} />
                  <button type="button" className={styles.olderToggle} aria-expanded="true" onClick={() => setOlderOpen(false)}>
                    ▾ Hide older
                  </button>
                </li>
                {older.map((e) => renderEntry(e, false))}
              </>
            ) : (
              <li className={styles.olderClosed}>
                <button type="button" className={styles.olderToggle} aria-expanded="false" onClick={() => setOlderOpen(true)}>
                  ▸ {older.length} older {older.length === 1 ? 'update' : 'updates'}
                </button>
              </li>
            )
          )}
        </ul>
      )}
    </section>
  )
}

/**
 * The Add update popover, under its button (placed by `usePopoverAnchor`,
 * flipped / clamped, above the editor): the update's text (focused), its day
 * and Cancel / Add. ⏎ in either field adds. Esc (it, not the editor) and an
 * outside click close it and add what was typed; only Cancel drops it. A day
 * that isn't one holds the close once, saying so; closing again drops it.
 */
function AddUpdatePopover({ anchorRef, today, onAdd, onAddOnClose, onClose }: {
  anchorRef: RefObject<HTMLButtonElement | null>
  today: Date
  onAdd: (entry: StatusUpdateFields) => void
  /** Added as it goes: the host's write only, the focus being wherever the close left it. */
  onAddOnClose: (entry: StatusUpdateFields) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [closeHeld, setCloseHeld] = useState(false)
  // Added or cancelled: nothing left to add as it goes.
  const finished = useRef(false)
  const day = useStatusUpdateDay(undefined, today)
  const textRef = useRef<HTMLInputElement>(null)
  const { panelRef, style, caret } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: anchorRef },
    open: true,
    placement: 'bottom-end',
    closeOnScroll: false,
    closeOnResize: false,
    consumeEscape: true,
    observeSize: true,
    onClose: () => {
      if (statusUpdateText(text) !== '' && day.day === 'invalid' && !closeHeld) setCloseHeld(true)
      else onClose()
    },
    caret: true,
  })
  useEffect(() => { textRef.current?.focus() }, [])
  const clean = statusUpdateText(text)
  const canAdd = clean !== '' && day.day !== 'invalid'
  const add = () => {
    if (canAdd && day.day !== 'invalid') {
      finished.current = true
      onAdd({ date: day.day, text: clean })
    }
  }
  const addOnCloseRef = useLatestRef(() => {
    if (!finished.current && canAdd && day.day !== 'invalid') onAddOnClose({ date: day.day, text: clean })
  })
  useEffect(() => () => addOnCloseRef.current(), [addOnCloseRef])
  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    add()
  }
  return createPortal(
    <PopoverRoot
      ref={panelRef}
      caret={caret}
      className={styles.addPopover}
      style={{ position: style.position, left: style.left, top: style.top }}
      role="dialog"
      aria-label="Add a status update"
      // Portaled out of the editor, but React events still bubble to it: keep them here.
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={textRef}
        className={styles.textInput}
        value={text}
        maxLength={STATUS_UPDATE_TEXT_MAX}
        placeholder={STATUS_UPDATE_PLACEHOLDER}
        aria-label="New status update"
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onEnter}
      />
      <div className={styles.dayRow}>
        <StatusUpdateDayField input={day} label="New status update’s day" today={today} onEnter={add} />
      </div>
      {closeHeld && day.day === 'invalid' && <div role="status" className={styles.closeHeld}>Fix the day, or close again to discard this update.</div>}
      <div className={styles.popoverActions}>
        <button type="button" className={styles.cancelButton} onClick={() => { finished.current = true; onClose() }}>Cancel</button>
        <button type="button" className={styles.saveButton} onClick={add} disabled={!canAdd}>Add</button>
      </div>
    </PopoverRoot>,
    document.body,
  )
}

/**
 * An entry being edited, in its place: its text, then its day with Cancel /
 * Save. Esc and Cancel drop the edit; the editor closing around it saves it
 * (a day that isn't one: the text, on the day it had).
 */
function EntryEditor({ entry, today, onSave, onSaveOnClose, onCancel }: {
  entry: StatusUpdateEntry
  today: Date
  onSave: (changes: StatusUpdateFields) => void
  onSaveOnClose: (changes: StatusUpdateFields) => void
  onCancel: () => void
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
  useEffect(() => () => saveOnCloseRef.current(), [saveOnCloseRef])
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
