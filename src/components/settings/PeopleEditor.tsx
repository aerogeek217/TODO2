import { useEffect, useState, useRef } from 'react'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { personRepository } from '../../data'
import { generateInitials } from '../../utils/person'
import { resolvePersonColor } from '../../utils/person-color'
import { ChipSelector } from '../shared/ChipSelector'
import { ConfirmDialog } from '../shared/Dialog'
import { useClickOutside } from '../../hooks/use-click-outside'
import type { Person } from '../../models'
import { UNAFFILIATED_PERSON_COLOR } from '../../constants'
import styles from './EntityEditor.module.css'

interface PersonEditState {
  id: number
  name: string
  initials: string
  orgIds: number[]
}

interface PeopleEditorProps {
  onClose: () => void
}

export function PeopleEditor({ onClose }: PeopleEditorProps) {
  const { people, load: loadPeople, add: addPerson, update: updatePerson, remove: removePerson } = usePersonStore()
  const orgs = useOrgStore((s) => s.orgs)
  const personOrgMap = useOrgStore((s) => s.personOrgMap)
  const loadOrgs = useOrgStore((s) => s.load)
  const loadPersonOrgMap = useOrgStore((s) => s.loadPersonOrgMap)
  const setPersonOrgs = useOrgStore((s) => s.setPersonOrgs)

  const [editing, setEditing] = useState<PersonEditState | null>(null)
  const [editInitialsManual, setEditInitialsManual] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newInitials, setNewInitials] = useState('')
  const [newInitialsManual, setNewInitialsManual] = useState(false)
  const [newOrgIds, setNewOrgIds] = useState<number[]>([])
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleteCount, setDeleteCount] = useState(0)
  const [searchText, setSearchText] = useState('')
  const [nameError, setNameError] = useState('')

  // Org dropdown for person edit/add
  const [showOrgDropdown, setShowOrgDropdown] = useState<'edit' | 'add' | null>(null)
  const orgDropdownRef = useRef<HTMLDivElement>(null)
  useClickOutside(orgDropdownRef, () => setShowOrgDropdown(null), showOrgDropdown !== null)

  useEffect(() => { loadPeople(); loadOrgs(); loadPersonOrgMap() }, [loadPeople, loadOrgs, loadPersonOrgMap])

  const clearState = () => {
    setEditing(null)
    setAdding(false)
    setDeleteId(null)
    setShowOrgDropdown(null)
    setNameError('')
  }

  // --- Person CRUD ---

  const startEditPerson = (p: Person) => {
    clearState()
    setEditing({ id: p.id!, name: p.name, initials: p.initials, orgIds: personOrgMap.get(p.id!) ?? [] })
    setEditInitialsManual(true) // existing person already has initials, treat as manual until changed
  }

  const saveEditPerson = async () => {
    if (!editing || !editing.name.trim()) return
    try {
      await updatePerson({ id: editing.id, name: editing.name.trim(), initials: editing.initials || generateInitials(editing.name) })
      await setPersonOrgs(editing.id, editing.orgIds)
      setEditing(null)
      setNameError('')
    } catch (e) {
      setNameError((e as Error).message)
    }
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
    setNewOrgIds([])
  }

  const toggleNewOrg = (orgId: number) => {
    setNewOrgIds((prev) => prev.includes(orgId) ? prev.filter((id) => id !== orgId) : [...prev, orgId])
  }

  const saveAddPerson = async () => {
    if (!newName.trim()) return
    try {
      const id = await addPerson(newName.trim(), newInitials || generateInitials(newName))
      if (newOrgIds.length > 0) {
        await setPersonOrgs(id, newOrgIds)
      }
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
    const derived = resolvePersonColor(p.id, personOrgMap, orgs) ?? UNAFFILIATED_PERSON_COLOR

    if (editing && editing.id === p.id) {
      const ed = editing
      return (
        <div key={p.id}>
          <div className={styles.editRow} onKeyDown={handleKeyDown(saveEditPerson, () => { setEditing(null); setNameError('') })}>
            <div className={styles.colorSwatch} style={{ background: derived }} title="Color derived from assigned org" />
            <input className={styles.editInput} value={ed.name} onChange={(e) => { const name = e.target.value; setEditing({ ...ed, name, ...(!editInitialsManual ? { initials: generateInitials(name) } : {}) }); setNameError('') }} placeholder="Name" autoFocus />
            <input className={styles.editInputSmall} value={ed.initials} onChange={(e) => { setEditInitialsManual(true); setEditing({ ...ed, initials: e.target.value.toUpperCase().slice(0, 2) }) }} placeholder="AB" />
            {orgs.length > 0 && renderOrgSelector(ed.orgIds, toggleEditOrg, 'edit')}
            <div className={styles.editActions}>
              <button className={styles.saveBtn} onClick={saveEditPerson}>Save</button>
              <button className={styles.cancelBtn} onClick={() => { setEditing(null); setNameError('') }}>Cancel</button>
            </div>
          </div>
          {nameError && <div className={styles.errorHint}>{nameError}</div>}
        </div>
      )
    }

    const orgLabel = orgNames(p.id!)
    return (
      <div key={p.id} className={styles.row}>
        <div className={styles.colorSwatch} style={{ background: derived }} onClick={() => startEditPerson(p)} />
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

          {adding && (() => {
            // Preview swatch: first selected org's color (matches post-save derivation).
            const previewColor = newOrgIds
              .map((id) => orgs.find((o) => o.id === id)?.color)
              .find((c): c is string => !!c)
              ?? UNAFFILIATED_PERSON_COLOR
            return (
            <div>
              <div className={styles.editRow} onKeyDown={handleKeyDown(saveAddPerson, () => { setAdding(false); setNameError('') })}>
                <div className={styles.colorSwatch} style={{ background: previewColor }} title="Color derived from assigned org" />
                <input className={styles.editInput} value={newName} onChange={(e) => { setNewName(e.target.value); if (!newInitialsManual) setNewInitials(generateInitials(e.target.value)); setNameError('') }} placeholder="Name" autoFocus />
                <input className={styles.editInputSmall} value={newInitials} onChange={(e) => { setNewInitialsManual(true); setNewInitials(e.target.value.toUpperCase().slice(0, 2)) }} placeholder="AB" />
                {orgs.length > 0 && renderOrgSelector(newOrgIds, toggleNewOrg, 'add')}
                <div className={styles.editActions}>
                  <button className={styles.saveBtn} onClick={saveAddPerson}>Add</button>
                  <button className={styles.cancelBtn} onClick={() => { setAdding(false); setNameError('') }}>Cancel</button>
                </div>
              </div>
              {nameError && <div className={styles.errorHint}>{nameError}</div>}
            </div>
            )
          })()}
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
