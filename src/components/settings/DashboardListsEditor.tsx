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
import { useSettingsStore } from '../../stores/settings-store'
import type {
  ListGrouping,
  ListSort,
  PersistedListDefinition,
  RuntimeFilterField,
} from '../../models/list-definition'
import type { ListSortBy, TodoPredicate } from '../../models'
import { ListFilterEditor } from './ListFilterEditor'
import styles from './EntityEditor.module.css'
import local from './DashboardListsEditor.module.css'

interface EditState {
  id: number
  name: string
}

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
  /** When provided, mount with this definition's ConfigPanel already expanded. */
  initialSelectedId?: number
}

type SortSelectValue =
  | 'sort-order'
  | 'effective-date-asc'
  | 'scheduled-asc'
  | 'deadline-asc'
  | `sortBy:${ListSortBy}`

type GroupingSelectValue =
  | 'none'
  | 'relative-effective'
  | 'relative-deadline'
  | 'by-sortBy'
  | `by-field:${ListSortBy}`
  | 'by-tag'

const SORT_OPTIONS: { value: SortSelectValue; label: string }[] = [
  { value: 'sort-order', label: 'None' },
  { value: 'effective-date-asc', label: 'Effective date' },
  { value: 'scheduled-asc', label: 'Scheduled date' },
  { value: 'deadline-asc', label: 'Deadline' },
  { value: 'sortBy:date', label: 'Date' },
  { value: 'sortBy:scheduled', label: 'Scheduled' },
  { value: 'sortBy:deadline', label: 'Deadline (within group)' },
  { value: 'sortBy:project', label: 'Project' },
  { value: 'sortBy:status', label: 'Status' },
  { value: 'sortBy:people', label: 'People' },
  { value: 'sortBy:org', label: 'Org' },
]

const GROUPING_OPTIONS: {
  value: GroupingSelectValue
  label: string
  requiresSortBy?: true
}[] = [
  { value: 'none', label: 'None' },
  { value: 'relative-effective', label: 'Relative (effective)' },
  { value: 'relative-deadline', label: 'Relative (deadline)' },
  { value: 'by-sortBy', label: 'Match sort field', requiresSortBy: true },
  { value: 'by-field:date', label: 'By date' },
  { value: 'by-field:scheduled', label: 'By scheduled' },
  { value: 'by-field:deadline', label: 'By deadline' },
  { value: 'by-field:project', label: 'By project' },
  { value: 'by-field:status', label: 'By status' },
  { value: 'by-field:people', label: 'By people' },
  { value: 'by-field:org', label: 'By org' },
  { value: 'by-tag', label: 'By tag' },
]

const RUNTIME_FILTER_OPTIONS: { value: RuntimeFilterField | 'none'; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'person', label: 'Person' },
  { value: 'org', label: 'Org' },
  { value: 'project', label: 'Project' },
  { value: 'status', label: 'Status' },
]

function encodeSortValue(sort: ListSort): SortSelectValue {
  if (sort.kind === 'sortBy') return `sortBy:${sort.by}`
  return sort.kind
}

function decodeSortValue(value: SortSelectValue): ListSort {
  if (value.startsWith('sortBy:')) {
    return { kind: 'sortBy', by: value.slice('sortBy:'.length) as ListSortBy }
  }
  return { kind: value as Exclude<ListSort['kind'], 'sortBy'> }
}

function encodeGroupingValue(grouping: ListGrouping): GroupingSelectValue {
  if (grouping.kind === 'by-field') return `by-field:${grouping.by}`
  return grouping.kind
}

function decodeGroupingValue(value: GroupingSelectValue): ListGrouping {
  if (value.startsWith('by-field:')) {
    return { kind: 'by-field', by: value.slice('by-field:'.length) as ListSortBy }
  }
  return { kind: value as Exclude<ListGrouping['kind'], 'by-field'> }
}

function predicatesEqual(a: TodoPredicate, b: TodoPredicate): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function defsEqual(a: PersistedListDefinition, b: PersistedListDefinition): boolean {
  // Ignore `sortOrder` (reorder is saved independently) and `name` (rename is inline/live).
  if (a.pinnedToDashboard !== b.pinnedToDashboard) return false
  if (JSON.stringify(a.sort) !== JSON.stringify(b.sort)) return false
  if (JSON.stringify(a.grouping) !== JSON.stringify(b.grouping)) return false
  if (JSON.stringify(a.runtimeFilter ?? null) !== JSON.stringify(b.runtimeFilter ?? null)) return false
  if (a.membership.kind !== b.membership.kind) return false
  if (a.membership.kind === 'custom' && b.membership.kind === 'custom') {
    if (!predicatesEqual(a.membership.predicate, b.membership.predicate)) return false
  }
  return true
}

function ConfigPanel({
  def,
  onSave,
  onCollapse,
  onDirtyChange,
}: {
  def: PersistedListDefinition
  onSave: (next: PersistedListDefinition) => Promise<void> | void
  onCollapse: () => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const [draft, setDraft] = useState<PersistedListDefinition>(def)

  // Re-sync the draft when the upstream def changes (post-Save rehydration,
  // rename via the inline path, pin toggle from the row). Draft stays
  // authoritative for sort / grouping / predicate / runtimeFilter — the panel
  // only writes those through Save.
  useEffect(() => {
    setDraft((prev) => ({
      ...def,
      sort: prev.sort,
      grouping: prev.grouping,
      runtimeFilter: prev.runtimeFilter,
      membership: prev.membership,
    }))
  }, [def])

  const dirty = useMemo(() => !defsEqual(draft, def), [draft, def])

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  const setSort = (value: SortSelectValue) => {
    const next = decodeSortValue(value)
    if (next.kind === draft.sort.kind
      && (next.kind !== 'sortBy' || (draft.sort.kind === 'sortBy' && next.by === draft.sort.by))) return
    const grouping: ListGrouping = draft.grouping.kind === 'by-sortBy' && next.kind !== 'sortBy'
      ? { kind: 'none' }
      : draft.grouping
    setDraft({ ...draft, sort: next, grouping })
  }

  const setGrouping = (value: GroupingSelectValue) => {
    setDraft({ ...draft, grouping: decodeGroupingValue(value) })
  }

  const setRuntimeFilter = (value: RuntimeFilterField | 'none') => {
    if (value === 'none') {
      if (!draft.runtimeFilter) return
      const { runtimeFilter: _drop, ...rest } = draft
      setDraft(rest as PersistedListDefinition)
      return
    }
    if (draft.runtimeFilter?.field === value) return
    setDraft({ ...draft, runtimeFilter: { field: value } })
  }

  const handlePredicateChange = (predicate: TodoPredicate) => {
    setDraft({ ...draft, membership: { kind: 'custom', predicate } })
  }

  const handleSave = async () => {
    if (!dirty) return
    await onSave(draft)
  }

  const handleDiscard = () => {
    setDraft(def)
  }

  const currentPredicate = draft.membership.kind === 'custom'
    ? draft.membership.predicate
    : def.membership.kind === 'custom' ? def.membership.predicate : undefined

  return (
    <div className={local.configPanel}>
      <div className={local.configHeader}>
        <span className={local.configHeaderTitle}>Edit list</span>
        <div className={local.configHeaderActions}>
          {dirty && (
            <button
              type="button"
              className={local.configDiscardBtn}
              onClick={handleDiscard}
            >
              Discard
            </button>
          )}
          <button
            type="button"
            className={local.configSaveBtn}
            onClick={handleSave}
            disabled={!dirty}
            title={dirty ? 'Save changes' : 'No changes to save'}
          >
            Save
          </button>
        </div>
      </div>

      {currentPredicate && (
        <div className={local.configRow}>
          <span className={local.configLabel}>Filter</span>
          <div className={local.predicateBlock}>
            <ListFilterEditor
              predicate={currentPredicate}
              onChange={handlePredicateChange}
            />
          </div>
        </div>
      )}

      <div className={local.configRow}>
        <span className={local.configLabel}>Sort</span>
        <select
          className={local.configSelect}
          value={encodeSortValue(draft.sort)}
          onChange={(e) => setSort(e.target.value as SortSelectValue)}
        >
          {SORT_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div className={local.configRow}>
        <span className={local.configLabel}>Grouping</span>
        <select
          className={local.configSelect}
          value={encodeGroupingValue(draft.grouping)}
          onChange={(e) => setGrouping(e.target.value as GroupingSelectValue)}
        >
          {GROUPING_OPTIONS.map(({ value, label, requiresSortBy }) => (
            <option
              key={value}
              value={value}
              disabled={requiresSortBy && draft.sort.kind !== 'sortBy'}
            >
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className={local.configRow}>
        <span
          className={local.configLabel}
          title="When set, the list surface asks the user for a value before rendering — e.g. 'Tasks for {assignee}'."
        >
          Runtime filter
        </span>
        <select
          className={local.configSelect}
          value={draft.runtimeFilter?.field ?? 'none'}
          onChange={(e) => setRuntimeFilter(e.target.value as RuntimeFilterField | 'none')}
        >
          {RUNTIME_FILTER_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div className={local.configFooter}>
        <button type="button" className={local.configDoneBtn} onClick={onCollapse}>
          Close
        </button>
      </div>
    </div>
  )
}

function SortableRow({
  def,
  expanded,
  onEdit,
  onConfigure,
  onTogglePin,
  onToggleFavorite,
  onDelete,
  hideDelete,
}: {
  def: PersistedListDefinition
  expanded: boolean
  onEdit: (d: PersistedListDefinition) => void
  onConfigure: (id: number) => void
  onTogglePin: (id: number, next: boolean) => void
  onToggleFavorite: (id: number, next: boolean) => void
  onDelete: (id: number) => void
  hideDelete?: boolean
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
      <button
        type="button"
        className={`${local.configToggle} ${expanded ? local.configToggleActive : ''}`}
        onClick={() => onConfigure(def.id)}
        title={expanded ? 'Hide settings' : 'Configure'}
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
  const { listDefinitions, load, add, update, rename, setPinned, setFavorited, remove, reorder } = useListDefinitionStore()
  const [editing, setEditing] = useState<EditState | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [configuringId, setConfiguringId] = useState<number | null>(initialSelectedId ?? null)
  const [configDirty, setConfigDirty] = useState(false)

  // Guard any action that dismisses the open ConfigPanel when there are
  // unsaved edits. Returns true when the caller should proceed.
  const confirmDirtyAction = useCallback((message: string): boolean => {
    if (!configDirty) return true
    return window.confirm(message)
  }, [configDirty])

  useEffect(() => { load() }, [load])

  // Pin toggles from the editor must also mutate `settings.dashboardUserLists`
  // so the Dashboard grid and the pin flag stay in sync for non-horizon defs.
  // Horizon-mapped defs keep their pinnedToDashboard state (ribbon resolution
  // depends on it) but their grid membership is decoupled.
  const handleTogglePin = useCallback(async (id: number, pinned: boolean) => {
    await setPinned(id, pinned)
    const { dashboardUserLists, setDashboardUserLists, horizonSlots } = useSettingsStore.getState()
    const horizonIds = new Set(Object.values(horizonSlots).filter((v): v is number => v != null))
    const cur = dashboardUserLists ?? []
    if (pinned) {
      if (!cur.includes(id)) await setDashboardUserLists([...cur, id])
    } else if (!horizonIds.has(id) && cur.includes(id)) {
      await setDashboardUserLists(cur.filter((x) => x !== id))
    }
  }, [setPinned])

  const sorted = useMemo(() => {
    const all = [...listDefinitions].sort((a, b) => a.sortOrder - b.sortOrder)
    if (!filterIds) return all
    const set = new Set(filterIds)
    return all.filter((d) => set.has(d.id))
  }, [listDefinitions, filterIds])
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
    if (configuringId !== null && !confirmDirtyAction('Discard unsaved changes to this list?')) return
    setEditing({ id: d.id, name: d.name })
    setAdding(false)
    setDeleteId(null)
    setConfiguringId(null)
    setConfigDirty(false)
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
    if (configuringId === deleteId) { setConfiguringId(null); setConfigDirty(false) }
  }

  const handleConfigure = (id: number) => {
    if (configuringId === id) {
      if (!confirmDirtyAction('Discard unsaved changes to this list?')) return
      setConfiguringId(null)
      setConfigDirty(false)
      return
    }
    if (configuringId !== null && !confirmDirtyAction('Discard unsaved changes to this list?')) return
    setConfiguringId(id)
    setConfigDirty(false)
    setEditing(null)
    setDeleteId(null)
  }

  const handleCollapseConfig = () => {
    if (!confirmDirtyAction('Discard unsaved changes to this list?')) return
    setConfiguringId(null)
    setConfigDirty(false)
  }

  const handleSaveConfig = useCallback(async (next: PersistedListDefinition) => {
    await update(next)
    setConfigDirty(false)
  }, [update])

  const handleModalClose = () => {
    if (!confirmDirtyAction('Discard unsaved changes to this list?')) return
    onClose()
  }

  return (
    <>
      <div className={styles.backdrop} onClick={handleModalClose} />
      <div className={styles.modal}>
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
                  <div key={d.id}>
                    <SortableRow
                      def={d}
                      expanded={configuringId === d.id}
                      onEdit={startEdit}
                      onConfigure={handleConfigure}
                      onTogglePin={handleTogglePin}
                      onToggleFavorite={(id, next) => { void setFavorited(id, next) }}
                      onDelete={(id) => { setDeleteId(id); setEditing(null); setAdding(false) }}
                      hideDelete={!!filterIds}
                    />
                    {configuringId === d.id && (
                      <ConfigPanel
                        key={d.id}
                        def={d}
                        onSave={handleSaveConfig}
                        onCollapse={handleCollapseConfig}
                        onDirtyChange={setConfigDirty}
                      />
                    )}
                  </div>
                )
              })}
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
    </>
  )
}
