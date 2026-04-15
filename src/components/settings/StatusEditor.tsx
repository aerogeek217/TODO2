import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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

function SortableStatusRow({ status, onEdit, onDelete }: {
  status: Status & { id: number }
  onEdit: (s: Status) => void
  onDelete: (id: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: status.id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div ref={setNodeRef} style={style} className={`${styles.row} ${isDragging ? styles.rowDragging : ''}`}>
      <span className={styles.dragHandle} {...attributes} {...listeners}>
        <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
          <circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" />
          <circle cx="2" cy="7" r="1.2" /><circle cx="6" cy="7" r="1.2" />
          <circle cx="2" cy="12" r="1.2" /><circle cx="6" cy="12" r="1.2" />
        </svg>
      </span>
      <div className={styles.colorSwatch} style={{ background: status.color }} onClick={() => onEdit(status)} />
      <span className={styles.nameEditable} onClick={() => onEdit(status)}>{status.name}</span>
      <div className={styles.actions}>
        <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => onDelete(status.id)} title="Delete">&times;</button>
      </div>
    </div>
  )
}

export function StatusEditor({ onClose }: StatusEditorProps) {
  const { statuses, load, add, update, remove, reorder } = useStatusStore()
  const [editing, setEditing] = useState<EditState | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_ENTITY_COLOR)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleteCount, setDeleteCount] = useState(0)
  const [nameError, setNameError] = useState('')
  const [searchText, setSearchText] = useState('')

  useEffect(() => { load() }, [load])

  const startEdit = (s: Status) => {
    setEditing({ id: s.id!, name: s.name, color: s.color })
    setAdding(false)
    setDeleteId(null)
    setNameError('')
  }

  const saveEdit = async () => {
    if (!editing || !editing.name.trim()) return
    const existing = statuses.find(s => s.id === editing.id)
    if (!existing) return
    try {
      await update({ ...existing, name: editing.name.trim(), color: editing.color })
      setEditing(null)
      setNameError('')
    } catch (e) {
      setNameError((e as Error).message)
    }
  }

  const startAdd = () => {
    setAdding(true)
    setEditing(null)
    setDeleteId(null)
    setNameError('')
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

  const sorted = useMemo(
    () => [...statuses].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [statuses],
  )
  const visible = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    if (q === '') return sorted
    return sorted.filter(s => s.name.toLowerCase().includes(q))
  }, [sorted, searchText])
  const visibleIds = useMemo(() => visible.map(s => s.id!), [visible])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const fromIndex = sorted.findIndex(s => s.id === active.id)
    const toIndex = sorted.findIndex(s => s.id === over.id)
    if (fromIndex !== -1 && toIndex !== -1) {
      reorder(fromIndex, toIndex)
    }
  }, [sorted, reorder])

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Statuses</div>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search statuses..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />

        <div className={styles.list}>
          {sorted.length === 0 && !adding && (
            <div className={styles.empty}>No statuses yet</div>
          )}
          {sorted.length > 0 && visible.length === 0 && (
            <div className={styles.empty}>No matching statuses</div>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
              {visible.map((s) => {
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
                    <div key={s.id}>
                      <div className={styles.editRow} onKeyDown={handleEditKeyDown}>
                        <ColorInput value={ed.color} onChange={(color) => setEditing({ ...ed, color })} />
                        <input
                          className={styles.editInput}
                          value={ed.name}
                          onChange={(e) => { setEditing({ ...ed, name: e.target.value }); setNameError('') }}
                          placeholder="Status name"
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

                return (
                  <SortableStatusRow
                    key={s.id}
                    status={s as Status & { id: number }}
                    onEdit={startEdit}
                    onDelete={startDelete}
                  />
                )
              })}
            </SortableContext>
          </DndContext>
        </div>

        {adding ? (
          <div>
            <div className={styles.editRow} style={{ marginTop: 8 }} onKeyDown={handleAddKeyDown}>
              <ColorInput value={newColor} onChange={setNewColor} />
              <input
                className={styles.editInput}
                value={newName}
                onChange={(e) => { setNewName(e.target.value); setNameError('') }}
                placeholder="Status name"
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
          <button className={styles.addBtn} onClick={startAdd}>+ Add Status</button>
        )}
      </div>
    </>
  )
}
