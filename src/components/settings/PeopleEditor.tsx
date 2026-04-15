import { useEffect, useState, useCallback, useRef } from 'react'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { personRepository, orgRepository } from '../../data'
import { generateInitials } from '../../utils/person'
import { ChipSelector } from '../shared/ChipSelector'
import { useClickOutside } from '../../hooks/use-click-outside'
import type { Person } from '../../models'
import { DEFAULT_ENTITY_COLOR } from '../../constants'
import { ColorInput } from '../shared/ColorInput'
import styles from './EntityEditor.module.css'

interface PersonEditState {
  id: number
  name: string
  initials: string
  color: string
  orgIds: number[]
}

interface PeopleEditorProps {
  onClose: () => void
}

export function PeopleEditor({ onClose }: PeopleEditorProps) {
  const { people, load: loadPeople, add: addPerson, update: updatePerson, remove: removePerson } = usePersonStore()
  const { orgs, load: loadOrgs } = useOrgStore()

  // Person-org map: personId -> orgId[]
  const [personOrgMap, setPersonOrgMap] = useState<Map<number, number[]>>(new Map())

  const loadPersonOrgs = useCallback(async () => {
    const map = await orgRepository.getPersonOrgMap()
    setPersonOrgMap(map)
  }, [])

  const [editing, setEditing] = useState<PersonEditState | null>(null)
  const [editInitialsManual, setEditInitialsManual] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newInitials, setNewInitials] = useState('')
  const [newInitialsManual, setNewInitialsManual] = useState(false)
  const [newColor, setNewColor] = useState(DEFAULT_ENTITY_COLOR)
  const [newOrgIds, setNewOrgIds] = useState<number[]>([])
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleteCount, setDeleteCount] = useState(0)
  const [searchText, setSearchText] = useState('')

  // Org dropdown for person edit/add
  const [showOrgDropdown, setShowOrgDropdown] = useState<'edit' | 'add' | null>(null)
  const orgDropdownRef = useRef<HTMLDivElement>(null)
  useClickOutside(orgDropdownRef, () => setShowOrgDropdown(null), showOrgDropdown !== null)

  useEffect(() => { loadPeople(); loadOrgs(); loadPersonOrgs() }, [loadPeople, loadOrgs, loadPersonOrgs])

  const clearState = () => {
    setEditing(null)
    setAdding(false)
    setDeleteId(null)
    setShowOrgDropdown(null)
  }

  // --- Person CRUD ---

  const startEditPerson = (p: Person) => {
    clearState()
    setEditing({ id: p.id!, name: p.name, initials: p.initials, color: p.color, orgIds: personOrgMap.get(p.id!) ?? [] })
    setEditInitialsManual(true) // existing person already has initials, treat as manual until changed
  }

  const saveEditPerson = async () => {
    if (!editing || !editing.name.trim()) return
    await updatePerson({ id: editing.id, name: editing.name.trim(), initials: editing.initials || generateInitials(editing.name), color: editing.color })
    await orgRepository.setPersonOrgs(editing.id, editing.orgIds)
    await loadPersonOrgs()
    setEditing(null)
  }

  const toggleEditOrg = (orgId: number) => {
    if (!editing) return
    const has = editing.orgIds.includes(orgId)
    setEditing({ ...editing, orgIds: has ? editing.orgIds.filter((id) => id !== orgId) : [...editing.orgIds, orgId] })
  }

  const startAddPerson = () => {
    clearState()
    setAdding(true)
    setNewName('')
    setNewInitials('')
    setNewInitialsManual(false)
    setNewColor(DEFAULT_ENTITY_COLOR)
    setNewOrgIds([])
  }

  const toggleNewOrg = (orgId: number) => {
    setNewOrgIds((prev) => prev.includes(orgId) ? prev.filter((id) => id !== orgId) : [...prev, orgId])
  }

  const saveAddPerson = async () => {
    if (!newName.trim()) return
    const id = await addPerson(newName.trim(), newInitials || generateInitials(newName), newColor)
    if (newOrgIds.length > 0) {
      await orgRepository.setPersonOrgs(id, newOrgIds)
      await loadPersonOrgs()
    }
    setAdding(false)
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

  const orgNames = (personId: number) => {
    const ids = personOrgMap.get(personId)
    if (!ids || ids.length === 0) return undefined
    return ids.map((id) => orgs.find((o) => o.id === id)?.name).filter(Boolean).join(', ')
  }

  const renderOrgSelector = (selectedOrgIds: number[], onToggle: (orgId: number) => void, mode: 'edit' | 'add') => {
    const selectedNames = selectedOrgIds.map((id) => orgs.find((o) => o.id === id)?.name).filter(Boolean)
    return (
      <div className={styles.orgDropdownWrap} ref={showOrgDropdown === mode ? orgDropdownRef : undefined}>
        <button type="button" className={styles.orgToggleBtn} onClick={(e) => { e.stopPropagation(); setShowOrgDropdown(showOrgDropdown === mode ? null : mode) }}>
          {selectedNames.length > 0 ? selectedNames.join(', ') : 'Orgs'}
        </button>
        {showOrgDropdown === mode && (
          <div className={styles.orgDropdownPanel}>
            <ChipSelector
              items={orgs.map((o) => ({ id: o.id!, name: o.name, color: o.color }))}
              selectedIds={new Set(selectedOrgIds)}
              onToggle={onToggle}
              placeholder="Search orgs..."
            />
          </div>
        )}
      </div>
    )
  }

  const renderPersonRow = (p: Person) => {
    if (deleteId === p.id) {
      return (
        <div key={p.id} className={styles.deleteConfirm}>
          <div className={styles.colorSwatch} style={{ background: p.color }} />
          <div className={styles.deleteMsg}>
            Delete <strong>{p.name}</strong>?{deleteCount > 0 && ` Assigned to ${deleteCount} task${deleteCount !== 1 ? 's' : ''}.`}
          </div>
          <button className={styles.deleteBtnConfirm} onClick={confirmDeletePerson}>Delete</button>
          <button className={styles.cancelBtn} onClick={() => setDeleteId(null)}>Cancel</button>
        </div>
      )
    }

    if (editing && editing.id === p.id) {
      const ed = editing
      return (
        <div key={p.id} className={styles.editRow} onKeyDown={handleKeyDown(saveEditPerson, () => setEditing(null))}>
          <ColorInput value={ed.color} onChange={(color) => setEditing({ ...ed, color })} />
          <input className={styles.editInput} value={ed.name} onChange={(e) => { const name = e.target.value; setEditing({ ...ed, name, ...(!editInitialsManual ? { initials: generateInitials(name) } : {}) }) }} placeholder="Name" autoFocus />
          <input className={styles.editInputSmall} value={ed.initials} onChange={(e) => { setEditInitialsManual(true); setEditing({ ...ed, initials: e.target.value.toUpperCase().slice(0, 2) }) }} placeholder="AB" />
          {orgs.length > 0 && renderOrgSelector(ed.orgIds, toggleEditOrg, 'edit')}
          <div className={styles.editActions}>
            <button className={styles.saveBtn} onClick={saveEditPerson}>Save</button>
            <button className={styles.cancelBtn} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )
    }

    const orgLabel = orgNames(p.id!)
    return (
      <div key={p.id} className={styles.row}>
        <div className={styles.colorSwatch} style={{ background: p.color }} onClick={() => startEditPerson(p)} />
        <span className={styles.nameEditable} onClick={() => startEditPerson(p)}>{p.name}</span>
        <span className={styles.initials}>{p.initials}</span>
        {orgLabel && <span className={styles.orgLabel}>{orgLabel}</span>}
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
              : people.filter((p) => {
                  if (p.name.toLowerCase().includes(q)) return true
                  if (p.initials.toLowerCase().includes(q)) return true
                  const orgIds = personOrgMap.get(p.id!)
                  if (orgIds && orgIds.some((id) => orgs.find((o) => o.id === id)?.name.toLowerCase().includes(q))) return true
                  return false
                })
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
            <div className={styles.editRow} onKeyDown={handleKeyDown(saveAddPerson, () => setAdding(false))}>
              <ColorInput value={newColor} onChange={setNewColor} />
              <input className={styles.editInput} value={newName} onChange={(e) => { setNewName(e.target.value); if (!newInitialsManual) setNewInitials(generateInitials(e.target.value)) }} placeholder="Name" autoFocus />
              <input className={styles.editInputSmall} value={newInitials} onChange={(e) => { setNewInitialsManual(true); setNewInitials(e.target.value.toUpperCase().slice(0, 2)) }} placeholder="AB" />
              {orgs.length > 0 && renderOrgSelector(newOrgIds, toggleNewOrg, 'add')}
              <div className={styles.editActions}>
                <button className={styles.saveBtn} onClick={saveAddPerson}>Add</button>
                <button className={styles.cancelBtn} onClick={() => setAdding(false)}>Cancel</button>
              </div>
            </div>
          )}
          {!adding && (
            <button className={styles.addBtn} onClick={startAddPerson}>+ Add Person</button>
          )}
        </div>
      </div>
    </>
  )
}
