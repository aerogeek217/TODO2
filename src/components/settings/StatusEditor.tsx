import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useStatusStore } from '../../stores/status-store'
import { useTodoStore } from '../../stores/todo-store'
import { type Status, type StatusIconKey, DEFAULT_STATUS_ICON } from '../../models'
import { DEFAULT_ENTITY_COLOR, DRAG_ACTIVATION_DISTANCE_PX } from '../../constants'
import { ColorPicker } from '../shared/ColorPicker'
import { ConfirmDialog } from '../shared/Dialog'
import { DragHandle } from '../shared/DragHandle'
import { StatusIcon, STATUS_ICON_KEYS } from '../shared/StatusIcon'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import { useSortableRow, useSortableReorderHandler } from '../../hooks/use-sortable-row'
import { bySortOrder } from '../../utils/sort-order'
import { EditorModal } from './EditorModal'
import styles from './EntityEditor.module.css'

interface EditState {
  id: number
  name: string
  color: string
  icon?: StatusIconKey
}

interface StatusEditorProps {
  onClose: () => void
}

function IconPicker({ value, onChange, color }: { value?: StatusIconKey; onChange: (icon?: StatusIconKey) => void; color: string }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { panelRef, style } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: triggerRef },
    open,
    onClose: () => setOpen(false),
    // Esc closes the picker only, not the editor around it.
    consumeEscape: true,
  })

  return (
    <div className={styles.iconPickerWrap}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.iconPickerBtn}
        style={{ color }}
        onClick={() => setOpen(!open)}
        title={value ? `Icon: ${value}` : 'No icon — click to pick'}
      >
        <StatusIcon icon={value || DEFAULT_STATUS_ICON} />
      </button>
      {open && createPortal(
        <div ref={panelRef} className={styles.iconPickerGrid} style={{ ...style, marginTop: 0 }}>
          {STATUS_ICON_KEYS.map(key => (
            <button
              key={key}
              className={`${styles.iconPickerCell} ${(value || DEFAULT_STATUS_ICON) === key ? styles.iconPickerCellActive : ''}`}
              style={{ color }}
              onClick={() => { onChange(key); setOpen(false) }}
              title={key}
            >
              <StatusIcon icon={key} />
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}

function SortableStatusRow({ status, onEdit, onDelete }: {
  status: Status & { id: number }
  onEdit: (s: Status) => void
  onDelete: (id: number) => void
}) {
  const { attributes, listeners, setNodeRef, style, isDragging } = useSortableRow(status.id)

  return (
    <div ref={setNodeRef} style={style} className={`${styles.row} ${isDragging ? styles.rowDragging : ''}`}>
      <DragHandle className={styles.dragHandle} attributes={attributes} listeners={listeners} ariaHidden={false} />
      <div className={styles.colorSwatch} style={{ background: status.color }} onClick={() => onEdit(status)} />
      <span className={styles.iconPreview} style={{ color: status.color }} onClick={() => onEdit(status)}>
        <StatusIcon icon={status.icon || DEFAULT_STATUS_ICON} />
      </span>
      <span className={styles.nameEditable} onClick={() => onEdit(status)}>{status.name}</span>
      <div className={styles.actions}>
        <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => onDelete(status.id)} title="Delete">&times;</button>
      </div>
    </div>
  )
}

export function StatusEditor({ onClose }: StatusEditorProps) {
  const statuses = useStatusStore((s) => s.statuses)
  const { load, add, update, remove, reorder, selectTodoCountByStatusId } = useStatusStore.getState()
  const ensureTodosLoaded = useTodoStore((s) => s.ensureAllLoaded)
  const [editing, setEditing] = useState<EditState | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_ENTITY_COLOR)
  const [newIcon, setNewIcon] = useState<StatusIconKey | undefined>(undefined)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleteCount, setDeleteCount] = useState(0)
  const [nameError, setNameError] = useState('')
  const [searchText, setSearchText] = useState('')

  useEffect(() => { load(); ensureTodosLoaded() }, [load, ensureTodosLoaded])

  const startEdit = (s: Status) => {
    setEditing({ id: s.id!, name: s.name, color: s.color, icon: s.icon })
    setAdding(false)
    setDeleteId(null)
    setNameError('')
  }

  const saveEdit = async () => {
    if (!editing || !editing.name.trim()) return
    const existing = statuses.find(s => s.id === editing.id)
    if (!existing) return
    try {
      await update({ ...existing, name: editing.name.trim(), color: editing.color, icon: editing.icon })
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
    setNewIcon(undefined)
  }

  const saveAdd = async () => {
    if (!newName.trim()) return
    try {
      await add(newName.trim(), newColor, newIcon)
      setAdding(false)
      setNewName('')
      setNewColor(DEFAULT_ENTITY_COLOR)
      setNewIcon(undefined)
      setNameError('')
    } catch (e) {
      setNameError((e as Error).message)
    }
  }

  const startDelete = (id: number) => {
    setDeleteId(id)
    setEditing(null)
    setAdding(false)
    setDeleteCount(selectTodoCountByStatusId(id))
  }

  const confirmDelete = async () => {
    if (deleteId == null) return
    await remove(deleteId)
    setDeleteId(null)
  }

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveEdit()
    // The row's own Esc (cancel the edit): handled, so the modal stays.
    if (e.key === 'Escape') { e.preventDefault(); setEditing(null) }
  }

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveAdd()
    if (e.key === 'Escape') { e.preventDefault(); setAdding(false) }
  }

  const sorted = useMemo(
    () => [...statuses].sort(bySortOrder),
    [statuses],
  )
  const visible = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    if (q === '') return sorted
    return sorted.filter(s => s.name.toLowerCase().includes(q))
  }, [sorted, searchText])
  const visibleIds = useMemo(() => visible.map(s => s.id!), [visible])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useSortableReorderHandler(sorted, (s) => s.id, reorder)

  return (
    <>
      <EditorModal title="Statuses" onClose={onClose}>
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
                if (editing && editing.id === s.id) {
                  const ed = editing
                  return (
                    <div key={s.id}>
                      <div className={styles.editRow} onKeyDown={handleEditKeyDown}>
                        <ColorPicker value={ed.color} onChange={(color) => setEditing({ ...ed, color })} />
                        <IconPicker value={ed.icon} onChange={(icon) => setEditing({ ...ed, icon })} color={ed.color} />
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
              <ColorPicker value={newColor} onChange={setNewColor} />
              <IconPicker value={newIcon} onChange={setNewIcon} color={newColor} />
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
      </EditorModal>
      {deleteId != null && (() => {
        const target = statuses.find((s) => s.id === deleteId)
        if (!target) return null
        return (
          <ConfirmDialog
            open
            title="Delete status"
            message={
              <>
                Delete <strong>{target.name}</strong>?
                {deleteCount > 0 && ` Used on ${deleteCount} task${deleteCount !== 1 ? 's' : ''}.`}
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
