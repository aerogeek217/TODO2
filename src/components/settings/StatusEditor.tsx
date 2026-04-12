import { useEffect, useState } from 'react'
import { useStatusStore } from '../../stores/status-store'
import { statusRepository } from '../../data'
import type { Status } from '../../models'
import { DEFAULT_ENTITY_COLOR } from '../../constants'
import { ColorInput } from '../shared/ColorInput'
import styles from './EntityEditor.module.css'

interface EditState {
  id: number
  name: string
  color: string
}

interface StatusEditorProps {
  onClose: () => void
}

export function StatusEditor({ onClose }: StatusEditorProps) {
  const { statuses, load, add, update, remove } = useStatusStore()
  const [editing, setEditing] = useState<EditState | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_ENTITY_COLOR)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleteCount, setDeleteCount] = useState(0)

  useEffect(() => { load() }, [load])

  const startEdit = (s: Status) => {
    setEditing({ id: s.id!, name: s.name, color: s.color })
    setAdding(false)
    setDeleteId(null)
  }

  const saveEdit = async () => {
    if (!editing || !editing.name.trim()) return
    const existing = statuses.find(s => s.id === editing.id)
    if (!existing) return
    await update({ ...existing, name: editing.name.trim(), color: editing.color })
    setEditing(null)
  }

  const startAdd = () => {
    setAdding(true)
    setEditing(null)
    setDeleteId(null)
    setNewName('')
    setNewColor(DEFAULT_ENTITY_COLOR)
  }

  const saveAdd = async () => {
    if (!newName.trim()) return
    await add(newName.trim(), newColor)
    setAdding(false)
    setNewName('')
    setNewColor(DEFAULT_ENTITY_COLOR)
  }

  const startDelete = async (id: number) => {
    setDeleteId(id)
    setEditing(null)
    setAdding(false)
    const count = await statusRepository.getTodoCountForStatus(id)
    setDeleteCount(count)
  }

  const confirmDelete = async () => {
    if (deleteId == null) return
    await remove(deleteId)
    setDeleteId(null)
  }

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveEdit()
    if (e.key === 'Escape') setEditing(null)
  }

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveAdd()
    if (e.key === 'Escape') setAdding(false)
  }

  const sorted = [...statuses].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Statuses</div>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        <div className={styles.list}>
          {sorted.length === 0 && !adding && (
            <div className={styles.empty}>No statuses yet</div>
          )}
          {sorted.map((s) => {
            if (deleteId === s.id) {
              return (
                <div key={s.id} className={styles.deleteConfirm}>
                  <div className={styles.colorSwatch} style={{ background: s.color }} />
                  <div className={styles.deleteMsg}>
                    Delete <strong>{s.name}</strong>?{deleteCount > 0 && ` Used on ${deleteCount} task${deleteCount !== 1 ? 's' : ''}.`}
                  </div>
                  <button className={styles.deleteBtnConfirm} onClick={confirmDelete}>Delete</button>
                  <button className={styles.cancelBtn} onClick={() => setDeleteId(null)}>Cancel</button>
                </div>
              )
            }

            if (editing && editing.id === s.id) {
              const ed = editing
              return (
                <div key={s.id} className={styles.editRow} onKeyDown={handleEditKeyDown}>
                  <ColorInput value={ed.color} onChange={(color) => setEditing({ ...ed, color })} />
                  <input
                    className={styles.editInput}
                    value={ed.name}
                    onChange={(e) => setEditing({ ...ed, name: e.target.value })}
                    placeholder="Status name"
                    autoFocus
                  />
                  <div className={styles.editActions}>
                    <button className={styles.saveBtn} onClick={saveEdit}>Save</button>
                    <button className={styles.cancelBtn} onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </div>
              )
            }

            return (
              <div key={s.id} className={styles.row}>
                <div className={styles.colorSwatch} style={{ background: s.color }} onClick={() => startEdit(s)} />
                <span className={styles.nameEditable} onClick={() => startEdit(s)}>{s.name}</span>
                <div className={styles.actions}>
                  <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => startDelete(s.id!)} title="Delete">&times;</button>
                </div>
              </div>
            )
          })}
        </div>

        {adding ? (
          <div className={styles.editRow} style={{ marginTop: 8 }} onKeyDown={handleAddKeyDown}>
            <ColorInput value={newColor} onChange={setNewColor} />
            <input
              className={styles.editInput}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Status name"
              autoFocus
            />
            <div className={styles.editActions}>
              <button className={styles.saveBtn} onClick={saveAdd}>Add</button>
              <button className={styles.cancelBtn} onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className={styles.addBtn} onClick={startAdd}>+ Add Status</button>
        )}
      </div>
    </>
  )
}
