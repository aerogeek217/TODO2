import { useEffect, useState } from 'react'
import { useTagStore } from '../../stores/tag-store'
import { tagRepository } from '../../data'
import type { Tag } from '../../models'
import { DEFAULT_ENTITY_COLOR } from '../../constants'
import { ColorInput } from '../shared/ColorInput'
import styles from './EntityEditor.module.css'

interface EditState {
  id: number
  name: string
  color: string
}

interface TagEditorProps {
  onClose: () => void
}

export function TagEditor({ onClose }: TagEditorProps) {
  const { tags, load, add, update, remove } = useTagStore()
  const [editing, setEditing] = useState<EditState | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_ENTITY_COLOR)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleteCount, setDeleteCount] = useState(0)
  const [searchText, setSearchText] = useState('')

  useEffect(() => { load() }, [load])

  const startEdit = (t: Tag) => {
    setEditing({ id: t.id!, name: t.name, color: t.color })
    setAdding(false)
    setDeleteId(null)
  }

  const saveEdit = async () => {
    if (!editing || !editing.name.trim()) return
    await update({ id: editing.id, name: editing.name.trim(), color: editing.color })
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
    const count = await tagRepository.getTodoCountForTag(id)
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

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Tags</div>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search tags..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />

        <div className={styles.list}>
          {tags.length === 0 && !adding && (
            <div className={styles.empty}>No tags yet</div>
          )}
          {(() => {
            const q = searchText.trim().toLowerCase()
            const filtered = q === ''
              ? tags
              : tags.filter((t) => t.name.toLowerCase().includes(q))
            const sorted = filtered.toSorted((a, b) => a.name.localeCompare(b.name))
            if (tags.length > 0 && sorted.length === 0) {
              return <div className={styles.empty}>No matching tags</div>
            }
            return sorted.map((t) => {
            if (deleteId === t.id) {
              return (
                <div key={t.id} className={styles.deleteConfirm}>
                  <div className={styles.colorSwatch} style={{ background: t.color }} />
                  <div className={styles.deleteMsg}>
                    Delete <strong>{t.name}</strong>?{deleteCount > 0 && ` Used on ${deleteCount} task${deleteCount !== 1 ? 's' : ''}.`}
                  </div>
                  <button className={styles.deleteBtnConfirm} onClick={confirmDelete}>Delete</button>
                  <button className={styles.cancelBtn} onClick={() => setDeleteId(null)}>Cancel</button>
                </div>
              )
            }

            if (editing && editing.id === t.id) {
              const ed = editing
              return (
                <div key={t.id} className={styles.editRow} onKeyDown={handleEditKeyDown}>
                  <ColorInput value={ed.color} onChange={(color) => setEditing({ ...ed, color })} />
                  <input
                    className={styles.editInput}
                    value={ed.name}
                    onChange={(e) => setEditing({ ...ed, name: e.target.value })}
                    placeholder="Tag name"
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
              <div key={t.id} className={styles.row}>
                <div className={styles.colorSwatch} style={{ background: t.color }} onClick={() => startEdit(t)} />
                <span className={styles.nameEditable} onClick={() => startEdit(t)}>{t.name}</span>
                <div className={styles.actions}>
                  <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => startDelete(t.id!)} title="Delete">&times;</button>
                </div>
              </div>
            )
          })
          })()}
        </div>

        {adding ? (
          <div className={styles.editRow} style={{ marginTop: 8 }} onKeyDown={handleAddKeyDown}>
            <ColorInput value={newColor} onChange={setNewColor} />
            <input
              className={styles.editInput}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Tag name"
              autoFocus
            />
            <div className={styles.editActions}>
              <button className={styles.saveBtn} onClick={saveAdd}>Add</button>
              <button className={styles.cancelBtn} onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className={styles.addBtn} onClick={startAdd}>+ Add Tag</button>
        )}
      </div>
    </>
  )
}
