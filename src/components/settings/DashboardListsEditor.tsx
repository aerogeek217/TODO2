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
import { useListDefinitionStore } from '../../stores/list-definition-store'
import type { ListMembership, PersistedListDefinition } from '../../models/list-definition'
import styles from './EntityEditor.module.css'
import local from './DashboardListsEditor.module.css'

interface EditState {
  id: number
  name: string
}

interface Props {
  onClose: () => void
}

function membershipLabel(m: ListMembership): string {
  switch (m.kind) {
    case 'today': {
      const win = m.warningWindowDays
      return win !== undefined ? `Today (+${win}d)` : 'Today'
    }
    case 'upcoming':
      return 'Upcoming'
    case 'deadlines':
      return 'Deadlines'
    case 'someday':
      return 'Someday'
    case 'custom':
      return 'Custom'
  }
}

function SortableRow({
  def,
  onEdit,
  onTogglePin,
  onDelete,
}: {
  def: PersistedListDefinition
  onEdit: (d: PersistedListDefinition) => void
  onTogglePin: (id: number, next: boolean) => void
  onDelete: (id: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: def.id })
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
      <span className={styles.nameEditable} onClick={() => onEdit(def)}>{def.name}</span>
      <span className={local.kindLabel}>{membershipLabel(def.membership)}</span>
      <label
        className={local.pinToggle}
        title={def.pinnedToDashboard ? 'Pinned to Dashboard' : 'Not pinned'}
      >
        <input
          type="checkbox"
          checked={def.pinnedToDashboard}
          onChange={(e) => onTogglePin(def.id, e.target.checked)}
        />
        Pin
      </label>
      <div className={styles.actions}>
        <button
          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
          onClick={() => onDelete(def.id)}
          title="Delete"
        >&times;</button>
      </div>
    </div>
  )
}

export function DashboardListsEditor({ onClose }: Props) {
  const { listDefinitions, load, add, rename, setPinned, remove, reorder } = useListDefinitionStore()
  const [editing, setEditing] = useState<EditState | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [load])

  const sorted = useMemo(
    () => [...listDefinitions].sort((a, b) => a.sortOrder - b.sortOrder),
    [listDefinitions],
  )
  const sortedIds = useMemo(() => sorted.map(d => d.id), [sorted])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = sorted.findIndex(d => d.id === active.id)
    const to = sorted.findIndex(d => d.id === over.id)
    if (from !== -1 && to !== -1) reorder(from, to)
  }, [sorted, reorder])

  const startEdit = (d: PersistedListDefinition) => {
    setEditing({ id: d.id, name: d.name })
    setAdding(false)
    setDeleteId(null)
    setError('')
  }
  const saveEdit = async () => {
    if (!editing) return
    try {
      await rename(editing.id, editing.name)
      setEditing(null)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveEdit()
    if (e.key === 'Escape') { setEditing(null); setError('') }
  }

  const startAdd = () => {
    setAdding(true)
    setEditing(null)
    setDeleteId(null)
    setNewName('')
    setError('')
  }
  const saveAdd = async () => {
    if (!newName.trim()) return
    try {
      await add({ name: newName.trim() })
      setAdding(false)
      setNewName('')
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveAdd()
    if (e.key === 'Escape') { setAdding(false); setError('') }
  }

  const confirmDelete = async () => {
    if (deleteId == null) return
    await remove(deleteId)
    setDeleteId(null)
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Dashboard Lists</div>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        <div className={styles.list}>
          {sorted.length === 0 && !adding && (
            <div className={styles.empty}>No lists yet</div>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>
              {sorted.map((d) => {
                if (deleteId === d.id) {
                  return (
                    <div key={d.id} className={styles.deleteConfirm}>
                      <div className={styles.deleteMsg}>
                        Delete <strong>{d.name}</strong>?
                      </div>
                      <button className={styles.deleteBtnConfirm} onClick={confirmDelete}>Delete</button>
                      <button className={styles.cancelBtn} onClick={() => setDeleteId(null)}>Cancel</button>
                    </div>
                  )
                }

                if (editing && editing.id === d.id) {
                  const ed = editing
                  return (
                    <div key={d.id}>
                      <div className={styles.editRow} onKeyDown={handleEditKeyDown}>
                        <input
                          className={styles.editInput}
                          value={ed.name}
                          onChange={(e) => { setEditing({ ...ed, name: e.target.value }); setError('') }}
                          placeholder="List name"
                          autoFocus
                        />
                        <div className={styles.editActions}>
                          <button className={styles.saveBtn} onClick={saveEdit}>Save</button>
                          <button className={styles.cancelBtn} onClick={() => { setEditing(null); setError('') }}>Cancel</button>
                        </div>
                      </div>
                      {error && <div className={styles.errorHint}>{error}</div>}
                    </div>
                  )
                }

                return (
                  <SortableRow
                    key={d.id}
                    def={d}
                    onEdit={startEdit}
                    onTogglePin={setPinned}
                    onDelete={(id) => { setDeleteId(id); setEditing(null); setAdding(false) }}
                  />
                )
              })}
            </SortableContext>
          </DndContext>
        </div>

        {adding ? (
          <div>
            <div className={styles.editRow} style={{ marginTop: 8 }} onKeyDown={handleAddKeyDown}>
              <input
                className={styles.editInput}
                value={newName}
                onChange={(e) => { setNewName(e.target.value); setError('') }}
                placeholder="List name (e.g. My next steps)"
                autoFocus
              />
              <div className={styles.editActions}>
                <button className={styles.saveBtn} onClick={saveAdd}>Add</button>
                <button className={styles.cancelBtn} onClick={() => { setAdding(false); setError('') }}>Cancel</button>
              </div>
            </div>
            {error && <div className={styles.errorHint}>{error}</div>}
            <div className={local.hint}>
              New lists start as <strong>Custom</strong> and match all tasks. A predicate editor is coming soon.
            </div>
          </div>
        ) : (
          <button className={styles.addBtn} onClick={startAdd}>+ Add List</button>
        )}
      </div>
    </>
  )
}
