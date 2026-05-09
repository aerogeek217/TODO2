import { useEffect, useState, useCallback } from 'react'
import { useOrgStore } from '../../stores/org-store'
import { generateInitials } from '../../utils/person'
import type { Org } from '../../models'
import { DEFAULT_ENTITY_COLOR } from '../../constants'
import { ColorInput } from '../shared/ColorInput'
import { ConfirmDialog } from '../shared/Dialog'
import styles from './EntityEditor.module.css'

interface OrgEditState {
  id: number
  name: string
  initials: string
  color: string
}

interface OrgEditorProps {
  onClose: () => void
}

export function OrgEditor({ onClose }: OrgEditorProps) {
  const { orgs, load: loadOrgs, add: addOrg, update: updateOrg, remove: removeOrg, loadPersonOrgMap, selectPersonCountByOrgId } = useOrgStore()

  const [editing, setEditing] = useState<OrgEditState | null>(null)
  const [editInitialsManual, setEditInitialsManual] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newInitials, setNewInitials] = useState('')
  const [newInitialsManual, setNewInitialsManual] = useState(false)
  const [newColor, setNewColor] = useState(DEFAULT_ENTITY_COLOR)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleteCount, setDeleteCount] = useState(0)
  const [searchText, setSearchText] = useState('')
  const [nameError, setNameError] = useState('')

  useEffect(() => { loadOrgs(); loadPersonOrgMap() }, [loadOrgs, loadPersonOrgMap])

  const clearState = () => {
    setEditing(null)
    setAdding(false)
    setDeleteId(null)
    setNameError('')
  }

  const startEdit = (o: Org) => {
    clearState()
    setEditing({ id: o.id!, name: o.name, initials: o.initials || generateInitials(o.name), color: o.color ?? DEFAULT_ENTITY_COLOR })
    setEditInitialsManual(true)
  }

  const saveEdit = async () => {
    if (!editing || !editing.name.trim()) return
    const initials = editing.initials || generateInitials(editing.name)
    try {
      await updateOrg({ id: editing.id, name: editing.name.trim(), initials, color: editing.color })
      setEditing(null)
      setNameError('')
    } catch (e) {
      setNameError((e as Error).message)
    }
  }

  const startAdd = () => {
    clearState()
    setAdding(true)
    setNewName('')
    setNewInitials('')
    setNewInitialsManual(false)
    setNewColor(DEFAULT_ENTITY_COLOR)
  }

  const saveAdd = async () => {
    if (!newName.trim()) return
    const initials = newInitials || generateInitials(newName)
    try {
      await addOrg(newName.trim(), newColor, initials)
      setAdding(false)
      setNameError('')
    } catch (e) {
      setNameError((e as Error).message)
    }
  }

  const startDelete = (id: number) => {
    clearState()
    setDeleteId(id)
    setDeleteCount(selectPersonCountByOrgId(id))
  }

  const confirmDelete = async () => {
    if (deleteId == null) return
    await removeOrg(deleteId)
    setDeleteId(null)
  }

  const handleKeyDown = useCallback((save: () => void, cancel: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') cancel()
  }, [])

  const renderRow = (org: Org) => {
    if (editing && editing.id === org.id) {
      const ed = editing
      return (
        <div key={org.id}>
          <div className={styles.editRow} onKeyDown={handleKeyDown(saveEdit, () => { setEditing(null); setNameError('') })}>
            <ColorInput value={ed.color} onChange={(color) => setEditing({ ...ed, color })} />
            <input className={styles.editInput} value={ed.name} onChange={(e) => { const name = e.target.value; setEditing({ ...ed, name, ...(!editInitialsManual ? { initials: generateInitials(name) } : {}) }); setNameError('') }} placeholder="Org name" autoFocus />
            <input className={styles.editInputSmall} value={ed.initials} onChange={(e) => { setEditInitialsManual(true); setEditing({ ...ed, initials: e.target.value.toUpperCase().slice(0, 3) }) }} placeholder="AB" />
            <div className={styles.editActions}>
              <button className={styles.saveBtn} onClick={saveEdit}>Save</button>
              <button className={styles.cancelBtn} onClick={() => { setEditing(null); setNameError('') }}>Cancel</button>
            </div>
          </div>
          {nameError && <div className={styles.errorHint}>{nameError}</div>}
        </div>
      )
    }

    return (
      <div key={org.id} className={styles.row}>
        {org.color ? <div className={styles.colorSwatch} style={{ background: org.color }} onClick={() => startEdit(org)} /> : <div className={styles.colorSwatch} onClick={() => startEdit(org)} />}
        <span className={styles.nameEditable} onClick={() => startEdit(org)}>{org.name}</span>
        <span className={styles.initials}>{org.initials || generateInitials(org.name)}</span>
        <div className={styles.actions}>
          <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => startDelete(org.id!)} title="Delete">&times;</button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Organizations</div>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search organizations..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />

        <div className={styles.list}>
          {(() => {
            const q = searchText.trim().toLowerCase()
            const filtered = q === ''
              ? orgs
              : orgs.filter((o) => {
                  if (o.name.toLowerCase().includes(q)) return true
                  if (o.initials && o.initials.toLowerCase().includes(q)) return true
                  return false
                })
            const sorted = filtered.toSorted((a, b) => a.name.localeCompare(b.name))
            return (
              <>
                {orgs.length === 0 && !adding && (
                  <div className={styles.empty}>No orgs yet</div>
                )}
                {orgs.length > 0 && sorted.length === 0 && (
                  <div className={styles.empty}>No matching orgs</div>
                )}
                {sorted.map(renderRow)}
              </>
            )
          })()}

          {adding && (
            <div>
              <div className={styles.editRow} onKeyDown={handleKeyDown(saveAdd, () => { setAdding(false); setNameError('') })}>
                <ColorInput value={newColor} onChange={setNewColor} />
                <input className={styles.editInput} value={newName} onChange={(e) => { setNewName(e.target.value); if (!newInitialsManual) setNewInitials(generateInitials(e.target.value)); setNameError('') }} placeholder="Org name" autoFocus />
                <input className={styles.editInputSmall} value={newInitials} onChange={(e) => { setNewInitialsManual(true); setNewInitials(e.target.value.toUpperCase().slice(0, 3)) }} placeholder="AB" />
                <div className={styles.editActions}>
                  <button className={styles.saveBtn} onClick={saveAdd}>Add</button>
                  <button className={styles.cancelBtn} onClick={() => { setAdding(false); setNameError('') }}>Cancel</button>
                </div>
              </div>
              {nameError && <div className={styles.errorHint}>{nameError}</div>}
            </div>
          )}
          {!adding && (
            <button className={styles.addBtn} onClick={startAdd}>+ Add Org</button>
          )}
        </div>
      </div>
      {deleteId != null && (() => {
        const target = orgs.find((o) => o.id === deleteId)
        if (!target) return null
        return (
          <ConfirmDialog
            open
            title="Delete organization"
            message={
              <>
                Delete <strong>{target.name}</strong>?
                {deleteCount > 0 && ` ${deleteCount} ${deleteCount === 1 ? 'person' : 'people'} will become unaffiliated.`}
              </>
            }
            confirmLabel="Delete"
            danger
            onConfirm={confirmDelete}
            onCancel={() => setDeleteId(null)}
          />
        )
      })()}
    </>
  )
}
