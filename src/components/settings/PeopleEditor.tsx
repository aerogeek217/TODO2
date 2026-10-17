import { useEffect, useState } from 'react'
import { usePersonStore } from '../../stores/person-store'
import { generateInitials, isValidEmail, PERSON_EMAIL_MAX, withEmail } from '../../utils/person'
import { ColorInput } from '../shared/ColorInput'
import { DeletePersonConfirm } from './EntityDeleteConfirm'
import type { Person } from '../../models'
import { NEUTRAL_PERSON_COLOR } from '../../constants'
import styles from './EntityEditor.module.css'
import { EditorModal } from './EditorModal'
import { byName } from '../../utils/sort-order'

interface PersonEditState {
  id: number
  name: string
  initials: string
  /** Undefined = no color (neutral avatar). */
  color: string | undefined
  /** As typed; saved trimmed, empty = no email. */
  email: string
}

const EMAIL_SHAPE_ERROR = "Doesn't look like an email address"

/** Whether a typed email can be saved: empty, or shaped like an address. */
function emailOk(value: string): boolean {
  return value.trim() === '' || isValidEmail(value)
}

interface EmailFieldProps {
  value: string
  onChange: (value: string) => void
  /** Show the shape error (after the field was left or a save was tried). */
  showError: boolean
  onBlur: () => void
  errorId: string
  autoFocus?: boolean
}

/** The optional email input; the shape error shows under the row. */
function EmailField({ value, onChange, showError, onBlur, errorId, autoFocus }: EmailFieldProps) {
  const invalid = showError && !emailOk(value)
  return (
    <input
      type="email"
      className={styles.editInputEmail}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder="Email (optional)"
      aria-label="Email"
      maxLength={PERSON_EMAIL_MAX}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? errorId : undefined}
      autoFocus={autoFocus}
    />
  )
}

interface PeopleEditorProps {
  onClose: () => void
  /**
   * Open straight onto this person's edit row (e.g. "Add email" in the
   * check-in dialog, a task row's avatar menu › Edit…).
   */
  editPersonId?: number
  /** The field focused on that row: `email` (default) or `name`. */
  focusField?: 'name' | 'email'
}

/** Color picker plus a clear button; a person without a color shows the neutral swatch. */
function PersonColorField({ color, onChange }: { color: string | undefined; onChange: (color: string | undefined) => void }) {
  return (
    <>
      <ColorInput value={color ?? NEUTRAL_PERSON_COLOR} onChange={onChange} />
      {color && (
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => onChange(undefined)}
          title="Remove color"
          aria-label="Remove color"
        >
          &times;
        </button>
      )}
    </>
  )
}

const EMAIL_ERROR_ID = 'person-email-error'

function withColor(person: Omit<Person, 'color'>, color: string | undefined): Person {
  return color ? { ...person, color } : person
}

export function PeopleEditor({ onClose, editPersonId, focusField = 'email' }: PeopleEditorProps) {
  const { people, load: loadPeople, add: addPerson, update: updatePerson } = usePersonStore()

  const [editing, setEditing] = useState<PersonEditState | null>(null)
  const [editInitialsManual, setEditInitialsManual] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newInitials, setNewInitials] = useState('')
  const [newInitialsManual, setNewInitialsManual] = useState(false)
  const [newColor, setNewColor] = useState<string | undefined>(undefined)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [searchText, setSearchText] = useState('')
  const [nameError, setNameError] = useState('')
  const [newEmail, setNewEmail] = useState('')
  /** The email field was left (or a save was tried): its shape error may show. */
  const [emailTouched, setEmailTouched] = useState(false)

  useEffect(() => { loadPeople() }, [loadPeople])

  // Opened onto one person: edit that row once the person is there.
  const [openedOnto, setOpenedOnto] = useState<number | null>(null)
  const ontoPerson = editPersonId != null && openedOnto !== editPersonId
    ? people.find((p) => p.id === editPersonId)
    : undefined
  if (ontoPerson) {
    setOpenedOnto(editPersonId ?? null)
    setEditing({ id: ontoPerson.id!, name: ontoPerson.name, initials: ontoPerson.initials, color: ontoPerson.color, email: ontoPerson.email ?? '' })
    setEditInitialsManual(true)
  }
  const focusEmail = focusField === 'email' && editPersonId != null && editing?.id === editPersonId

  const clearState = () => {
    setEditing(null)
    setAdding(false)
    setDeleteId(null)
    setNameError('')
    setEmailTouched(false)
  }

  // --- Person CRUD ---

  const startEditPerson = (p: Person) => {
    clearState()
    setEditing({ id: p.id!, name: p.name, initials: p.initials, color: p.color, email: p.email ?? '' })
    setEditInitialsManual(true) // existing person already has initials, treat as manual until changed
  }

  const saveEditPerson = async () => {
    if (!editing || !editing.name.trim()) return
    if (!emailOk(editing.email)) {
      setEmailTouched(true)
      return
    }
    try {
      await updatePerson(withEmail(withColor({
        id: editing.id,
        name: editing.name.trim(),
        initials: editing.initials || generateInitials(editing.name),
      }, editing.color), editing.email))
      setEditing(null)
      setNameError('')
      setEmailTouched(false)
    } catch (e) {
      setNameError((e as Error).message)
    }
  }

  const startAddPerson = () => {
    clearState()
    setAdding(true)
    setNewName('')
    setNewInitials('')
    setNewInitialsManual(false)
    setNewColor(undefined)
    setNewEmail('')
  }

  const saveAddPerson = async () => {
    if (!newName.trim()) return
    if (!emailOk(newEmail)) {
      setEmailTouched(true)
      return
    }
    try {
      await addPerson(newName.trim(), newInitials || generateInitials(newName), newColor, newEmail)
      setAdding(false)
      setNameError('')
      setEmailTouched(false)
    } catch (e) {
      setNameError((e as Error).message)
    }
  }

  const startDeletePerson = (id: number) => {
    clearState()
    setDeleteId(id)
  }

  const handleKeyDown = (save: () => void, cancel: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save()
    // The row's own Esc (cancel the edit): handled, so the modal stays.
    if (e.key === 'Escape') { e.preventDefault(); cancel() }
  }

  // --- Person row ---

  const renderPersonRow = (p: Person) => {
    if (editing && editing.id === p.id) {
      const ed = editing
      return (
        <div key={p.id}>
          <div className={`${styles.editRow} ${styles.editRowWrap}`} onKeyDown={handleKeyDown(saveEditPerson, () => { setEditing(null); setNameError(''); setEmailTouched(false) })}>
            <PersonColorField color={ed.color} onChange={(color) => setEditing({ ...ed, color })} />
            <input className={styles.editInput} value={ed.name} onChange={(e) => { const name = e.target.value; setEditing({ ...ed, name, ...(!editInitialsManual ? { initials: generateInitials(name) } : {}) }); setNameError('') }} placeholder="Name" autoFocus={!focusEmail} />
            <input className={styles.editInputSmall} value={ed.initials} onChange={(e) => { setEditInitialsManual(true); setEditing({ ...ed, initials: e.target.value.toUpperCase().slice(0, 2) }) }} placeholder="AB" />
            <div className={styles.editActions}>
              <button className={styles.saveBtn} onClick={saveEditPerson}>Save</button>
              <button className={styles.cancelBtn} onClick={() => { setEditing(null); setNameError(''); setEmailTouched(false) }}>Cancel</button>
            </div>
            <EmailField
              value={ed.email}
              onChange={(email) => setEditing({ ...ed, email })}
              showError={emailTouched}
              onBlur={() => setEmailTouched(true)}
              errorId={EMAIL_ERROR_ID}
              autoFocus={focusEmail}
            />
          </div>
          {nameError && <div className={styles.errorHint}>{nameError}</div>}
          {emailTouched && !emailOk(ed.email) && <div id={EMAIL_ERROR_ID} className={styles.errorHint}>{EMAIL_SHAPE_ERROR}</div>}
        </div>
      )
    }

    return (
      <div key={p.id} className={styles.row}>
        <div className={styles.colorSwatch} style={{ background: p.color ?? NEUTRAL_PERSON_COLOR }} onClick={() => startEditPerson(p)} />
        <span className={styles.nameEditable} onClick={() => startEditPerson(p)}>{p.name}</span>
        {p.email && <span className={styles.email} title={p.email}>{p.email}</span>}
        <span className={styles.initials}>{p.initials}</span>
        <div className={styles.actions}>
          <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => startDeletePerson(p.id!)} title="Delete">&times;</button>
        </div>
      </div>
    )
  }

  return (
    <>
      <EditorModal title="People" onClose={onClose}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search people..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />

        <div className={styles.list}>
          {(() => {
            const q = searchText.trim().toLowerCase()
            const filtered = q === ''
              ? people
              : people.filter((p) => p.name.toLowerCase().includes(q) || p.initials.toLowerCase().includes(q))
            const sorted = filtered.toSorted(byName)

            return (
              <>
                {people.length === 0 && !adding && (
                  <div className={styles.empty}>No people yet</div>
                )}
                {people.length > 0 && sorted.length === 0 && (
                  <div className={styles.empty}>No matching people</div>
                )}
                {sorted.map(renderPersonRow)}
              </>
            )
          })()}

          {adding && (
            <div>
              <div className={`${styles.editRow} ${styles.editRowWrap}`} onKeyDown={handleKeyDown(saveAddPerson, () => { setAdding(false); setNameError(''); setEmailTouched(false) })}>
                <PersonColorField color={newColor} onChange={setNewColor} />
                <input className={styles.editInput} value={newName} onChange={(e) => { setNewName(e.target.value); if (!newInitialsManual) setNewInitials(generateInitials(e.target.value)); setNameError('') }} placeholder="Name" autoFocus />
                <input className={styles.editInputSmall} value={newInitials} onChange={(e) => { setNewInitialsManual(true); setNewInitials(e.target.value.toUpperCase().slice(0, 2)) }} placeholder="AB" />
                <div className={styles.editActions}>
                  <button className={styles.saveBtn} onClick={saveAddPerson}>Add</button>
                  <button className={styles.cancelBtn} onClick={() => { setAdding(false); setNameError(''); setEmailTouched(false) }}>Cancel</button>
                </div>
                <EmailField
                  value={newEmail}
                  onChange={setNewEmail}
                  showError={emailTouched}
                  onBlur={() => setEmailTouched(true)}
                  errorId={EMAIL_ERROR_ID}
                />
              </div>
              {nameError && <div className={styles.errorHint}>{nameError}</div>}
              {emailTouched && !emailOk(newEmail) && <div id={EMAIL_ERROR_ID} className={styles.errorHint}>{EMAIL_SHAPE_ERROR}</div>}
            </div>
          )}
          {!adding && (
            <button className={styles.addBtn} onClick={startAddPerson}>+ Add Person</button>
          )}
        </div>
      </EditorModal>
      {deleteId != null && <DeletePersonConfirm personId={deleteId} onDone={() => setDeleteId(null)} />}
    </>
  )
}
