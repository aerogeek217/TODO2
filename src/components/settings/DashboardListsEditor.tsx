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
import styles from './EntityEditor.module.css'
import local from './DashboardListsEditor.module.css'

interface Props {
  onClose: () => void
  /**
   * When set, only definitions with these ids are shown and the "+ Add List" /
   * per-row delete affordances are hidden. Used by the ribbon's "Edit horizons…"
   * entry point so users can't delete a horizon's mapped list-def from here.
   */
  filterIds?: number[]
  /** Override modal title (default "Lists"). */
  title?: string
  /** When provided, mount with this definition's editor dialog already open. */
  initialSelectedId?: number
}

function SortableRow({
  def,
  onEdit,
  onToggleFavorite,
  onDelete,
  hideDelete,
}: {
  def: PersistedListDefinition
  onEdit: (id: number) => void
  onToggleFavorite: (id: number, next: boolean) => void
  onDelete: (id: number) => void
  hideDelete?: boolean
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
      <label
        className={local.pinToggle}
        title={def.favorited ? 'Shown in ListView Favorites' : 'Not in ListView Favorites'}
      >
        <input
          type="checkbox"
          checked={def.favorited}
          onChange={(e) => onToggleFavorite(def.id, e.target.checked)}
        />
        Favorite
      </label>
      {!hideDelete && (
        <div className={styles.actions}>
          <button
            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
            onClick={() => onDelete(def.id)}
            title="Delete"
          >&times;</button>
        </div>
      )}
    </div>
  )
}

export function DashboardListsEditor({ onClose, filterIds, title, initialSelectedId }: Props) {
  const { listDefinitions, load, add, update, setFavorited, remove, reorder } = useListDefinitionStore()
  const showBulkConfirmation = useUIStore((s) => s.showBulkConfirmation)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [editingListId, setEditingListId] = useState<number | null>(initialSelectedId ?? null)
  const [draft, setDraft] = useState<PersistedListDefinition | null>(null)

  useEffect(() => { load() }, [load])

  const sorted = useMemo(() => {
    const all = [...listDefinitions].sort(bySortOrder)
    if (!filterIds) return all
    const set = new Set(filterIds)
    return all.filter((d) => set.has(d.id))
  }, [listDefinitions, filterIds])
  const sortedIds = useMemo(() => sorted.map(d => d.id), [sorted])

  const editingList = useMemo(() => {
    if (editingListId == null) return null
    return sorted.find(d => d.id === editingListId) ?? null
  }, [editingListId, sorted])

  // Sync the draft when the editor opens or the upstream def changes. When
  // the draft is clean (no pending edits), adopt the new def. When dirty,
  // preserve the user's in-flight edits but forward externally-managed
  // fields (favorited toggle from the dialog header, pin, sortOrder) so a
  // header-fired favorite or a reorder doesn't get reverted on Save.
  useEffect(() => {
    if (!editingList) {
      setDraft(null)
      return
    }
    setDraft(prev => {
      if (!prev || prev.id !== editingList.id) return editingList
      const dirty = !defsEqual(prev, editingList)
      if (!dirty) return editingList
      return {
        ...prev,
        favorited: editingList.favorited,
        pinnedToDashboard: editingList.pinnedToDashboard,
        sortOrder: editingList.sortOrder,
      }
    })
  }, [editingList])

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

  const handleToggleEditorFavorite = useCallback(() => {
    if (!editingList) return
    void setFavorited(editingList.id, !editingList.favorited)
  }, [editingList, setFavorited])

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
    if (e.key === 'Escape') { setAdding(false); setError('') }
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
      <div className={styles.backdrop} onClick={handleModalClose} />
      <div className={`${styles.modal} ${local.modalWide}`}>
        <div className={styles.header}>
          <div className={styles.title}>{title ?? 'Lists'}</div>
          <button className={styles.closeBtn} onClick={handleModalClose}>&times;</button>
        </div>

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
                  onToggleFavorite={(id, next) => { void setFavorited(id, next) }}
                  onDelete={(id) => { setDeleteId(id); setAdding(false) }}
                  hideDelete={!!filterIds}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        {filterIds ? null : adding ? (
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
      </div>
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
        list={editingList ? { id: editingList.id, name: editingList.name, favorited: editingList.favorited } : null}
        onClose={handleEditorClose}
        onSave={handleEditorSave}
        onToggleFavorite={handleToggleEditorFavorite}
      >
        {draft && <ListEditorBody draft={draft} onChange={setDraft} />}
      </ListEditorDialog>
    </>
  )
}
