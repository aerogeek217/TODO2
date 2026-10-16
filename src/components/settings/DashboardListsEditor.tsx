import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useUIStore } from '../../stores/ui-store'
import type { PersistedListDefinition } from '../../models/list-definition'
import { DragHandle } from '../shared/DragHandle'
import { ConfirmDialog } from '../shared/Dialog'
import { ListEditorDialog } from '../shared/ListEditorDialog'
import { ListEditorBody } from '../shared/ListEditorBody'
import { defsEqual } from '../../utils/list-def-equal'
import { bySortOrder } from '../../utils/sort-order'
import { DRAG_ACTIVATION_DISTANCE_PX } from '../../constants'
import { useSortableRow, useSortableReorderHandler } from '../../hooks/use-sortable-row'
import { useListDefDraft } from '../../hooks/use-list-def-draft'
import styles from './EntityEditor.module.css'
import { EditorModal } from './EditorModal'
import local from './DashboardListsEditor.module.css'

interface Props {
  onClose: () => void
  /** When provided, mount with this definition's editor dialog already open. */
  initialSelectedId?: number
}

function SortableRow({
  def,
  onEdit,
  onDelete,
}: {
  def: PersistedListDefinition
  onEdit: (id: number) => void
  onDelete: (id: number) => void
}) {
  const { attributes, listeners, setNodeRef, style, isDragging } = useSortableRow(def.id)
  return (
    <div ref={setNodeRef} style={style} className={`${styles.row} ${isDragging ? styles.rowDragging : ''}`}>
      <DragHandle className={styles.dragHandle} attributes={attributes} listeners={listeners} ariaHidden={false} />
      <span className={styles.nameEditable} onClick={() => onEdit(def.id)}>{def.name}</span>
      <button
        type="button"
        className={local.configToggle}
        onClick={() => onEdit(def.id)}
        title="Edit list"
      >
        ⚙
      </button>
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

export function DashboardListsEditor({ onClose, initialSelectedId }: Props) {
  const { listDefinitions, load, add, update, remove, reorder } = useListDefinitionStore()
  const showBulkConfirmation = useUIStore((s) => s.showBulkConfirmation)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [editingListId, setEditingListId] = useState<number | null>(initialSelectedId ?? null)

  useEffect(() => { load() }, [load])

  const sorted = useMemo(() => [...listDefinitions].sort(bySortOrder), [listDefinitions])
  const sortedIds = useMemo(() => sorted.map(d => d.id), [sorted])

  const editingList = useMemo(() => {
    if (editingListId == null) return null
    return sorted.find(d => d.id === editingListId) ?? null
  }, [editingListId, sorted])

  const [draft, setDraft] = useListDefDraft(editingList)

  const dirty = useMemo(() => {
    if (!draft || !editingList) return false
    return !defsEqual(draft, editingList)
  }, [draft, editingList])

  // Guard any action that dismisses the open editor when there are unsaved
  // edits. Runs `perform` immediately when clean; routes through the shared
  // confirm dialog otherwise so the prompt matches other destructive
  // confirmations (task delete, list overwrite, etc.).
  const guardDirty = useCallback((perform: () => void) => {
    if (!dirty) { perform(); return }
    showBulkConfirmation('custom', [], {
      title: 'Discard changes?',
      message: 'Unsaved changes to this list will be lost.',
      confirmLabel: 'Discard',
      onConfirm: perform,
    })
  }, [dirty, showBulkConfirmation])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useSortableReorderHandler(sorted, (d) => d.id, reorder)

  const handleEdit = useCallback((id: number) => {
    if (editingListId === id) return
    guardDirty(() => {
      setEditingListId(id)
      setAdding(false)
      setDeleteId(null)
      setError('')
    })
  }, [editingListId, guardDirty])

  const handleEditorClose = useCallback(() => {
    guardDirty(() => {
      setEditingListId(null)
    })
  }, [guardDirty])

  const handleEditorSave = useCallback(() => {
    if (!draft) {
      setEditingListId(null)
      return
    }
    const trimmedName = draft.name.trim()
    if (!trimmedName) {
      // Match `rename()`'s validation — refuse to save an empty name.
      // Editor stays open so the user can fix it.
      return
    }
    if (dirty) {
      void update({ ...draft, name: trimmedName })
    }
    setEditingListId(null)
  }, [draft, dirty, update])

  const startAdd = () => {
    setAdding(true)
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
    // The row's own Esc (cancel the add): handled, so the modal stays.
    if (e.key === 'Escape') { e.preventDefault(); setAdding(false); setError('') }
  }

  const confirmDelete = async () => {
    if (deleteId == null) return
    await remove(deleteId)
    setDeleteId(null)
    if (editingListId === deleteId) setEditingListId(null)
  }

  const handleModalClose = () => {
    guardDirty(() => { onClose() })
  }

  return (
    <>
      <EditorModal title="Lists" onClose={handleModalClose} className={local.modalWide}>
        <div className={styles.list}>
          {sorted.length === 0 && !adding && (
            <div className={styles.empty}>No lists yet</div>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>
              {sorted.map((d) => (
                <SortableRow
                  key={d.id}
                  def={d}
                  onEdit={handleEdit}
                  onDelete={(id) => { setDeleteId(id); setAdding(false) }}
                />
              ))}
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
              New lists start as <strong>Custom</strong> with no filter (matches all tasks). Click ⚙ to configure membership, sort, and grouping.
            </div>
          </div>
        ) : (
          <button className={styles.addBtn} onClick={startAdd}>+ Add List</button>
        )}
      </EditorModal>
      {deleteId != null && (() => {
        const def = listDefinitions.find((d) => d.id === deleteId)
        if (!def) return null
        return (
          <ConfirmDialog
            open
            title="Delete list"
            message={<>Delete <strong>{def.name}</strong>?</>}
            confirmLabel="Delete"
            danger
            onConfirm={confirmDelete}
            onCancel={() => setDeleteId(null)}
          />
        )
      })()}
      <ListEditorDialog
        open={!!editingList && !!draft}
        list={editingList ? { id: editingList.id, name: editingList.name } : null}
        onClose={handleEditorClose}
        onSave={handleEditorSave}
      >
        {draft && <ListEditorBody draft={draft} onChange={setDraft} />}
      </ListEditorDialog>
    </>
  )
}
