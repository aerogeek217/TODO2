import { useEffect, useState } from 'react'
import { usePersonStore } from '../../stores/person-store'
import { personRepository } from '../../data'
import { generateInitials } from '../../utils/person'
import { ColorInput } from '../shared/ColorInput'
import { ConfirmDialog } from '../shared/Dialog'
import type { Person } from '../../models'
import { NEUTRAL_PERSON_COLOR } from '../../constants'
import styles from './EntityEditor.module.css'

interface PersonEditState {
  id: number
  name: string
  initials: string
  /** Undefined = no color (neutral avatar). */
  color: string | undefined
}

interface PeopleEditorProps {
  onClose: () => void
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

function withColor(person: Omit<Person, 'color'>, color: string | undefined): Person {
  return color ? { ...person, color } : person
}

export function PeopleEditor({ onClose }: PeopleEditorProps) {
  const { people, load: loadPeople, add: addPerson, update: updatePerson, remove: removePerson } = usePersonStore()

  const [editing, setEditing] = useState<PersonEditState | null>(null)
  const [editInitialsManual, setEditInitialsManual] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newInitials, setNewInitials] = useState('')
  const [newInitialsManual, setNewInitialsManual] = useState(false)
  const [newColor, setNewColor] = useState<string | undefined>(undefined)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleteCount, setDeleteCount] = useState(0)
  const [searchText, setSearchText] = useState('')
  const [nameError, setNameError] = useState('')

  useEffect(() => { loadPeople() }, [loadPeople])

  const clearState = () => {
    setEditing(null)
    setAdding(false)
    setDeleteId(null)
    setNameError('')
  }

  // --- Person CRUD ---

  const startEditPerson = (p: Person) => {
    clearState()
    setEditing({ id: p.id!, name: p.name, initials: p.initials, color: p.color })
    setEditInitialsManual(true) // existing person already has initials, treat as manual until changed
  }

  const saveEditPerson = async () => {
    if (!editing || !editing.name.trim()) return
    try {
      await updatePerson(withColor({
        id: editing.id,
        name: editing.name.trim(),
        initials: editing.initials || generateInitials(editing.name),
      }, editing.color))
      setEditing(null)
      setNameError('')
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
  }

  const saveAddPerson = async () => {
    if (!newName.trim()) return
    try {
      await addPerson(newName.trim(), newInitials || generateInitials(newName), newColor)
      setAdding(false)
      setNameError('')
    } catch (e) {
      setNameError((e as Error).message)
    }
  }

  const startDeletePerson = async (id: number) => {
    clearState()
    setDeleteId(id)
    const count = await personRepository.getTodoCountForPerson(id)
    setDeleteCount(count)
  }

  const confirmDeletePerson = async () => {
    if (deleteId == null) return
    await removePerson(deleteId)
    setDeleteId(null)
  }

  const handleKeyDown = (save: () => void, cancel: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') cancel()
  }

  // --- Person row ---

  const renderPersonRow = (p: Person) => {
    if (editing && editing.id === p.id) {
      const ed = editing
      return (
        <div key={p.id}>
          <div className={styles.editRow} onKeyDown={handleKeyDown(saveEditPerson, () => { setEditing(null); setNameError('') })}>
            <PersonColorField color={ed.color} onChange={(color) => setEditing({ ...ed, color })} />
            <input className={styles.editInput} value={ed.name} onChange={(e) => { const name = e.target.value; setEditing({ ...ed, name, ...(!editInitialsManual ? { initials: generateInitials(name) } : {}) }); setNameError('') }} placeholder="Name" autoFocus />
            <input className={styles.editInputSmall} value={ed.initials} onChange={(e) => { setEditInitialsManual(true); setEditing({ ...ed, initials: e.target.value.toUpperCase().slice(0, 2) }) }} placeholder="AB" />
            <div className={styles.editActions}>
              <button className={styles.saveBtn} onClick={saveEditPerson}>Save</button>
              <button className={styles.cancelBtn} onClick={() => { setEditing(null); setNameError('') }}>Cancel</button>
            </div>
          </div>
          {nameError && <div className={styles.errorHint}>{nameError}</div>}
        </div>
      )
    }

    return (
      <div key={p.id} className={styles.row}>
        <div className={styles.colorSwatch} style={{ background: p.color ?? NEUTRAL_PERSON_COLOR }} onClick={() => startEditPerson(p)} />
        <span className={styles.nameEditable} onClick={() => startEditPerson(p)}>{p.name}</span>
        <span className={styles.initials}>{p.initials}</span>
        <div className={styles.actions}>
          <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => startDeletePerson(p.id!)} title="Delete">&times;</button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>People</div>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

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
            const sorted = filtered.toSorted((a, b) => a.name.localeCompare(b.name))

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
              <div className={styles.editRow} onKeyDown={handleKeyDown(saveAddPerson, () => { setAdding(false); setNameError('') })}>
                <PersonColorField color={newColor} onChange={setNewColor} />
                <input className={styles.editInput} value={newName} onChange={(e) => { setNewName(e.target.value); if (!newInitialsManual) setNewInitials(generateInitials(e.target.value)); setNameError('') }} placeholder="Name" autoFocus />
                <input className={styles.editInputSmall} value={newInitials} onChange={(e) => { setNewInitialsManual(true); setNewInitials(e.target.value.toUpperCase().slice(0, 2)) }} placeholder="AB" />
                <div className={styles.editActions}>
                  <button className={styles.saveBtn} onClick={saveAddPerson}>Add</button>
                  <button className={styles.cancelBtn} onClick={() => { setAdding(false); setNameError('') }}>Cancel</button>
                </div>
              </div>
              {nameError && <div className={styles.errorHint}>{nameError}</div>}
            </div>
          )}
          {!adding && (
            <button className={styles.addBtn} onClick={startAddPerson}>+ Add Person</button>
          )}
        </div>
      </div>
      {deleteId != null && (() => {
        const target = people.find((p) => p.id === deleteId)
        if (!target) return null
        return (
          <ConfirmDialog
            open
            title="Delete person"
            message={
              <>
                Delete <strong>{target.name}</strong>?
                {deleteCount > 0 && ` Assigned to ${deleteCount} task${deleteCount !== 1 ? 's' : ''}.`}
              </>
            }
            confirmLabel="Delete"
            danger
            onConfirm={confirmDeletePerson}
            onCancel={() => setDeleteId(null)}
          />
        )
      })()}
    </>
  )
}
