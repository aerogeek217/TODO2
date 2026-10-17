import { useEffect, useMemo, useState } from 'react'
import { useTagStore, countTodosByTag } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import type { Tag } from '../../models'
import { DEFAULT_ENTITY_COLOR } from '../../constants'
import { ColorInput } from '../shared/ColorInput'
import { DeleteTagConfirm } from './EntityDeleteConfirm'
import styles from './EntityEditor.module.css'
import { EditorModal } from './EditorModal'
import { byName } from '../../utils/sort-order'

interface EditState {
  id: number
  name: string
  color: string
}

interface TagEditorProps {
  onClose: () => void
  /** Open straight onto this tag's edit row, its name focused (a task row's tag menu › Edit…). */
  editTagId?: number
}

export function TagEditor({ onClose, editTagId }: TagEditorProps) {
  const { tags, load, add, update, loadAssignments, assignedTagsMap } = useTagStore()
  const ensureTodosLoaded = useTodoStore((s) => s.ensureAllLoaded)
  const todos = useTodoStore((s) => s.todos)

  const [editing, setEditing] = useState<EditState | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_ENTITY_COLOR)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [nameError, setNameError] = useState('')
  const [searchText, setSearchText] = useState('')

  // Ensure todos are loaded so we can derive counts from the cached
  // `assignedTagsMap`. The map is keyed by todoId, so it only covers todos
  // we've explicitly loaded assignments for — request the assignment join
  // for every todo whenever the visible todo set changes.
  useEffect(() => { load(); ensureTodosLoaded() }, [load, ensureTodosLoaded])
  useEffect(() => {
    if (todos.length > 0) loadAssignments(todos.map((t) => t.id))
  }, [todos, loadAssignments])

  const counts = useMemo(() => countTodosByTag(assignedTagsMap), [assignedTagsMap])

  // Opened onto one tag: edit that row once the tag is there.
  const [openedOnto, setOpenedOnto] = useState<number | null>(null)
  const ontoTag = editTagId != null && openedOnto !== editTagId ? tags.find((t) => t.id === editTagId) : undefined
  if (ontoTag) {
    setOpenedOnto(editTagId ?? null)
    setEditing({ id: ontoTag.id!, name: ontoTag.name, color: ontoTag.color })
  }

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
    const trimmed = newName.trim()
    if (!trimmed) return
    // Pre-check for duplicate-rejection UX. `tagStore.add` is idempotent
    // (returns the existing id silently) so the user would otherwise
    // see no feedback on a collision.
    const lower = trimmed.toLowerCase()
    if (tags.some((t) => t.name.trim().toLowerCase() === lower)) {
      setNameError(`A tag named "${trimmed}" already exists`)
      return
    }
    try {
      await add(trimmed, newColor)
      setAdding(false)
      setNewName('')
      setNewColor(DEFAULT_ENTITY_COLOR)
      setNameError('')
    } catch (e) {
      setNameError((e as Error).message)
    }
  }

  const startDelete = (id: number) => {
    clearState()
    setDeleteId(id)
  }

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveEdit()
    // The row's own Esc (cancel the edit): handled, so the modal stays.
    if (e.key === 'Escape') { e.preventDefault(); setEditing(null); setNameError('') }
  }

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveAdd()
    if (e.key === 'Escape') { e.preventDefault(); setAdding(false); setNameError('') }
  }

  const visible = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    const filtered = q === '' ? tags : tags.filter((t) => t.name.toLowerCase().includes(q))
    return [...filtered].sort(byName)
  }, [tags, searchText])

  const renderRow = (tag: Tag) => {
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
      <EditorModal title="Tags" onClose={onClose}>
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
      </EditorModal>
      {deleteId != null && <DeleteTagConfirm tagId={deleteId} onDone={() => setDeleteId(null)} />}
    </>
  )
}
