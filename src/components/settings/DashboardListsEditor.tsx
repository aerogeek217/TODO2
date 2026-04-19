import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
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
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { useFilterStore, predicateToCriteria } from '../../stores/filter-store'
import { useUIStore } from '../../stores/ui-store'
import type {
  ListGrouping,
  ListSort,
  PersistedListDefinition,
} from '../../models/list-definition'
import type { ListGroupBy, ListItemSortBy, ListSortBy, TodoPredicate } from '../../models'
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
  /** Override modal title (default "Dashboard Lists"). */
  title?: string
  /** When provided, mount with this definition's ConfigPanel already expanded. */
  initialSelectedId?: number
}

const SORT_KINDS: { value: ListSort['kind']; label: string }[] = [
  { value: 'effective-date-asc', label: 'Effective date' },
  { value: 'scheduled-asc', label: 'Scheduled date' },
  { value: 'deadline-asc', label: 'Deadline' },
  { value: 'sort-order', label: 'Manual order' },
  { value: 'sortBy', label: 'Group attribute' },
]

const GROUPING_KINDS: { value: ListGrouping['kind']; label: string; title?: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'relative-effective', label: 'Relative (effective)' },
  { value: 'relative-deadline', label: 'Relative (deadline)' },
  {
    value: 'by-sortBy',
    label: 'Match sort field',
    title: 'Group by the same field used for sorting. Only available when Sort = Group attribute.',
  },
  { value: 'by-field', label: 'By field' },
]

const SORT_BY_OPTIONS: { value: ListSortBy; label: string }[] = [
  { value: 'date', label: 'Date' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'deadline', label: 'Deadline' },
  { value: 'project', label: 'Project' },
  { value: 'status', label: 'Status' },
  { value: 'people', label: 'People' },
  { value: 'org', label: 'Org' },
  { value: 'tag', label: 'Tag' },
]

/** Map a persisted list-definition's grouping to ListView's groupBy field. */
function resolveGroupBy(def: PersistedListDefinition): ListGroupBy {
  const g = def.grouping
  if (g.kind === 'none') return 'none'
  if (g.kind === 'by-field') return g.by
  if (g.kind === 'by-sortBy' && def.sort.kind === 'sortBy') return def.sort.by
  if (g.kind === 'relative-deadline') return 'deadline'
  if (g.kind === 'relative-effective') return 'date'
  return 'date'
}

/** Map a persisted list-definition's sort to ListView's within-group sort field. */
function resolveItemSortBy(def: PersistedListDefinition): ListItemSortBy {
  const s = def.sort
  if (s.kind === 'sort-order') return 'manual'
  if (s.kind === 'effective-date-asc') return 'date'
  if (s.kind === 'scheduled-asc') return 'scheduled'
  if (s.kind === 'deadline-asc') return 'deadline'
  if (s.kind === 'sortBy') {
    if (s.by === 'date' || s.by === 'scheduled' || s.by === 'deadline') return s.by
    return 'manual'
  }
  return 'manual'
}

interface PredicateChip {
  key: string
  label: string
  color?: string
}

function usePredicateChips(predicate: TodoPredicate): PredicateChip[] {
  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const orgs = useOrgStore((s) => s.orgs)
  const statuses = useStatusStore((s) => s.statuses)

  return useMemo(() => {
    const chips: PredicateChip[] = []
    if (predicate.searchText) {
      chips.push({ key: 'search', label: `“${predicate.searchText}”` })
    }
    if (predicate.personIds && predicate.personIds.length > 0) {
      const names = predicate.personIds.map((id) => {
        if (id === 0) return 'Unassigned'
        const p = people.find((x) => x.id === id)
        return p ? `@${p.name}` : `@?`
      })
      chips.push({ key: 'people', label: names.join(', ') })
    }
    if (predicate.tagIds && predicate.tagIds.length > 0) {
      const names = predicate.tagIds.map((id) => {
        if (id === 0) return 'No tag'
        const t = tags.find((x) => x.id === id)
        return t ? `#${t.name}` : `#?`
      })
      chips.push({ key: 'tags', label: names.join(', ') })
    }
    if (predicate.orgIds && predicate.orgIds.length > 0) {
      const names = predicate.orgIds.map((id) => {
        if (id === 0) return 'No org'
        const o = orgs.find((x) => x.id === id)
        return o ? o.name : '?'
      })
      chips.push({ key: 'orgs', label: names.join(', ') })
    }
    if (predicate.statusIds && predicate.statusIds.length > 0) {
      const names = predicate.statusIds.map((id) => {
        if (id === 0) return 'No status'
        const s = statuses.find((x) => x.id === id)
        return s ? s.name : '?'
      })
      chips.push({ key: 'statuses', label: names.join(', ') })
    }
    if (predicate.dateRangeStart || predicate.dateRangeEnd) {
      const fmt = (a: typeof predicate.dateRangeStart) => {
        if (!a) return '…'
        if (a.kind === 'fixed') return a.iso.slice(0, 10)
        return a.token
      }
      chips.push({ key: 'date', label: `${predicate.dateField}: ${fmt(predicate.dateRangeStart)} → ${fmt(predicate.dateRangeEnd)}` })
    }
    if (predicate.hasScheduled !== null && predicate.hasScheduled !== undefined) {
      chips.push({ key: 'hasSched', label: predicate.hasScheduled ? 'Has scheduled' : 'No scheduled' })
    }
    if (predicate.hasDeadline !== null && predicate.hasDeadline !== undefined) {
      chips.push({ key: 'hasDead', label: predicate.hasDeadline ? 'Has deadline' : 'No deadline' })
    }
    if (predicate.showCompleted) chips.push({ key: 'completed', label: 'Show completed' })
    if (predicate.showHiddenStatuses) chips.push({ key: 'hidden', label: 'Show hidden statuses' })
    return chips
  }, [predicate, people, tags, orgs, statuses])
}

function ConfigPanel({
  def,
  onChange,
  onEditInListView,
  onClose,
}: {
  def: PersistedListDefinition
  onChange: (next: PersistedListDefinition) => void
  onEditInListView: (def: PersistedListDefinition) => void
  onClose: () => void
}) {
  const chips = usePredicateChips(def.membership.predicate)

  const setSortKind = (kind: ListSort['kind']) => {
    if (kind === def.sort.kind) return
    let next: ListSort
    switch (kind) {
      case 'effective-date-asc': next = { kind: 'effective-date-asc' }; break
      case 'scheduled-asc': next = { kind: 'scheduled-asc' }; break
      case 'deadline-asc': next = { kind: 'deadline-asc' }; break
      case 'sort-order': next = { kind: 'sort-order' }; break
      case 'sortBy': next = { kind: 'sortBy', by: 'date' }; break
    }
    onChange({ ...def, sort: next })
  }

  const setSortBy = (by: ListSortBy) => {
    if (def.sort.kind !== 'sortBy') return
    onChange({ ...def, sort: { kind: 'sortBy', by } })
  }

  const setGroupingKind = (kind: ListGrouping['kind']) => {
    if (kind === def.grouping.kind) return
    let next: ListGrouping
    if (kind === 'by-field') {
      const fallback: ListSortBy = def.sort.kind === 'sortBy' ? def.sort.by : 'date'
      next = { kind: 'by-field', by: fallback }
    } else {
      next = { kind }
    }
    onChange({ ...def, grouping: next })
  }

  const setGroupingField = (by: ListSortBy) => {
    if (def.grouping.kind !== 'by-field') return
    onChange({ ...def, grouping: { kind: 'by-field', by } })
  }

  return (
    <div className={local.configPanel}>
      <div className={local.configRow}>
        <span className={local.configLabel}>Filter</span>
        <div className={local.predicateBlock}>
          {chips.length === 0 ? (
            <span className={local.predicateEmpty}>No filters set — matches all tasks.</span>
          ) : (
            <div className={local.chipRow}>
              {chips.map((c) => (
                <span
                  key={c.key}
                  className={local.predicateChip}
                  style={c.color ? { borderColor: c.color } : undefined}
                >
                  {c.label}
                </span>
              ))}
            </div>
          )}
          <button
            type="button"
            className={local.editInListBtn}
            onClick={() => onEditInListView(def)}
          >
            Edit in ListView…
          </button>
        </div>
      </div>

      <div className={local.configRow}>
        <span className={local.configLabel}>Sort</span>
        <div className={local.configButtons}>
          {SORT_KINDS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`${local.configBtn} ${def.sort.kind === value ? local.configBtnActive : ''}`}
              onClick={() => setSortKind(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {def.sort.kind === 'sortBy' && (
        <div className={local.configRow}>
          <span className={local.configLabel}>Sort by</span>
          <select
            className={local.configSelect}
            value={def.sort.by}
            onChange={(e) => setSortBy(e.target.value as ListSortBy)}
          >
            {SORT_BY_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      )}

      <div className={local.configRow}>
        <span className={local.configLabel}>Grouping</span>
        <div className={local.configButtons}>
          {GROUPING_KINDS.map(({ value, label, title }) => {
            const disabled = value === 'by-sortBy' && def.sort.kind !== 'sortBy'
            return (
              <button
                key={value}
                type="button"
                className={`${local.configBtn} ${def.grouping.kind === value ? local.configBtnActive : ''}`}
                onClick={() => setGroupingKind(value)}
                disabled={disabled}
                title={title}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {def.grouping.kind === 'by-field' && (
        <div className={local.configRow}>
          <span className={local.configLabel}>Group by</span>
          <select
            className={local.configSelect}
            value={def.grouping.by}
            onChange={(e) => setGroupingField(e.target.value as ListSortBy)}
          >
            {SORT_BY_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      )}

      <div className={local.configFooter}>
        <button type="button" className={local.configDoneBtn} onClick={onClose}>Done</button>
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
  onDelete,
  hideDelete,
}: {
  def: PersistedListDefinition
  expanded: boolean
  onEdit: (d: PersistedListDefinition) => void
  onConfigure: (id: number) => void
  onTogglePin: (id: number, next: boolean) => void
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
  const { listDefinitions, load, add, update, rename, setPinned, remove, reorder } = useListDefinitionStore()
  const setAllFilters = useFilterStore((s) => s.setAllFilters)
  const setListGroupBy = useUIStore((s) => s.setListGroupBy)
  const setListSortBy = useUIStore((s) => s.setListSortBy)
  const startEditingListDef = useUIStore((s) => s.startEditingListDef)
  const navigate = useNavigate()
  const [editing, setEditing] = useState<EditState | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [configuringId, setConfiguringId] = useState<number | null>(initialSelectedId ?? null)

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
    setEditing({ id: d.id, name: d.name })
    setAdding(false)
    setDeleteId(null)
    setConfiguringId(null)
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
    if (configuringId === deleteId) setConfiguringId(null)
  }

  const handleConfigure = (id: number) => {
    setConfiguringId((cur) => (cur === id ? null : id))
    setEditing(null)
    setDeleteId(null)
  }

  const handleEditInListView = (def: PersistedListDefinition) => {
    const criteria = predicateToCriteria(def.membership.predicate)
    setAllFilters(criteria)
    setListGroupBy(resolveGroupBy(def))
    setListSortBy(resolveItemSortBy(def))
    startEditingListDef(def.id, def.name)
    onClose()
    navigate('/list')
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>{title ?? 'Dashboard Lists'}</div>
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
                  <div key={d.id}>
                    <SortableRow
                      def={d}
                      expanded={configuringId === d.id}
                      onEdit={startEdit}
                      onConfigure={handleConfigure}
                      onTogglePin={handleTogglePin}
                      onDelete={(id) => { setDeleteId(id); setEditing(null); setAdding(false) }}
                      hideDelete={!!filterIds}
                    />
                    {configuringId === d.id && (
                      <ConfigPanel
                        def={d}
                        onChange={(next) => update(next)}
                        onEditInListView={handleEditInListView}
                        onClose={() => setConfiguringId(null)}
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
