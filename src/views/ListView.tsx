import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useProjectStore } from '../stores/project-store'
import { useOrgStore } from '../stores/org-store'
import { useTagStore } from '../stores/tag-store'
import { useStatusStore } from '../stores/status-store'
import { useUIStore } from '../stores/ui-store'
import { useFilterStore, applyFilter, criteriaToPredicate, predicateToCriteria } from '../stores/filter-store'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { encodeGroupSort } from '../data/saved-view-legacy'
import { useTaskEditCallbacks } from '../hooks/use-task-edit-callbacks'
import { TaskList } from '../components/task/TaskList'
import { TaskRow } from '../components/task/TaskRow'
import { TaskEditPopup } from '../components/task/TaskEditPopup'
import { SectionHeader } from '../components/shared/SectionHeader'
import { ReassignDialog } from '../components/overlays/ReassignDialog'
import { FilteredListPopup } from '../components/overlays/FilteredListPopup'
import { copyTasksRich, type CopyTaskSection } from '../services/task-copy'
import { createPortal } from 'react-dom'
import type { PersistedTodoItem, PersistedListDefinition, Person, Project, Org, Status, Tag, ListGroupBy, ListItemSortBy } from '../models'
import type { RuntimeFilterSpec, RuntimeFilterField } from '../models/list-definition'
import { applyRuntimeFilter } from '../services/dashboard-lists'
import { RuntimeFilterPicker } from '../components/canvas/RuntimeFilterPicker'
import { TASK_DROP_KIND } from '../utils/task-dnd'
import { startOfToday, MS_PER_DAY } from '../utils/date'
import { effectiveDate, resolveScheduled } from '../utils/effective-date'
import { resolvePersonColor } from '../utils/person-color'
import { useIsMobile } from '../hooks/use-is-mobile'
import { IconSelect } from '../components/shared/IconSelect'
import { groupByIcons, itemSortByIcons } from '../components/shared/list-option-icons'
import styles from './ListView.module.css'

export interface Section {
  key: string
  label: string
  accentColor?: string
  todos: PersistedTodoItem[]
}

const groupByOptions: { value: ListGroupBy; label: string; icon: React.ReactNode }[] = [
  { value: 'none', label: 'None', icon: groupByIcons.none },
  { value: 'date', label: 'Effective Date', icon: groupByIcons.date },
  { value: 'scheduled', label: 'Scheduled', icon: groupByIcons.scheduled },
  { value: 'deadline', label: 'Deadline', icon: groupByIcons.deadline },
  { value: 'project', label: 'Project', icon: groupByIcons.project },
  { value: 'status', label: 'Status', icon: groupByIcons.status },
  { value: 'people', label: 'People', icon: groupByIcons.people },
  { value: 'org', label: 'Org', icon: groupByIcons.org },
  { value: 'tag', label: 'Tag', icon: groupByIcons.tag },
]

const itemSortByOptions: { value: ListItemSortBy; label: string; icon: React.ReactNode }[] = [
  { value: 'manual', label: 'None', icon: itemSortByIcons.manual },
  { value: 'date', label: 'Effective Date', icon: itemSortByIcons.date },
  { value: 'scheduled', label: 'Scheduled', icon: itemSortByIcons.scheduled },
  { value: 'deadline', label: 'Deadline', icon: itemSortByIcons.deadline },
]

const runtimeFilterOptions: { value: RuntimeFilterField | 'none'; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'person', label: 'Person' },
  { value: 'org', label: 'Org' },
  { value: 'project', label: 'Project' },
  { value: 'status', label: 'Status' },
]


type DateBucketField = 'date' | 'scheduled' | 'deadline'

function pickBucketDate(todo: PersistedTodoItem, field: DateBucketField, today: Date): Date | null {
  switch (field) {
    case 'date': return effectiveDate(todo, today)
    case 'scheduled': return todo.scheduledDate ? resolveScheduled(todo.scheduledDate, today) : null
    case 'deadline': return todo.dueDate ? new Date(todo.dueDate) : null
  }
}

function buildBucketSections(
  todos: PersistedTodoItem[],
  field: DateBucketField,
  today: Date,
  noDateLabel: string,
): Section[] {
  const tomorrow = new Date(today.getTime() + MS_PER_DAY)
  const weekEnd = new Date(today.getTime() + 7 * MS_PER_DAY)

  const overdue: PersistedTodoItem[] = []
  const dueToday: PersistedTodoItem[] = []
  const thisWeek: PersistedTodoItem[] = []
  const later: PersistedTodoItem[] = []
  const noDate: PersistedTodoItem[] = []

  for (const t of todos) {
    const d = pickBucketDate(t, field, today)
    if (!d) { noDate.push(t); continue }
    if (d < today) overdue.push(t)
    else if (d < tomorrow) dueToday.push(t)
    else if (d < weekEnd) thisWeek.push(t)
    else later.push(t)
  }

  const sections: Section[] = []
  if (overdue.length > 0) sections.push({ key: 'overdue', label: 'Overdue', accentColor: 'var(--color-danger)', todos: overdue })
  if (dueToday.length > 0) sections.push({ key: 'today', label: 'Today', accentColor: 'var(--color-accent)', todos: dueToday })
  if (thisWeek.length > 0) sections.push({ key: 'week', label: 'This Week', accentColor: 'var(--color-accent)', todos: thisWeek })
  if (later.length > 0) sections.push({ key: 'later', label: 'Later', todos: later })
  if (noDate.length > 0) sections.push({ key: 'none', label: noDateLabel, todos: noDate })
  return sections
}

export function buildFlatSection(todos: PersistedTodoItem[]): Section[] {
  if (todos.length === 0) return []
  return [{ key: 'all', label: 'All tasks', todos }]
}

export function buildDateSections(todos: PersistedTodoItem[], today: Date = startOfToday()): Section[] {
  return buildBucketSections(todos, 'date', today, 'No Date')
}

export function buildScheduledSections(todos: PersistedTodoItem[], today: Date = startOfToday()): Section[] {
  return buildBucketSections(todos, 'scheduled', today, 'Not Scheduled')
}

export function buildDeadlineSections(todos: PersistedTodoItem[], today: Date = startOfToday()): Section[] {
  return buildBucketSections(todos, 'deadline', today, 'No Deadline')
}

export function buildPeopleSections(
  todos: PersistedTodoItem[],
  people: Person[],
  assignedPeopleMap: Map<number, Person[]>,
  orgs?: Org[],
  assignedOrgsMap?: Map<number, Org[]>,
  personOrgMap?: Map<number, number[]>,
  filteredOrgIds?: Set<number> | null,
): Section[] {
  // Visible people: when org filter active, only those belonging to a filtered org.
  const visiblePeople = (filteredOrgIds && personOrgMap)
    ? people.filter((p) => {
        const memberOrgIds = personOrgMap.get(p.id!) ?? []
        return memberOrgIds.some((orgId) => filteredOrgIds.has(orgId))
      })
    : people

  const visibleOrgs = (orgs && assignedOrgsMap)
    ? (filteredOrgIds ? orgs.filter((o) => filteredOrgIds.has(o.id!)) : orgs)
    : []

  const orgBuckets = new Map<number, PersistedTodoItem[]>()
  for (const o of visibleOrgs) orgBuckets.set(o.id!, [])
  const personBuckets = new Map<number, PersistedTodoItem[]>()
  for (const p of visiblePeople) personBuckets.set(p.id!, [])
  const unassigned: PersistedTodoItem[] = []

  // Single pass: org first (short-circuits person grouping), else all assigned visible people.
  for (const t of todos) {
    let orgHit = false
    if (assignedOrgsMap) {
      const directOrgs = assignedOrgsMap.get(t.id) ?? []
      for (const o of directOrgs) {
        const bucket = orgBuckets.get(o.id!)
        if (bucket) {
          bucket.push(t)
          orgHit = true
        }
      }
    }
    if (orgHit) continue

    const assigned = assignedPeopleMap.get(t.id) ?? []
    let personHit = false
    for (const p of assigned) {
      const bucket = personBuckets.get(p.id!)
      if (bucket) {
        bucket.push(t)
        personHit = true
      }
    }
    if (!personHit) unassigned.push(t)
  }

  const orgSections: Section[] = []
  for (const o of visibleOrgs) {
    const ts = orgBuckets.get(o.id!)!
    if (ts.length > 0) {
      orgSections.push({ key: `org-${o.id}`, label: o.name, accentColor: o.color, todos: ts })
    }
  }
  const personSections: Section[] = []
  for (const p of visiblePeople) {
    const ts = personBuckets.get(p.id!)!
    if (ts.length > 0) {
      personSections.push({
        key: `person-${p.id}`,
        label: p.name,
        accentColor: (orgs && personOrgMap) ? resolvePersonColor(p.id, personOrgMap, orgs) : undefined,
        todos: ts,
      })
    }
  }
  return [
    ...orgSections,
    ...personSections,
    ...(unassigned.length > 0 ? [{ key: 'unassigned', label: 'Unassigned', todos: unassigned }] : []),
  ]
}

export function buildProjectSections(
  todos: PersistedTodoItem[],
  projects: Project[],
): Section[] {
  const buckets = new Map<number, PersistedTodoItem[]>()
  for (const p of projects) buckets.set(p.id!, [])
  const noProject: PersistedTodoItem[] = []

  for (const t of todos) {
    const bucket = t.projectId != null ? buckets.get(t.projectId) : undefined
    if (bucket) bucket.push(t)
    else noProject.push(t)
  }

  const sections: Section[] = []
  for (const p of projects) {
    const ts = buckets.get(p.id!)!
    if (ts.length > 0) {
      sections.push({ key: `project-${p.id}`, label: p.name, accentColor: 'var(--color-accent)', todos: ts })
    }
  }
  if (noProject.length > 0) sections.push({ key: 'no-project', label: 'No Project', todos: noProject })
  return sections
}

export function buildOrgSections(
  todos: PersistedTodoItem[],
  orgs: Org[],
  assignedPeopleMap: Map<number, Person[]>,
  assignedOrgsMap: Map<number, Org[]>,
  personOrgMap: Map<number, number[]>,
  filteredOrgIds?: Set<number> | null,
): Section[] {
  const visibleOrgs = filteredOrgIds ? orgs.filter((o) => filteredOrgIds.has(o.id!)) : orgs
  const buckets = new Map<number, PersistedTodoItem[]>()
  for (const o of visibleOrgs) buckets.set(o.id!, [])
  const showNoOrg = !filteredOrgIds || filteredOrgIds.has(0)
  const noOrg: PersistedTodoItem[] = []

  // Single pass: direct org assignments + person→org membership, deduped per todo.
  for (const t of todos) {
    const matchedOrgs = new Set<number>()
    const directOrgs = assignedOrgsMap.get(t.id) ?? []
    for (const o of directOrgs) {
      if (buckets.has(o.id!)) matchedOrgs.add(o.id!)
    }
    const assignedPeople = assignedPeopleMap.get(t.id) ?? []
    for (const p of assignedPeople) {
      const personOrgs = personOrgMap.get(p.id!) ?? []
      for (const oid of personOrgs) {
        if (buckets.has(oid)) matchedOrgs.add(oid)
      }
    }
    if (matchedOrgs.size === 0) {
      if (showNoOrg) noOrg.push(t)
    } else {
      for (const oid of matchedOrgs) buckets.get(oid)!.push(t)
    }
  }

  const sections: Section[] = []
  for (const o of visibleOrgs) {
    const ts = buckets.get(o.id!)!
    if (ts.length > 0) {
      sections.push({ key: `org-${o.id}`, label: o.name, accentColor: o.color, todos: ts })
    }
  }
  if (noOrg.length > 0) sections.push({ key: 'no-org', label: 'No Organization', todos: noOrg })
  return sections
}

export function buildStatusSections(
  todos: PersistedTodoItem[],
  statuses: Status[],
): Section[] {
  const sorted = [...statuses].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  const buckets = new Map<number, PersistedTodoItem[]>()
  for (const s of sorted) buckets.set(s.id!, [])
  const noStatus: PersistedTodoItem[] = []

  for (const t of todos) {
    const bucket = t.statusId != null ? buckets.get(t.statusId) : undefined
    if (bucket) bucket.push(t)
    else noStatus.push(t)
  }

  const sections: Section[] = []
  for (const s of sorted) {
    const ts = buckets.get(s.id!)!
    if (ts.length > 0) {
      sections.push({ key: `status-${s.id}`, label: s.name, accentColor: s.color, todos: ts })
    }
  }
  if (noStatus.length > 0) sections.push({ key: 'no-status', label: 'No Status', todos: noStatus })
  return sections
}

/**
 * Tag grouping explodes a todo with N tags into N buckets (mirrors the
 * people/org many-to-many pattern). Untagged todos land in a "No tag"
 * bucket. Buckets sort alphabetically by tag name. Labels use the
 * registry's canonical casing; accent uses `tag.color`.
 */
export function buildTagSections(
  todos: PersistedTodoItem[],
  tags: Tag[],
  assignedTagsMap: Map<number, Tag[]>,
): Section[] {
  const buckets = new Map<number, PersistedTodoItem[]>()
  for (const tg of tags) buckets.set(tg.id!, [])
  const untagged: PersistedTodoItem[] = []

  for (const t of todos) {
    const assigned = assignedTagsMap.get(t.id) ?? []
    if (assigned.length === 0) { untagged.push(t); continue }
    const seen = new Set<number>()
    for (const tg of assigned) {
      const id = tg.id!
      if (seen.has(id)) continue
      seen.add(id)
      const bucket = buckets.get(id)
      if (bucket) bucket.push(t)
    }
  }

  const sortedTags = [...tags].sort((a, b) => a.name.localeCompare(b.name))
  const sections: Section[] = []
  for (const tg of sortedTags) {
    const ts = buckets.get(tg.id!)!
    if (ts.length > 0) {
      sections.push({
        key: `tag-${tg.id}`,
        label: `#${tg.name}`,
        accentColor: tg.color,
        todos: ts,
      })
    }
  }
  if (untagged.length > 0) sections.push({ key: 'no-tag', label: 'No tag', todos: untagged })
  return sections
}

/**
 * Build a comparator for within-group sort. `'manual'` returns undefined so
 * the caller skips `.sort()` and preserves the upstream sortOrder order.
 */
export function itemSortComparator(
  sortBy: ListItemSortBy,
  today: Date = startOfToday(),
): ((a: PersistedTodoItem, b: PersistedTodoItem) => number) | undefined {
  if (sortBy === 'manual') return undefined
  const pick = (t: PersistedTodoItem): Date | null => {
    if (sortBy === 'date') return effectiveDate(t, today)
    if (sortBy === 'scheduled') return t.scheduledDate ? resolveScheduled(t.scheduledDate, today) : null
    return t.dueDate ? new Date(t.dueDate) : null
  }
  return (a, b) => {
    const ad = pick(a)
    const bd = pick(b)
    if (ad === null && bd === null) {
      return ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id)
    }
    if (ad === null) return 1
    if (bd === null) return -1
    const cmp = ad.getTime() - bd.getTime()
    if (cmp !== 0) return cmp
    return ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || (a.id - b.id)
  }
}

/**
 * Walk sections in order and truncate at the tail so the total task count
 * doesn't exceed `maxTasks`. Returns the clipped sections and how many tasks
 * were hidden.
 */
export function truncateSections(sections: Section[], maxTasks: number): { displaySections: Section[]; truncatedCount: number } {
  let remaining = maxTasks
  let dropped = 0
  const out: Section[] = []
  for (const s of sections) {
    if (remaining <= 0) {
      dropped += s.todos.length
      continue
    }
    if (s.todos.length <= remaining) {
      out.push(s)
      remaining -= s.todos.length
    } else {
      out.push({ ...s, todos: s.todos.slice(0, remaining) })
      dropped += s.todos.length - remaining
      remaining = 0
    }
  }
  return { displaySections: out, truncatedCount: dropped }
}

/**
 * Compute the flat visual index in the CURRENT display where the drop indicator should appear.
 */
function computeDropIndex(
  sectionTodos: PersistedTodoItem[],
  dragTodo: PersistedTodoItem,
): number {
  const idx = sectionTodos.findIndex(t => t.id === dragTodo.id)
  if (idx === -1) return sectionTodos.length
  return idx
}

// --- Droppable section wrapper ---

function DroppableSection({
  sectionKey,
  isOver,
  children,
}: {
  sectionKey: string
  isOver: boolean
  children: React.ReactNode
}) {
  const { setNodeRef } = useDroppable({
    id: `section-${sectionKey}`,
    data: { type: TASK_DROP_KIND.listSection, sectionKey },
  })

  return (
    <div
      ref={setNodeRef}
      className={`${styles.section} ${isOver ? styles.sectionOver : ''}`}
    >
      {children}
    </div>
  )
}

// --- Helpers to parse section keys ---

function parseSectionPersonId(key: string): number | null {
  if (key.startsWith('person-')) return Number(key.slice(7))
  return null
}

function parseSectionProjectId(key: string): number | null | undefined {
  if (key === 'no-project') return undefined
  if (key.startsWith('project-')) return Number(key.slice(8))
  return null // not a project key
}

// --- Pending reassign state ---

interface PendingReassign {
  todo: PersistedTodoItem
  fromKey: string
  toKey: string
  fromLabel: string
  toLabel: string
  attribute: 'person'
}

// --- Favorites chip + selector popup ---

function FavoriteChip({
  def,
  isActive,
  onApply,
}: {
  def: PersistedListDefinition
  isActive: boolean
  onApply: (def: PersistedListDefinition) => void
}) {
  return (
    <div className={`${styles.savedViewChip} ${isActive ? styles.savedViewChipActive : ''}`}>
      <button
        className={styles.savedViewName}
        onClick={() => onApply(def)}
        title="Click to load this list"
      >
        {def.name}
      </button>
    </div>
  )
}

/**
 * Anchor-less overlay listing every `ListDefinition`. Used for both Save (with
 * a leading "+ New" entry) and Load (list only). Each row has a `×` that
 * routes through `onDelete` with a confirmation. Click the row to pick it.
 */
function ListDefinitionSelector({
  defs,
  mode,
  onPickDef,
  onNew,
  onDelete,
  onClose,
}: {
  defs: PersistedListDefinition[]
  mode: 'save' | 'load'
  onPickDef: (def: PersistedListDefinition) => void
  onNew?: () => void
  onDelete: (def: PersistedListDefinition) => void
  onClose: () => void
}) {
  return (
    <>
      <div className={styles.dialogBackdrop} onClick={onClose} />
      <div className={styles.dialog}>
        <div className={styles.dialogTitle}>
          {mode === 'save' ? 'Save list' : 'Load list'}
        </div>
        <div className={styles.selectorList}>
          {mode === 'save' && onNew && (
            <button className={styles.selectorNewRow} onClick={onNew}>
              + New list
            </button>
          )}
          {defs.length === 0 && (
            <div className={styles.selectorEmpty}>No saved lists yet.</div>
          )}
          {defs.map((d) => (
            <div key={d.id} className={styles.selectorRow}>
              <button
                className={styles.selectorName}
                onClick={() => onPickDef(d)}
                title={mode === 'save' ? 'Overwrite this list' : 'Load this list'}
              >
                {d.name}
              </button>
              <button
                className={styles.selectorDelete}
                onClick={(e) => { e.stopPropagation(); onDelete(d) }}
                title="Delete list"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className={styles.dialogActions}>
          <button className={styles.dialogCancel} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </>
  )
}

// --- Main component ---

export function ListView() {
  const { todos, loadAll, update: updateTodo } = useTodoStore()
  const { people, assignedPeopleMap, load: loadPeople, loadAssignments: loadPeopleAssignments, assignPerson, unassignPerson } = usePersonStore()
  const { projects, loadAll: loadAllProjects } = useProjectStore()
  const { orgs, assignedOrgsMap, personOrgMap, load: loadOrgs, loadAssignments: loadOrgAssignments, loadPersonOrgMap } = useOrgStore()
  const tags = useTagStore((s) => s.tags)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const loadTags = useTagStore((s) => s.load)
  const loadTagAssignments = useTagStore((s) => s.loadAssignments)
  const { statuses, load: loadStatuses } = useStatusStore()
  const { listGroupBy, setListGroupBy, listSortBy, setListSortBy, openEditPopup, showBulkConfirmation } = useUIStore()
  const editingListDefId = useUIStore((s) => s.editingListDefId)
  const editingListDefName = useUIStore((s) => s.editingListDefName)
  const clearEditingListDef = useUIStore((s) => s.clearEditingListDef)
  const updateListDefinition = useListDefinitionStore((s) => s.update)
  const allListDefinitions = useListDefinitionStore((s) => s.listDefinitions)
  const loadListDefinitions = useListDefinitionStore((s) => s.load)
  const removeListDefinition = useListDefinitionStore((s) => s.remove)
  const { filters, setAllFilters } = useFilterStore()
  const isFilterActive = useFilterStore((s) => s.isActive)
  const taskEdit = useTaskEditCallbacks()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [activeDragTodo, setActiveDragTodo] = useState<PersistedTodoItem | null>(null)
  const [overSectionKey, setOverSectionKey] = useState<string | null>(null)
  const [pendingReassign, setPendingReassign] = useState<PendingReassign | null>(null)
  const [activeLoadedDefId, setActiveLoadedDefId] = useState<number | null>(null)
  const [showSaveSelector, setShowSaveSelector] = useState(false)
  const [showLoadSelector, setShowLoadSelector] = useState(false)
  const [showNewListPrompt, setShowNewListPrompt] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [newListError, setNewListError] = useState('')
  const addListDefinition = useListDefinitionStore((s) => s.add)
  const isMobile = useIsMobile()

  // Per-view limit controls (persisted via saved views, not globally).
  const [maxTasks, setMaxTasks] = useState<number | null>(null)
  const [limitMode, setLimitMode] = useState<'hard' | 'scroll'>('hard')
  const [maxTasksInput, setMaxTasksInput] = useState('')

  // Per-view runtime-filter state. `spec` persists on the loaded def (via Save);
  // `value` is transient — mirrors widget surfaces, which cache the value per
  // widget but never write it onto the def.
  const [runtimeFilterSpec, setRuntimeFilterSpec] = useState<RuntimeFilterSpec | null>(null)
  const [runtimeFilterValue, setRuntimeFilterValue] = useState<number | undefined>(undefined)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  useEffect(() => {
    loadAll()
    loadPeople()
    loadAllProjects()
    loadOrgs()
    loadTags()
    loadStatuses()
    loadListDefinitions()
  }, [loadAll, loadPeople, loadAllProjects, loadOrgs, loadTags, loadStatuses, loadListDefinitions])

  // Re-load assignment joins only when the set of todo ids changes.
  // Identity-based dep on `todos` would re-fire on every attribute edit;
  // sort-join lets us no-op when the composition is unchanged.
  const todoIdsKey = useMemo(() => {
    const ids = todos.map((t) => t.id)
    ids.sort((a, b) => a - b)
    return ids.join(',')
  }, [todos])
  useEffect(() => {
    if (todoIdsKey.length === 0) return
    const ids = todoIdsKey.split(',').map(Number)
    loadPeopleAssignments(ids)
    loadOrgAssignments(ids)
    loadTagAssignments(ids)
  }, [todoIdsKey, loadPeopleAssignments, loadOrgAssignments, loadTagAssignments])

  useEffect(() => {
    setCollapsed({})
  }, [listGroupBy])

  useEffect(() => {
    loadPersonOrgMap()
  }, [people, orgs, loadPersonOrgMap])

  const projectsById = useMemo(() => new Map(projects.map(p => [p.id!, p])), [projects])

  // When a loaded def declares a runtime filter, merge the picked value into
  // the criteria via the same helper widgets use. If the spec is set but no
  // value is picked yet, the list returns empty — mirrors widget behavior and
  // prompts the user to pick via the visible picker.
  const effectiveFilters = useMemo(() => {
    if (!runtimeFilterSpec || runtimeFilterValue == null) return filters
    const narrowed = applyRuntimeFilter(criteriaToPredicate(filters), runtimeFilterSpec, runtimeFilterValue)
    return predicateToCriteria(narrowed)
  }, [filters, runtimeFilterSpec, runtimeFilterValue])

  const activeTodos = useMemo(() => {
    if (runtimeFilterSpec && runtimeFilterValue == null) return []
    return applyFilter(effectiveFilters, todos, assignedPeopleMap, personOrgMap, assignedOrgsMap, statuses, undefined, projectsById, assignedTagsMap)
  }, [todos, effectiveFilters, assignedPeopleMap, personOrgMap, assignedOrgsMap, statuses, projectsById, assignedTagsMap, runtimeFilterSpec, runtimeFilterValue])

  const sections = useMemo(() => {
    switch (listGroupBy) {
      case 'none':
        return buildFlatSection(activeTodos)
      case 'date':
        return buildDateSections(activeTodos)
      case 'scheduled':
        return buildScheduledSections(activeTodos)
      case 'deadline':
        return buildDeadlineSections(activeTodos)
      case 'people':
        return buildPeopleSections(activeTodos, people, assignedPeopleMap, orgs, assignedOrgsMap, personOrgMap, filters.orgIds)
      case 'project':
        return buildProjectSections(activeTodos, projects)
      case 'org':
        return buildOrgSections(activeTodos, orgs, assignedPeopleMap, assignedOrgsMap, personOrgMap, filters.orgIds)
      case 'status':
        return buildStatusSections(activeTodos, statuses)
      case 'tag':
        return buildTagSections(activeTodos, tags, assignedTagsMap)
    }
  }, [listGroupBy, activeTodos, people, assignedPeopleMap, assignedOrgsMap, projects, orgs, personOrgMap, filters.orgIds, statuses, tags, assignedTagsMap])

  const withinGroupComparator = useMemo(
    () => itemSortComparator(listSortBy),
    [listSortBy],
  )

  // Apply hard limit by walking sections in order and truncating at the tail.
  // Scroll mode leaves sections intact and bounds the container instead.
  const { displaySections, truncatedCount } = useMemo(() => {
    if (maxTasks == null || limitMode !== 'hard') {
      return { displaySections: sections, truncatedCount: 0 }
    }
    return truncateSections(sections, maxTasks)
  }, [sections, maxTasks, limitMode])

  const statusMap = useMemo(() => new Map(statuses.map(s => [s.id!, s])), [statuses])

  const sectionLabelMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of sections) map.set(s.key, s.label)
    return map
  }, [sections])

  const toggleSection = useCallback((key: string) => {
    setCollapsed((s) => ({ ...s, [key]: !s[key] }))
  }, [])

  const handleClick = useCallback((todoId: number) => {
    openEditPopup(todoId)
  }, [openEditPopup])

  // --- Lists: Save / Load / Favorites (unified Phase 3 flow) ---

  const favoritedDefs = useMemo(
    () => allListDefinitions.filter((d) => d.favorited).sort((a, b) => a.sortOrder - b.sortOrder),
    [allListDefinitions],
  )

  const allDefsSorted = useMemo(
    () => [...allListDefinitions].sort((a, b) => a.sortOrder - b.sortOrder),
    [allListDefinitions],
  )

  const applyDefinition = useCallback((def: PersistedListDefinition) => {
    if (def.membership.kind !== 'custom') return
    setAllFilters(predicateToCriteria(def.membership.predicate))
    if (def.grouping.kind === 'by-field') setListGroupBy(def.grouping.by)
    else if (def.grouping.kind === 'by-tag') setListGroupBy('tag')
    else if (def.grouping.kind === 'by-sortBy' && def.sort.kind === 'sortBy') setListGroupBy(def.sort.by)
    else setListGroupBy('none')
    // ListItemSortBy is a subset of ListSortBy — coerce unsupported values to manual.
    const ITEM_SORTS: ListItemSortBy[] = ['manual', 'date', 'scheduled', 'deadline']
    const itemSort: ListItemSortBy = def.sort.kind === 'sortBy' && (ITEM_SORTS as string[]).includes(def.sort.by)
      ? def.sort.by as ListItemSortBy
      : 'manual'
    setListSortBy(itemSort)
    setMaxTasks(def.maxTasks ?? null)
    setMaxTasksInput(def.maxTasks != null ? String(def.maxTasks) : '')
    setLimitMode(def.limitMode ?? 'hard')
    setRuntimeFilterSpec(def.runtimeFilter ?? null)
    setRuntimeFilterValue(undefined)
    setActiveLoadedDefId(def.id)
  }, [setAllFilters, setListGroupBy, setListSortBy])

  // Clear the active-loaded highlight once the user edits any input externally.
  // `runtimeFilterValue` is intentionally omitted — only the spec is persisted
  // on the def, so only spec edits should flag the def as dirty.
  const applyingRef = useRef(false)
  useEffect(() => {
    if (applyingRef.current) { applyingRef.current = false; return }
    setActiveLoadedDefId(null)
  }, [filters, listGroupBy, listSortBy, maxTasks, limitMode, runtimeFilterSpec])

  const applyAndMarkLoaded = useCallback((def: PersistedListDefinition) => {
    applyingRef.current = true
    applyDefinition(def)
  }, [applyDefinition])

  const writeCurrentStateToDef = useCallback(async (def: PersistedListDefinition) => {
    const { sort, grouping } = encodeGroupSort(listGroupBy, listSortBy)
    await updateListDefinition({
      ...def,
      membership: { kind: 'custom', predicate: criteriaToPredicate(filters) },
      sort,
      grouping,
      ...(maxTasks != null ? { maxTasks } : { maxTasks: undefined as unknown as number | undefined }),
      ...(maxTasks != null ? { limitMode } : { limitMode: undefined }),
      runtimeFilter: runtimeFilterSpec ?? undefined,
    } as PersistedListDefinition)
    applyingRef.current = true
    setActiveLoadedDefId(def.id)
  }, [listGroupBy, listSortBy, filters, maxTasks, limitMode, runtimeFilterSpec, updateListDefinition])

  const handleSaveClick = useCallback(() => {
    setShowSaveSelector(true)
  }, [])

  const handleLoadClick = useCallback(() => {
    setShowLoadSelector(true)
  }, [])

  const handleSavePickDef = useCallback((def: PersistedListDefinition) => {
    showBulkConfirmation('custom', [], {
      title: `Overwrite "${def.name}"?`,
      message: 'Replaces its filter, grouping, and sort with the current view.',
      confirmLabel: 'Overwrite',
      onConfirm: async () => {
        await writeCurrentStateToDef(def)
        setShowSaveSelector(false)
      },
    })
  }, [showBulkConfirmation, writeCurrentStateToDef])

  const handleSaveNew = useCallback(() => {
    setNewListName('')
    setNewListError('')
    setShowSaveSelector(false)
    setShowNewListPrompt(true)
  }, [])

  const handleConfirmNewList = useCallback(async () => {
    const name = newListName.trim()
    if (!name) return
    try {
      const { sort, grouping } = encodeGroupSort(listGroupBy, listSortBy)
      const id = await addListDefinition({
        name,
        membership: { kind: 'custom', predicate: criteriaToPredicate(filters) },
        sort,
        grouping,
        pinnedToDashboard: false,
        favorited: true,
        ...(maxTasks != null ? { maxTasks, limitMode } : {}),
        ...(runtimeFilterSpec ? { runtimeFilter: runtimeFilterSpec } : {}),
      })
      applyingRef.current = true
      setActiveLoadedDefId(id)
      setShowNewListPrompt(false)
      setNewListName('')
    } catch (e) {
      setNewListError((e as Error).message)
    }
  }, [newListName, addListDefinition, filters, listGroupBy, listSortBy, maxTasks, limitMode, runtimeFilterSpec])

  const handleLoadPickDef = useCallback((def: PersistedListDefinition) => {
    // Unsaved-edits guard: if a def was last loaded and state diverged, prompt.
    const dirty = activeLoadedDefId !== null && activeLoadedDefId !== def.id
    if (dirty) {
      showBulkConfirmation('custom', [], {
        title: 'Discard current changes?',
        message: `Load "${def.name}" and replace the current filters/grouping.`,
        confirmLabel: 'Load',
        onConfirm: () => {
          applyAndMarkLoaded(def)
          setShowLoadSelector(false)
        },
      })
      return
    }
    applyAndMarkLoaded(def)
    setShowLoadSelector(false)
  }, [activeLoadedDefId, applyAndMarkLoaded, showBulkConfirmation])

  const handleDeleteFromSelector = useCallback((def: PersistedListDefinition) => {
    showBulkConfirmation('custom', [], {
      title: `Delete list "${def.name}"?`,
      message: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      onConfirm: () => removeListDefinition(def.id),
    })
  }, [showBulkConfirmation, removeListDefinition])

  const handleSaveEditedPreset = useCallback(async () => {
    if (editingListDefId == null) return
    const def = allListDefinitions.find((d) => d.id === editingListDefId)
    if (!def) { clearEditingListDef(); return }
    const { sort, grouping } = encodeGroupSort(listGroupBy, listSortBy)
    await updateListDefinition({
      ...def,
      membership: { kind: 'custom', predicate: criteriaToPredicate(filters) },
      sort,
      grouping,
    })
    clearEditingListDef()
  }, [editingListDefId, allListDefinitions, updateListDefinition, filters, listGroupBy, listSortBy, clearEditingListDef])

  // --- DnD handlers ---

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const todo = event.active.data.current?.todo as PersistedTodoItem | undefined
    if (todo) setActiveDragTodo(todo)
  }, [])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overData = event.over?.data.current
    if (overData?.type === TASK_DROP_KIND.listSection) {
      setOverSectionKey(overData.sectionKey)
    } else {
      setOverSectionKey(null)
    }
  }, [])

  const performDrop = useCallback((todo: PersistedTodoItem, fromKey: string, toKey: string) => {
    const now = new Date()

    if (listGroupBy === 'project') {
      const newProjectId = parseSectionProjectId(toKey)
      if (newProjectId !== null && newProjectId !== todo.projectId) {
        updateTodo({ ...todo, projectId: newProjectId, modifiedAt: now })
      }
    } else if (listGroupBy === 'people') {
      const fromLabel = sectionLabelMap.get(fromKey) ?? fromKey
      const toLabel = sectionLabelMap.get(toKey) ?? toKey
      setPendingReassign({ todo, fromKey, toKey, fromLabel, toLabel, attribute: 'person' })
    } else if (listGroupBy === 'status') {
      const newStatusId = toKey === 'no-status' ? undefined : toKey.startsWith('status-') ? Number(toKey.slice(7)) : null
      if (newStatusId !== null && newStatusId !== todo.statusId) {
        updateTodo({ ...todo, statusId: newStatusId, modifiedAt: now })
      }
    }
    // Chronological / org / none groupings — no reassignment (ambiguous targets)
  }, [listGroupBy, sectionLabelMap, updateTodo])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragTodo(null)
    setOverSectionKey(null)

    const todo = event.active.data.current?.todo as PersistedTodoItem | undefined
    const fromKey = event.active.data.current?.sectionKey as string | undefined
    const overData = event.over?.data.current
    const toKey = overData?.type === TASK_DROP_KIND.listSection ? overData.sectionKey as string : null

    if (!todo || !fromKey || !toKey || fromKey === toKey) return

    performDrop(todo, fromKey, toKey)
  }, [performDrop])

  const confirmReassign = useCallback(async () => {
    if (!pendingReassign) return
    const { todo, fromKey, toKey, attribute } = pendingReassign

    if (attribute === 'person') {
      const fromPersonId = parseSectionPersonId(fromKey)
      const toPersonId = parseSectionPersonId(toKey)
      if (fromPersonId != null) await unassignPerson(todo.id, fromPersonId)
      if (toPersonId != null) await assignPerson(todo.id, toPersonId)
    }

    setPendingReassign(null)
    await loadAll()
  }, [pendingReassign, assignPerson, unassignPerson, loadAll])

  const cancelReassign = useCallback(() => {
    setPendingReassign(null)
  }, [])

  const isDndEnabled =
    !isMobile &&
    (listGroupBy === 'project' || listGroupBy === 'people' || listGroupBy === 'status')
  const totalActive = activeTodos.length

  const pageContent = (
    <>
      <div className={styles.page} onClick={() => useUIStore.getState().clearSelection()}>
        <div className={`${styles.container} ${styles.medium}`}>
          <div className={styles.pageHeader}>
            <div className={styles.pageTitle}>List</div>
            <div className={styles.pageSubtitle}>{totalActive} active tasks</div>
          </div>

          {editingListDefId !== null && (
            <div className={styles.editingPresetBanner}>
              <span className={styles.editingPresetLabel}>
                Editing preset <strong>{editingListDefName ?? '…'}</strong>
              </span>
              <button className={styles.editingPresetSave} onClick={handleSaveEditedPreset}>Save changes</button>
              <button className={styles.editingPresetCancel} onClick={clearEditingListDef}>Cancel</button>
            </div>
          )}

          {favoritedDefs.length > 0 && (
            <div className={styles.savedViewsBar}>
              {favoritedDefs.map((def) => (
                <FavoriteChip
                  key={def.id}
                  def={def}
                  isActive={activeLoadedDefId === def.id}
                  onApply={applyAndMarkLoaded}
                />
              ))}
            </div>
          )}

          <div className={styles.toolbar}>
            <div className={styles.toolbarControls}>
              <div className={styles.toolbarField}>
                <span className={styles.toolbarLabel}>Group</span>
                <IconSelect<ListGroupBy>
                  value={listGroupBy}
                  options={groupByOptions}
                  onChange={(v) => setListGroupBy(v)}
                  ariaLabel="Group tasks by"
                />
              </div>
              <div className={styles.toolbarField}>
                <span className={styles.toolbarLabel}>Sort</span>
                <IconSelect<ListItemSortBy>
                  value={listSortBy}
                  options={itemSortByOptions}
                  onChange={(v) => setListSortBy(v)}
                  ariaLabel="Sort tasks by"
                />
              </div>
              <div className={styles.toolbarField}>
                <span className={styles.toolbarLabel}>Max</span>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  className={styles.maxInput}
                  placeholder="All"
                  value={maxTasksInput}
                  aria-label="Maximum visible tasks"
                  onChange={(e) => {
                    const raw = e.target.value
                    setMaxTasksInput(raw)
                    if (raw.trim() === '') { setMaxTasks(null); return }
                    const n = Number(raw)
                    if (Number.isFinite(n) && n >= 1) setMaxTasks(Math.floor(n))
                  }}
                />
              </div>
              {maxTasks != null && (
                <div className={styles.limitModeGroup} role="group" aria-label="Limit mode">
                  <button
                    type="button"
                    className={`${styles.limitModeBtn} ${limitMode === 'hard' ? styles.limitModeBtnActive : ''}`}
                    onClick={() => setLimitMode('hard')}
                    title="Hide tasks beyond the limit"
                  >Hard</button>
                  <button
                    type="button"
                    className={`${styles.limitModeBtn} ${limitMode === 'scroll' ? styles.limitModeBtnActive : ''}`}
                    onClick={() => setLimitMode('scroll')}
                    title="Show all tasks inside a scrollable region"
                  >Scroll</button>
                </div>
              )}
              <div className={styles.toolbarField}>
                <span
                  className={styles.toolbarLabel}
                  title="Prompt for a value at render time — e.g. 'Tasks for {assignee}'."
                >
                  Prompt
                </span>
                <select
                  className={styles.runtimeSelect}
                  value={runtimeFilterSpec?.field ?? 'none'}
                  aria-label="Runtime filter field"
                  onChange={(e) => {
                    const next = e.target.value as RuntimeFilterField | 'none'
                    if (next === 'none') {
                      setRuntimeFilterSpec(null)
                    } else {
                      setRuntimeFilterSpec({ field: next })
                    }
                    setRuntimeFilterValue(undefined)
                  }}
                >
                  {runtimeFilterOptions.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className={styles.toolbarActions}>
              <button
                className={styles.toolbarActionBtn}
                onClick={handleLoadClick}
                title="Load a saved list"
              >
                Load
              </button>
              <button
                className={styles.toolbarActionBtn}
                onClick={handleSaveClick}
                title="Save the current filter + grouping as a list"
              >
                Save
              </button>
              <button
                className={styles.toolbarActionBtn}
                onClick={() => {
                  const copySections: CopyTaskSection[] = displaySections.map((s) => ({
                    label: listGroupBy === 'none' ? undefined : s.label,
                    todos: s.todos,
                  }))
                  void copyTasksRich(copySections, { assignedPeopleMap, statusMap })
                }}
                title="Copy tasks"
              >
                ⧉
              </button>
            </div>
          </div>

          {runtimeFilterSpec && (
            <div className={styles.runtimeFilterWrap}>
              <RuntimeFilterPicker
                spec={runtimeFilterSpec}
                value={runtimeFilterValue}
                onChange={setRuntimeFilterValue}
              />
            </div>
          )}

          {totalActive === 0 && (
            <div className={styles.empty}>
              {runtimeFilterSpec && runtimeFilterValue == null ? (
                `Pick a ${(runtimeFilterSpec.label ?? runtimeFilterSpec.field).toLowerCase()} to populate this list.`
              ) : isFilterActive ? (
                <>
                  No tasks match your current filters.
                  <button className={styles.clearFiltersButton} onClick={() => useFilterStore.getState().clearAll()}>Clear filters</button>
                </>
              ) : (
                'No active tasks.'
              )}
            </div>
          )}

          {(() => {
            const sectionEls = displaySections.map((section) => {
              const isCollapsed = !!collapsed[section.key]
              const isOver = overSectionKey === section.key
              const dropIdx = (isOver && activeDragTodo)
                ? computeDropIndex(section.todos, activeDragTodo)
                : undefined
              const hideHeader = listGroupBy === 'none'
              return (
                <DroppableSection key={section.key} sectionKey={section.key} isOver={isOver}>
                  {!hideHeader && (
                    <SectionHeader
                      label={section.label}
                      count={section.todos.length}
                      accentColor={section.accentColor}
                      collapsed={isCollapsed}
                      onToggle={() => toggleSection(section.key)}
                    />
                  )}
                  {!isCollapsed && (
                    <div className={styles.taskList}>
                      <TaskList
                        todos={section.todos}
                        assignedPeopleMap={assignedPeopleMap}
                        draggable={isDndEnabled}
                        sectionKey={section.key}
                        dropIndicatorIndex={dropIdx}
                        rootComparator={withinGroupComparator}
                        onOpenDetail={handleClick}
                      />
                    </div>
                  )}
                </DroppableSection>
              )
            })

            if (maxTasks != null && limitMode === 'scroll') {
              // Heuristic height: 28px/row + ~32px/section-header offset.
              const headerCount = listGroupBy === 'none' ? 0 : displaySections.length
              const maxHeight = `calc(${maxTasks} * 28px + ${headerCount} * 32px + 16px)`
              return (
                <div className={styles.scrollRegion} style={{ maxHeight }}>
                  {sectionEls}
                </div>
              )
            }
            return sectionEls
          })()}

          {maxTasks != null && limitMode === 'hard' && truncatedCount > 0 && (
            <div className={styles.limitIndicator}>
              Showing {maxTasks} of {maxTasks + truncatedCount} tasks —{' '}
              <button
                type="button"
                className={styles.limitIndicatorAction}
                onClick={() => setLimitMode('scroll')}
              >switch to scroll</button>
            </div>
          )}
        </div>

        {taskEdit.editPopupMode === 'edit' && taskEdit.editProps && (
          <TaskEditPopup
            mode="edit"
            {...taskEdit.editProps}
            allPeople={taskEdit.allPeople}
            allOrgs={taskEdit.allOrgs}
            onClose={taskEdit.closeEditPopup}
            {...taskEdit.entityCreators}
          />
        )}

        {taskEdit.editPopupMode === 'create' && (
          <TaskEditPopup
            mode="create"
            assignedPeople={[]}
            allPeople={taskEdit.allPeople}
            onClose={taskEdit.closeEditPopup}
            onCreate={taskEdit.onCreate}
            assignedOrgs={[]}
            allOrgs={taskEdit.allOrgs}
            assignedTags={[]}
            allTags={taskEdit.allTags}
            onAssignPerson={() => {}}
            onUnassignPerson={() => {}}
            onAssignOrg={() => {}}
            onUnassignOrg={() => {}}
            onAssignTag={() => {}}
            onUnassignTag={() => {}}
            {...taskEdit.entityCreators}
          />
        )}

        {pendingReassign && (
          <ReassignDialog
            taskTitle={pendingReassign.todo.title}
            fromLabel={pendingReassign.fromLabel}
            toLabel={pendingReassign.toLabel}
            attribute={pendingReassign.attribute}
            onConfirm={confirmReassign}
            onCancel={cancelReassign}
          />
        )}
      </div>
      <FilteredListPopup />
      {showSaveSelector && createPortal(
        <ListDefinitionSelector
          defs={allDefsSorted}
          mode="save"
          onPickDef={handleSavePickDef}
          onNew={handleSaveNew}
          onDelete={handleDeleteFromSelector}
          onClose={() => setShowSaveSelector(false)}
        />,
        document.body,
      )}
      {showLoadSelector && createPortal(
        <ListDefinitionSelector
          defs={allDefsSorted}
          mode="load"
          onPickDef={handleLoadPickDef}
          onDelete={handleDeleteFromSelector}
          onClose={() => setShowLoadSelector(false)}
        />,
        document.body,
      )}
      {showNewListPrompt && (
        <>
          <div className={styles.dialogBackdrop} onClick={() => setShowNewListPrompt(false)} />
          <div className={styles.dialog}>
            <div className={styles.dialogTitle}>New list</div>
            <div className={styles.dialogHint}>
              Captures current filter + grouping as a reusable list and adds it to Favorites.
            </div>
            <input
              className={styles.dialogInput}
              value={newListName}
              onChange={(e) => { setNewListName(e.target.value); setNewListError('') }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmNewList()
                if (e.key === 'Escape') setShowNewListPrompt(false)
              }}
              placeholder="List name"
              autoFocus
            />
            {newListError && <div className={styles.dialogError}>{newListError}</div>}
            <div className={styles.dialogActions}>
              <button className={styles.dialogCancel} onClick={() => setShowNewListPrompt(false)}>Cancel</button>
              <button className={styles.dialogConfirm} onClick={handleConfirmNewList} disabled={!newListName.trim()}>Save</button>
            </div>
          </div>
        </>
      )}
    </>
  )

  if (isMobile) return pageContent

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {pageContent}
      <DragOverlay dropAnimation={null}>
        {activeDragTodo && (
          <div className={styles.dragOverlay}>
            <TaskRow
              todo={activeDragTodo}
              ghost
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
