import { useCallback, useEffect, useMemo, useState } from 'react'
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

  const [counts, setCounts] = useState<Map<number, number>>(new Map())
  const [editing, setEditing] = useState<EditState | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_ENTITY_COLOR)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleteCount, setDeleteCount] = useState(0)
  const [nameError, setNameError] = useState('')
  const [searchText, setSearchText] = useState('')

  const refreshCounts = useCallback(async () => {
    const map = await tagRepository.getTodoCounts()
    setCounts(map)
  }, [])

  useEffect(() => {
    load()
    refreshCounts()
  }, [load, refreshCounts])

  const clearState = () => {
    setEditing(null)
    setAdding(false)
    setDeleteId(null)
    setNameError('')
  }

  const startEdit = (t: Tag) => {
    clearState()
    setEditing({ id: t.id!, name: t.name, color: t.color })
  }

  const saveEdit = async () => {
    if (!editing || !editing.name.trim()) return
    try {
      await update({ id: editing.id, name: editing.name.trim(), color: editing.color })
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
    setNewColor(DEFAULT_ENTITY_COLOR)
  }

  const saveAdd = async () => {
    if (!newName.trim()) return
    try {
      await add(newName.trim(), newColor)
      setAdding(false)
      setNewName('')
      setNewColor(DEFAULT_ENTITY_COLOR)
      setNameError('')
    } catch (e) {
      setNameError((e as Error).message)
    }
  }

  const startDelete = async (id: number) => {
    clearState()
    setDeleteId(id)
    const count = await tagRepository.getTodoCount(id)
    setDeleteCount(count)
  }

  const confirmDelete = async () => {
    if (deleteId == null) return
    await remove(deleteId)
    setDeleteId(null)
    await refreshCounts()
  }

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveEdit()
    if (e.key === 'Escape') { setEditing(null); setNameError('') }
  }

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveAdd()
    if (e.key === 'Escape') { setAdding(false); setNameError('') }
  }

  const visible = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    const filtered = q === '' ? tags : tags.filter((t) => t.name.toLowerCase().includes(q))
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
  }, [tags, searchText])

  const renderRow = (tag: Tag) => {
    if (deleteId === tag.id) {
      return (
        <div key={tag.id} className={styles.deleteConfirm}>
          <div className={styles.colorSwatch} style={{ background: tag.color }} />
          <div className={styles.deleteMsg}>
            Delete <strong>{tag.name}</strong>?{deleteCount > 0 && ` ${deleteCount} task${deleteCount !== 1 ? 's' : ''} currently tagged.`}
          </div>
          <button className={styles.deleteBtnConfirm} onClick={confirmDelete}>Delete</button>
          <button className={styles.cancelBtn} onClick={() => setDeleteId(null)}>Cancel</button>
        </div>
      )
    }

    if (editing && editing.id === tag.id) {
      const ed = editing
      return (
        <div key={tag.id}>
          <div className={styles.editRow} onKeyDown={handleEditKeyDown}>
            <ColorInput value={ed.color} onChange={(color) => setEditing({ ...ed, color })} />
            <input
              className={styles.editInput}
              value={ed.name}
              onChange={(e) => { setEditing({ ...ed, name: e.target.value }); setNameError('') }}
              placeholder="Tag name"
              autoFocus
            />
            <div className={styles.editActions}>
              <button className={styles.saveBtn} onClick={saveEdit}>Save</button>
              <button className={styles.cancelBtn} onClick={() => { setEditing(null); setNameError('') }}>Cancel</button>
            </div>
          </div>
          {nameError && <div className={styles.errorHint}>{nameError}</div>}
        </div>
      )
    }

    const count = counts.get(tag.id!) ?? 0
    return (
      <div key={tag.id} className={styles.row}>
        <div className={styles.colorSwatch} style={{ background: tag.color }} onClick={() => startEdit(tag)} />
        <span className={styles.nameEditable} onClick={() => startEdit(tag)}>{tag.name}</span>
        <span className={styles.initials} title={count === 1 ? '1 task' : `${count} tasks`}>{count > 0 ? count : ''}</span>
        <div className={styles.actions}>
          <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => startDelete(tag.id!)} title="Delete">&times;</button>
        </div>
      </div>
    )
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
          {tags.length > 0 && visible.length === 0 && (
            <div className={styles.empty}>No matching tags</div>
          )}
          {visible.map(renderRow)}
        </div>

        {adding ? (
          <div>
            <div className={styles.editRow} style={{ marginTop: 8 }} onKeyDown={handleAddKeyDown}>
              <ColorInput value={newColor} onChange={setNewColor} />
              <input
                className={styles.editInput}
                value={newName}
                onChange={(e) => { setNewName(e.target.value); setNameError('') }}
                placeholder="Tag name"
                autoFocus
              />
              <div className={styles.editActions}>
                <button className={styles.saveBtn} onClick={saveAdd}>Add</button>
                <button className={styles.cancelBtn} onClick={() => { setAdding(false); setNameError('') }}>Cancel</button>
              </div>
            </div>
            {nameError && <div className={styles.errorHint}>{nameError}</div>}
          </div>
        ) : (
          <button className={styles.addBtn} onClick={startAdd}>+ Add Tag</button>
        )}
      </div>
    </>
  )
}
