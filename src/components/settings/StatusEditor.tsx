import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type { Status, StatusLook } from '../../models'
import { iconDescription, statusIconValue, statusLookAfterPick } from '../../models/icon'
import { DEFAULT_ENTITY_COLOR, DRAG_ACTIVATION_DISTANCE_PX } from '../../constants'
import { ColorPicker } from '../shared/ColorPicker'
import { ConfirmDialog } from '../shared/Dialog'
import { DragHandle } from '../shared/DragHandle'
import { IconPicker } from '../shared/IconPicker'
import { STATUS_GLYPH_CHOICES } from '../shared/icon-picker-choices'
import { StatusMark } from '../shared/StatusMark'
import { useRecentEmoji } from '../../hooks/use-recent-emoji'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { useSortableRow, useSortableReorderHandler } from '../../hooks/use-sortable-row'
import { bySortOrder } from '../../utils/sort-order'
import { EditorModal } from './EditorModal'
import styles from './EntityEditor.module.css'

interface EditState {
  id: number
  name: string
  color: string
  look: StatusLook
}

interface StatusEditorProps {
  onClose: () => void
}

/** `status` with its look replaced by `look` (a glyph pick drops the emoji). */
function withLook<S extends Status>(status: S, look: StatusLook): S {
  const next: S = { ...status }
  delete next.icon
  delete next.emoji
  delete next.emojiShow
  return { ...next, ...look }
}

/**
 * A status's icon (J17): its mark in its color, opening the one icon picker
 * (`shared/IconPicker`) — its Icons tab the status glyphs, its Emoji tab as
 * everywhere (Show as Muted | Color, Recent). No No icon: a status always
 * draws a mark (the default glyph while it has none).
 */
function StatusIconButton({ look, name, color, onChange }: { look: StatusLook; name: string; color: string; onChange: (look: StatusLook) => void }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const recent = useRecentEmoji()
  const value = statusIconValue(look)
  return (
    <div className={styles.iconPickerWrap}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.iconPickerBtn}
        style={{ color }}
        aria-label={`Icon: ${iconDescription(value)}. Change`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={iconDescription(value)}
      >
        <StatusMark status={look} />
      </button>
      {open && (
        <IconPicker
          anchorRef={triggerRef}
          value={value}
          choices={STATUS_GLYPH_CHOICES}
          recent={recent}
          allowNone={false}
          label={name.trim() ? `Icon of “${name.trim()}”` : 'Status icon'}
          onPick={(icon) => {
            const next = statusLookAfterPick(look, icon)
            if (next) onChange(next)
          }}
          onClose={() => setOpen(false)}
        />
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
        <StatusMark status={status} />
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
  const [newLook, setNewLook] = useState<StatusLook>({})
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleteCount, setDeleteCount] = useState(0)
  const [nameError, setNameError] = useState('')
  const [searchText, setSearchText] = useState('')

  useEffect(() => { load(); ensureTodosLoaded() }, [load, ensureTodosLoaded])

  const startEdit = (s: Status) => {
    setEditing({ id: s.id!, name: s.name, color: s.color, look: { icon: s.icon, ...(s.emoji ? { emoji: s.emoji, emojiShow: s.emojiShow } : {}) } })
    setAdding(false)
    setDeleteId(null)
    setNameError('')
  }

  const saveEdit = async () => {
    if (!editing || !editing.name.trim()) return
    const existing = statuses.find(s => s.id === editing.id)
    if (!existing) return
    try {
      await update(withLook({ ...existing, name: editing.name.trim(), color: editing.color }, editing.look))
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
    setNewLook({})
  }

  const saveAdd = async () => {
    if (!newName.trim()) return
    try {
      await add(newName.trim(), newColor, newLook.icon, newLook)
      setAdding(false)
      setNewName('')
      setNewColor(DEFAULT_ENTITY_COLOR)
      setNewLook({})
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

  /** A key from the row itself — not from the icon picker, portaled out of it, whose keys React bubbles here. */
  const ownKey = (e: React.KeyboardEvent) => e.target instanceof Node && e.currentTarget.contains(e.target)

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (!ownKey(e)) return
    if (e.key === 'Enter') saveEdit()
    // The row's own Esc (cancel the edit): handled, so the modal stays.
    if (e.key === 'Escape') { e.preventDefault(); setEditing(null) }
  }

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (!ownKey(e)) return
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
  // While a row is held, Esc cancels the drag (dnd-kit's), not the editor.
  const [dragging, setDragging] = useState(false)
  const draggingRef = useLatestRef(dragging)
  const escapeBelongsElsewhere = useCallback(() => draggingRef.current, [draggingRef])

  return (
    <>
      <EditorModal title="Statuses" onClose={onClose} escapeBelongsElsewhere={escapeBelongsElsewhere}>
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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={() => setDragging(true)}
            onDragCancel={() => setDragging(false)}
            onDragEnd={(e) => {
              setDragging(false)
              handleDragEnd(e)
            }}
          >
            <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
              {visible.map((s) => {
                if (editing && editing.id === s.id) {
                  const ed = editing
                  return (
                    <div key={s.id}>
                      <div className={styles.editRow} onKeyDown={handleEditKeyDown}>
                        <ColorPicker value={ed.color} onChange={(color) => setEditing({ ...ed, color })} />
                        <StatusIconButton look={ed.look} name={ed.name} color={ed.color} onChange={(look) => setEditing({ ...ed, look })} />
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
              <StatusIconButton look={newLook} name={newName} color={newColor} onChange={setNewLook} />
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
