import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'
import { useProjectStore } from '../stores/project-store'
import { useOrgStore } from '../stores/org-store'
import { useStatusStore } from '../stores/status-store'
import { useSettingsStore } from '../stores/settings-store'
import { useUIStore } from '../stores/ui-store'
import { useFilterStore, applyFilter, criteriaToPredicate } from '../stores/filter-store'
import { useSavedViewStore, savedFiltersToRuntime, resolveSavedViewGrouping } from '../stores/saved-view-store'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useTaskEditCallbacks } from '../hooks/use-task-edit-callbacks'
import { TaskList } from '../components/task/TaskList'
import { TaskRow } from '../components/task/TaskRow'
import { TaskEditPopup } from '../components/task/TaskEditPopup'
import { SectionHeader } from '../components/shared/SectionHeader'
import { ReassignDialog } from '../components/overlays/ReassignDialog'
import { FilteredListPopup } from '../components/overlays/FilteredListPopup'
import { PlainTextExportPopup } from '../components/overlays/PlainTextExportPopup'
import { CanvasContextMenu, type ContextMenuItem } from '../components/overlays/CanvasContextMenu'
import { createPortal } from 'react-dom'
import type { PersistedTodoItem, Person, Tag, Project, Org, Status, ListSortBy, ListGroupBy, ListItemSortBy } from '../models'
import type { ListGrouping, ListSort } from '../models/list-definition'
import { startOfToday, MS_PER_DAY } from '../utils/date'
import { effectiveDate, resolveScheduled } from '../utils/effective-date'
import { buildHierarchy } from '../utils/hierarchy'
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
  { value: 'date', label: 'Date', icon: groupByIcons.date },
  { value: 'scheduled', label: 'Scheduled', icon: groupByIcons.scheduled },
  { value: 'deadline', label: 'Deadline', icon: groupByIcons.deadline },
  { value: 'project', label: 'Project', icon: groupByIcons.project },
  { value: 'status', label: 'Status', icon: groupByIcons.status },
  { value: 'people', label: 'People', icon: groupByIcons.people },
  { value: 'org', label: 'Org', icon: groupByIcons.org },
  { value: 'tag', label: 'Tag', icon: groupByIcons.tag },
]

const itemSortByOptions: { value: ListItemSortBy; label: string; icon: React.ReactNode }[] = [
  { value: 'manual', label: 'Manual', icon: itemSortByIcons.manual },
  { value: 'date', label: 'Date', icon: itemSortByIcons.date },
  { value: 'scheduled', label: 'Scheduled', icon: itemSortByIcons.scheduled },
  { value: 'deadline', label: 'Deadline', icon: itemSortByIcons.deadline },
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
  const orgSections: Section[] = []
  const personSections: Section[] = []
  const orgClaimedIds = new Set<number>()

  // When an org filter is active, only show people who belong to at least one filtered org
  const visiblePeople = (filteredOrgIds && personOrgMap)
    ? people.filter((p) => {
        const memberOrgIds = personOrgMap.get(p.id!) ?? []
        return memberOrgIds.some((orgId) => filteredOrgIds.has(orgId))
      })
    : people

  // 1. Tasks with direct org assignment go into org sections first
  if (orgs && assignedOrgsMap) {
    const visibleOrgs = filteredOrgIds ? orgs.filter((o) => filteredOrgIds.has(o.id!)) : orgs
    for (const org of visibleOrgs) {
      const orgTodos = todos.filter((t) => {
        const todoOrgs = assignedOrgsMap.get(t.id) ?? []
        return todoOrgs.some((o) => o.id === org.id)
      })
      if (orgTodos.length > 0) {
        for (const t of orgTodos) orgClaimedIds.add(t.id)
        orgSections.push({
          key: `org-${org.id}`,
          label: org.name,
          accentColor: org.color,
          todos: orgTodos,
        })
      }
    }
  }

  // 2. Remaining tasks (no direct org) grouped by person
  const personClaimedIds = new Set<number>()
  for (const person of visiblePeople) {
    const personTodos = todos.filter((t) => {
      if (orgClaimedIds.has(t.id)) return false
      const assigned = assignedPeopleMap.get(t.id) ?? []
      return assigned.some((p) => p.id === person.id)
    })
    if (personTodos.length > 0) {
      for (const t of personTodos) personClaimedIds.add(t.id)
      personSections.push({
        key: `person-${person.id}`,
        label: person.name,
        accentColor: person.color,
        todos: personTodos,
      })
    }
  }

  // 3. Unassigned: neither org-assigned nor person-assigned
  const remaining = todos.filter((t) => !orgClaimedIds.has(t.id) && !personClaimedIds.has(t.id))
  return [
    ...orgSections,
    ...personSections,
    ...(remaining.length > 0 ? [{ key: 'unassigned', label: 'Unassigned', todos: remaining }] : []),
  ]
}

export function buildTagSections(
  todos: PersistedTodoItem[],
  tags: Tag[],
  assignedTagsMap: Map<number, Tag[]>,
): Section[] {
  const sections: Section[] = []
  const taggedTodoIds = new Set<number>()

  for (const tag of tags) {
    const tagTodos = todos.filter((t) => {
      const assigned = assignedTagsMap.get(t.id) ?? []
      return assigned.some((tg) => tg.id === tag.id)
    })
    if (tagTodos.length > 0) {
      for (const t of tagTodos) taggedTodoIds.add(t.id)
      sections.push({
        key: `tag-${tag.id}`,
        label: tag.name,
        accentColor: tag.color,
        todos: tagTodos,
      })
    }
  }

  const untagged = todos.filter((t) => !taggedTodoIds.has(t.id))
  if (untagged.length > 0) {
    sections.push({ key: 'untagged', label: 'No Tags', todos: untagged })
  }
  return sections
}

export function buildProjectSections(
  todos: PersistedTodoItem[],
  projects: Project[],
): Section[] {
  const sections: Section[] = []
  const projectMap = new Map(projects.map((p) => [p.id!, p]))

  for (const project of projects) {
    const projectTodos = todos.filter((t) => t.projectId === project.id)
    if (projectTodos.length > 0) {
      sections.push({
        key: `project-${project.id}`,
        label: project.name,
        accentColor: 'var(--color-accent)',
        todos: projectTodos,
      })
    }
  }

  const noProject = todos.filter((t) => !t.projectId || !projectMap.has(t.projectId))
  if (noProject.length > 0) {
    sections.push({ key: 'no-project', label: 'No Project', todos: noProject })
  }
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
  const sections: Section[] = []
  const orgTodoIds = new Set<number>()
  // Build reverse map: orgId -> Set<personId>
  const peopleByOrg = new Map<number, Set<number>>()
  for (const [personId, orgIds] of personOrgMap) {
    for (const orgId of orgIds) {
      const set = peopleByOrg.get(orgId) ?? new Set()
      set.add(personId)
      peopleByOrg.set(orgId, set)
    }
  }

  // Only show sections for filtered orgs when an org filter is active
  const visibleOrgs = filteredOrgIds ? orgs.filter((o) => filteredOrgIds.has(o.id!)) : orgs

  for (const org of visibleOrgs) {
    const orgPersonIds = peopleByOrg.get(org.id!) ?? new Set()
    const orgTodos = todos.filter((t) => {
      // Match by direct org assignment
      const directOrgs = assignedOrgsMap.get(t.id) ?? []
      if (directOrgs.some((o) => o.id === org.id)) return true
      // Match by assigned person's org
      const assignedPeople = assignedPeopleMap.get(t.id) ?? []
      return assignedPeople.some((p) => orgPersonIds.has(p.id!))
    })
    if (orgTodos.length > 0) {
      for (const t of orgTodos) orgTodoIds.add(t.id)
      sections.push({
        key: `org-${org.id}`,
        label: org.name,
        accentColor: org.color,
        todos: orgTodos,
      })
    }
  }

  // Show "No Organization" section when filter includes unaffiliated (id 0) or no filter is active
  if (!filteredOrgIds || filteredOrgIds.has(0)) {
    const noOrg = todos.filter((t) => !orgTodoIds.has(t.id))
    if (noOrg.length > 0) {
      sections.push({ key: 'no-org', label: 'No Organization', todos: noOrg })
    }
  }
  return sections
}

export function buildStatusSections(
  todos: PersistedTodoItem[],
  statuses: Status[],
): Section[] {
  const sections: Section[] = []
  const statusMap = new Map(statuses.map(s => [s.id!, s]))
  const sorted = [...statuses].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))

  for (const status of sorted) {
    const statusTodos = todos.filter(t => t.statusId === status.id)
    if (statusTodos.length > 0) {
      sections.push({
        key: `status-${status.id}`,
        label: status.name,
        accentColor: status.color,
        todos: statusTodos,
      })
    }
  }

  const noStatus = todos.filter(t => !t.statusId || !statusMap.has(t.statusId))
  if (noStatus.length > 0) {
    sections.push({ key: 'no-status', label: 'No Status', todos: noStatus })
  }
  return sections
}

/**
 * Build a comparator for within-group sort. `'manual'` returns undefined so
 * `buildHierarchy` falls through to its sortOrder default.
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
    if (ad === null && bd === null) return (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    if (ad === null) return 1
    if (bd === null) return -1
    const cmp = ad.getTime() - bd.getTime()
    if (cmp !== 0) return cmp
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
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
 * Encode current groupBy + itemSortBy into a list-definition's `sort` + `grouping`.
 * Symmetric with `resolveGroupBy` / `resolveItemSortBy` in DashboardListsEditor.
 */
export function encodeGroupSort(
  groupBy: ListGroupBy,
  itemSortBy: ListItemSortBy,
): { sort: ListSort; grouping: ListGrouping } {
  const sort: ListSort = itemSortBy === 'manual'
    ? { kind: 'sort-order' }
    : { kind: 'sortBy', by: itemSortBy }

  let grouping: ListGrouping
  if (groupBy === 'none') {
    grouping = { kind: 'none' }
  } else if (itemSortBy !== 'manual' && groupBy === itemSortBy) {
    grouping = { kind: 'by-sortBy' }
  } else {
    grouping = { kind: 'by-field', by: groupBy }
  }
  return { sort, grouping }
}

export function addGhostParents(sectionTodos: PersistedTodoItem[], allTodos: PersistedTodoItem[]): { todos: PersistedTodoItem[]; ghostIds: Set<number> } {
  const sectionIds = new Set(sectionTodos.map((t) => t.id))
  const allById = new Map(allTodos.map((t) => [t.id, t]))
  const ghostIds = new Set<number>()
  const result = [...sectionTodos]

  for (const todo of sectionTodos) {
    if (todo.parentId != null && !sectionIds.has(todo.parentId)) {
      const parent = allById.get(todo.parentId)
      if (parent && !ghostIds.has(parent.id)) {
        ghostIds.add(parent.id)
        result.push(parent)
      }
    }
  }

  return { todos: result, ghostIds }
}

/**
 * Compute the flat visual index in the CURRENT display where the drop indicator should appear.
 * Simulates the post-drop hierarchy to find where the drag todo lands, then maps back to the
 * current flat list by finding the first non-drag item after the drag block.
 */
function computeDropIndex(
  sectionTodos: PersistedTodoItem[],
  allTodos: PersistedTodoItem[],
  dragTodo: PersistedTodoItem,
  collapsedParents: Set<number>,
): number {
  const dragChildren = allTodos.filter(t => t.parentId === dragTodo.id)
  const dragIds = new Set([dragTodo.id, ...dragChildren.map(c => c.id)])
  const withoutDrag = sectionTodos.filter(t => !dragIds.has(t.id))

  // Helper: flatten a hierarchy respecting collapsed state
  const flatten = (hierarchy: ReturnType<typeof buildHierarchy>): number[] => {
    const flat: number[] = []
    for (const { parent, children } of hierarchy) {
      flat.push(parent.id)
      if (children.length > 0 && !collapsedParents.has(parent.id)) {
        for (const child of children) flat.push(child.id)
      }
    }
    return flat
  }

  // Same-section hover: the drag task is already displayed (as a placeholder),
  // so post-drop ghost parents match the current display — index maps directly
  if (sectionTodos.some(t => t.id === dragTodo.id)) {
    const merged = [...withoutDrag, dragTodo, ...dragChildren]
    const { todos: withGhosts } = addGhostParents(merged, allTodos)
    const postFlat = flatten(buildHierarchy(withGhosts))
    const idx = postFlat.indexOf(dragTodo.id)
    return idx >= 0 ? idx : postFlat.length
  }

  // Cross-section: post-drop list may have new ghost parents that the current
  // display doesn't, so map via the first non-drag item after the drag block
  const merged = [...withoutDrag, dragTodo, ...dragChildren]
  const { todos: mergedGhosts } = addGhostParents(merged, allTodos)
  const postFlat = flatten(buildHierarchy(mergedGhosts))

  const dragStart = postFlat.indexOf(dragTodo.id)
  if (dragStart < 0) return 0

  let dragEnd = dragStart
  while (dragEnd + 1 < postFlat.length && dragIds.has(postFlat[dragEnd + 1])) dragEnd++

  const afterId = dragEnd + 1 < postFlat.length ? postFlat[dragEnd + 1] : null

  const { todos: currentGhosts } = addGhostParents(sectionTodos, allTodos)
  const currentFlat = flatten(buildHierarchy(currentGhosts))

  if (afterId == null) return currentFlat.length
  const idx = currentFlat.indexOf(afterId)
  return idx >= 0 ? idx : currentFlat.length
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
    data: { type: 'section', sectionKey },
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

function parseSectionTagId(key: string): number | null {
  if (key.startsWith('tag-')) return Number(key.slice(4))
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
  attribute: 'person' | 'tag'
}

// --- Sortable saved view chip ---

interface SortableViewChipProps {
  view: import('../models').PersistedSavedView
  isActive: boolean
  isRenaming: boolean
  renameText: string
  onRenameChange: (text: string) => void
  onFinishRename: () => void
  onCancelRename: () => void
  onApply: (view: { sortBy: ListSortBy; filters: import('../models/saved-view').SavedViewFilters; id: number }) => void
  onStartRename: (id: number, name: string) => void
  onContextMenu: (e: React.MouseEvent, view: { id: number; name: string }) => void
  onRemove: (id: number, name: string) => void
}

function SortableViewChip({
  view, isActive, isRenaming, renameText, onRenameChange,
  onFinishRename, onCancelRename, onApply, onStartRename, onContextMenu, onRemove,
}: SortableViewChipProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: view.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.savedViewChip} ${isActive ? styles.savedViewChipActive : ''}`}
      {...attributes}
      {...listeners}
      onContextMenu={(e) => onContextMenu(e, view)}
    >
      {isRenaming ? (
        <input
          className={styles.savedViewRenameInput}
          value={renameText}
          onChange={(e) => onRenameChange(e.target.value)}
          onBlur={onFinishRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onFinishRename()
            if (e.key === 'Escape') onCancelRename()
          }}
          autoFocus
        />
      ) : (
        <button
          className={styles.savedViewName}
          onClick={() => onApply(view)}
          onDoubleClick={() => onStartRename(view.id, view.name)}
          title="Click to apply, double-click to rename, right-click for options"
        >
          {view.name}
        </button>
      )}
      <button
        className={styles.savedViewRemove}
        onClick={() => onRemove(view.id, view.name)}
        title="Remove saved view"
      >
        ×
      </button>
    </div>
  )
}

// --- Main component ---

export function ListView() {
  const { todos, loadAll, update: updateTodo } = useTodoStore()
  const { people, assignedPeopleMap, load: loadPeople, loadAssignments: loadPeopleAssignments, assignPerson, unassignPerson } = usePersonStore()
  const { tags, assignedTagsMap, load: loadTags, loadAssignments: loadTagAssignments, assignTag, unassignTag } = useTagStore()
  const { projects, loadAll: loadAllProjects } = useProjectStore()
  const { orgs, assignedOrgsMap, personOrgMap, load: loadOrgs, loadAssignments: loadOrgAssignments, loadPersonOrgMap } = useOrgStore()
  const { statuses, load: loadStatuses } = useStatusStore()
  const { listGroupBy, setListGroupBy, listSortBy, setListSortBy, openEditPopup, showBulkConfirmation, collapsedParents } = useUIStore()
  const editingListDefId = useUIStore((s) => s.editingListDefId)
  const editingListDefName = useUIStore((s) => s.editingListDefName)
  const clearEditingListDef = useUIStore((s) => s.clearEditingListDef)
  const updateListDefinition = useListDefinitionStore((s) => s.update)
  const allListDefinitions = useListDefinitionStore((s) => s.listDefinitions)
  const loadListDefinitions = useListDefinitionStore((s) => s.load)
  const { filters, setAllFilters } = useFilterStore()
  const isFilterActive = useFilterStore((s) => s.isActive)
  const taskEdit = useTaskEditCallbacks()
  const { views: savedViews, activeViewId, load: loadSavedViews, saveCurrentView, updateView, renameView, removeView, reorder: reorderViews, setActiveViewId } = useSavedViewStore()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [activeDragTodo, setActiveDragTodo] = useState<PersistedTodoItem | null>(null)
  const [overSectionKey, setOverSectionKey] = useState<string | null>(null)
  const [pendingReassign, setPendingReassign] = useState<PendingReassign | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [renamingViewId, setRenamingViewId] = useState<number | null>(null)
  const [renameText, setRenameText] = useState('')
  const [showSaveViewDialog, setShowSaveViewDialog] = useState(false)
  const [saveViewName, setSaveViewName] = useState('')
  const [showSavePresetDialog, setShowSavePresetDialog] = useState(false)
  const [savePresetName, setSavePresetName] = useState('')
  const [savePresetPin, setSavePresetPin] = useState(true)
  const [savePresetError, setSavePresetError] = useState('')
  const addListDefinition = useListDefinitionStore((s) => s.add)
  const isMobile = useIsMobile()

  // Per-view limit controls (persisted via saved views, not globally).
  const [maxTasks, setMaxTasks] = useState<number | null>(null)
  const [limitMode, setLimitMode] = useState<'hard' | 'scroll'>('hard')
  const [maxTasksInput, setMaxTasksInput] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  useEffect(() => {
    loadAll()
    loadPeople()
    loadTags()
    loadAllProjects()
    loadOrgs()
    loadStatuses()
    loadSavedViews()
    loadListDefinitions()
  }, [loadAll, loadPeople, loadTags, loadAllProjects, loadOrgs, loadStatuses, loadSavedViews, loadListDefinitions])

  useEffect(() => {
    const todoIds = todos.map((t) => t.id)
    if (todoIds.length > 0) {
      loadPeopleAssignments(todoIds)
      loadTagAssignments(todoIds)
      loadOrgAssignments(todoIds)
    }
  }, [todos, loadPeopleAssignments, loadTagAssignments, loadOrgAssignments])

  useEffect(() => {
    setCollapsed({})
  }, [listGroupBy])

  useEffect(() => {
    loadPersonOrgMap()
  }, [people, orgs, loadPersonOrgMap])

  const projectsById = useMemo(() => new Map(projects.map(p => [p.id!, p])), [projects])
  const activeTodos = useMemo(() => {
    return applyFilter(filters, todos, assignedPeopleMap, assignedTagsMap, personOrgMap, assignedOrgsMap, statuses, undefined, projectsById)
  }, [todos, filters, assignedPeopleMap, assignedTagsMap, personOrgMap, assignedOrgsMap, statuses, projectsById])

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
      case 'tag':
        return buildTagSections(activeTodos, tags, assignedTagsMap)
      case 'project':
        return buildProjectSections(activeTodos, projects)
      case 'org':
        return buildOrgSections(activeTodos, orgs, assignedPeopleMap, assignedOrgsMap, personOrgMap, filters.orgIds)
      case 'status':
        return buildStatusSections(activeTodos, statuses)
    }
  }, [listGroupBy, activeTodos, people, assignedPeopleMap, assignedOrgsMap, tags, assignedTagsMap, projects, orgs, personOrgMap, filters.orgIds, statuses])

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

  // --- Saved views ---

  const applyingViewRef = useRef(false)

  const handleApplyView = useCallback((view: {
    sortBy: string
    groupBy?: ListGroupBy
    itemSortBy?: ListItemSortBy
    filters: import('../models/saved-view').SavedViewFilters
    id: number
    maxTasks?: number
    limitMode?: 'hard' | 'scroll'
  }) => {
    applyingViewRef.current = true
    const { groupBy, itemSortBy } = resolveSavedViewGrouping(view)
    setListGroupBy(groupBy)
    setListSortBy(itemSortBy)
    const { seededAssignedStatusId, seededFollowupStatusId } = useSettingsStore.getState()
    const allStatuses = useStatusStore.getState().statuses
    const { runtime } = savedFiltersToRuntime(view.filters, seededAssignedStatusId, seededFollowupStatusId, allStatuses)
    setAllFilters({ ...useFilterStore.getState().filters, ...runtime })
    setActiveViewId(view.id)
    setMaxTasks(view.maxTasks ?? null)
    setMaxTasksInput(view.maxTasks != null ? String(view.maxTasks) : '')
    setLimitMode(view.limitMode ?? 'hard')
  }, [setListGroupBy, setListSortBy, setAllFilters, setActiveViewId])

  // Clear saved view highlight when filters or group/sort or limit change externally
  useEffect(() => {
    if (applyingViewRef.current) {
      applyingViewRef.current = false
      return
    }
    const { activeViewId: currentId, setActiveViewId: clearId } = useSavedViewStore.getState()
    if (currentId !== null) {
      clearId(null)
    }
  }, [filters, listGroupBy, listSortBy, maxTasks, limitMode])

  const handleSaveView = useCallback(() => {
    setSaveViewName('')
    setShowSaveViewDialog(true)
  }, [])

  const handleConfirmSaveView = useCallback(async () => {
    const name = saveViewName.trim()
    if (!name) return
    await saveCurrentView(name, listGroupBy, listSortBy, filters, {
      maxTasks: maxTasks ?? undefined,
      limitMode: maxTasks != null ? limitMode : undefined,
    })
    setShowSaveViewDialog(false)
    setSaveViewName('')
  }, [saveViewName, saveCurrentView, listGroupBy, listSortBy, filters, maxTasks, limitMode])

  const handleSavePreset = useCallback(() => {
    setSavePresetName('')
    setSavePresetPin(true)
    setSavePresetError('')
    setShowSavePresetDialog(true)
  }, [])

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

  const handleConfirmSavePreset = useCallback(async () => {
    const name = savePresetName.trim()
    if (!name) return
    try {
      const { sort, grouping } = encodeGroupSort(listGroupBy, listSortBy)
      const id = await addListDefinition({
        name,
        membership: { kind: 'custom', predicate: criteriaToPredicate(filters) },
        sort,
        grouping,
        pinnedToDashboard: savePresetPin,
      })
      if (savePresetPin) {
        const { dashboardUserLists, setDashboardUserLists } = useSettingsStore.getState()
        const cur = dashboardUserLists ?? []
        if (!cur.includes(id)) await setDashboardUserLists([...cur, id])
      }
      setShowSavePresetDialog(false)
      setSavePresetName('')
    } catch (e) {
      setSavePresetError((e as Error).message)
    }
  }, [savePresetName, savePresetPin, addListDefinition, filters, listGroupBy, listSortBy])

  const handleStartRename = useCallback((id: number, currentName: string) => {
    setRenamingViewId(id)
    setRenameText(currentName)
  }, [])

  const handleFinishRename = useCallback(async () => {
    if (renamingViewId === null) return
    const trimmed = renameText.trim()
    if (trimmed) await renameView(renamingViewId, trimmed)
    setRenamingViewId(null)
    setRenameText('')
  }, [renamingViewId, renameText, renameView])

  const handleUpdateView = useCallback(async (id: number) => {
    await updateView(id, listGroupBy, listSortBy, filters, {
      maxTasks: maxTasks ?? undefined,
      limitMode: maxTasks != null ? limitMode : undefined,
    })
  }, [updateView, listGroupBy, listSortBy, filters, maxTasks, limitMode])

  // --- Saved view reorder ---
  const [viewReorderKey, setViewReorderKey] = useState(0)
  const viewSortSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const savedViewIds = useMemo(() => savedViews.map(v => v.id), [savedViews])

  const handleViewDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const sorted = [...savedViews].sort((a, b) => a.sortOrder - b.sortOrder)
    const fromIndex = sorted.findIndex(v => v.id === active.id)
    const toIndex = sorted.findIndex(v => v.id === over.id)
    if (fromIndex !== -1 && toIndex !== -1) {
      reorderViews(fromIndex, toIndex)
      setViewReorderKey(k => k + 1)
    }
  }, [savedViews, reorderViews])

  // --- Saved view context menu ---
  const [viewContextMenu, setViewContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

  const handleViewContextMenu = useCallback((e: React.MouseEvent, view: { id: number; name: string }) => {
    e.preventDefault()
    e.stopPropagation()
    setViewContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Update to current settings', action: () => handleUpdateView(view.id) },
        { label: 'Rename', action: () => handleStartRename(view.id, view.name) },
        { separator: true, label: '', action: () => {} },
        { label: 'Delete', action: () => removeView(view.id), danger: true },
      ],
    })
  }, [handleUpdateView, handleStartRename, removeView])

  // --- DnD handlers ---

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const todo = event.active.data.current?.todo as PersistedTodoItem | undefined
    if (todo) setActiveDragTodo(todo)
  }, [])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overData = event.over?.data.current
    if (overData?.type === 'section') {
      setOverSectionKey(overData.sectionKey)
    } else {
      setOverSectionKey(null)
    }
  }, [])

  const performDrop = useCallback((todo: PersistedTodoItem, fromKey: string, toKey: string) => {
    const children = todos.filter(t => t.parentId === todo.id)
    const now = new Date()

    if (listGroupBy === 'project') {
      const newProjectId = parseSectionProjectId(toKey)
      if (newProjectId !== null && newProjectId !== todo.projectId) {
        updateTodo({ ...todo, projectId: newProjectId, modifiedAt: now })
        for (const child of children) {
          updateTodo({ ...child, projectId: newProjectId, modifiedAt: now })
        }
      }
    } else if (listGroupBy === 'people') {
      const fromLabel = sectionLabelMap.get(fromKey) ?? fromKey
      const toLabel = sectionLabelMap.get(toKey) ?? toKey
      setPendingReassign({ todo, fromKey, toKey, fromLabel, toLabel, attribute: 'person' })
    } else if (listGroupBy === 'tag') {
      const fromLabel = sectionLabelMap.get(fromKey) ?? fromKey
      const toLabel = sectionLabelMap.get(toKey) ?? toKey
      setPendingReassign({ todo, fromKey, toKey, fromLabel, toLabel, attribute: 'tag' })
    } else if (listGroupBy === 'status') {
      const newStatusId = toKey === 'no-status' ? undefined : toKey.startsWith('status-') ? Number(toKey.slice(7)) : null
      if (newStatusId !== null && newStatusId !== todo.statusId) {
        updateTodo({ ...todo, statusId: newStatusId, modifiedAt: now })
        for (const child of children) {
          updateTodo({ ...child, statusId: newStatusId, modifiedAt: now })
        }
      }
    }
    // Chronological / org / none groupings — no reassignment (ambiguous targets)
  }, [listGroupBy, todos, sectionLabelMap, updateTodo])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragTodo(null)
    setOverSectionKey(null)

    const todo = event.active.data.current?.todo as PersistedTodoItem | undefined
    const fromKey = event.active.data.current?.sectionKey as string | undefined
    const overData = event.over?.data.current
    const toKey = overData?.type === 'section' ? overData.sectionKey as string : null

    if (!todo || !fromKey || !toKey || fromKey === toKey) return

    performDrop(todo, fromKey, toKey)
  }, [performDrop])

  const confirmReassign = useCallback(async () => {
    if (!pendingReassign) return
    const { todo, fromKey, toKey, attribute } = pendingReassign
    const children = todos.filter(t => t.parentId === todo.id)
    const allIds = [todo.id, ...children.map(c => c.id)]

    if (attribute === 'person') {
      const fromPersonId = parseSectionPersonId(fromKey)
      const toPersonId = parseSectionPersonId(toKey)
      for (const id of allIds) {
        if (fromPersonId != null) await unassignPerson(id, fromPersonId)
        if (toPersonId != null) await assignPerson(id, toPersonId)
      }
    } else if (attribute === 'tag') {
      const fromTagId = parseSectionTagId(fromKey)
      const toTagId = parseSectionTagId(toKey)
      for (const id of allIds) {
        if (fromTagId != null) await unassignTag(id, fromTagId)
        if (toTagId != null) await assignTag(id, toTagId)
      }
    }

    setPendingReassign(null)
    // Reload to reflect changes
    await loadAll()
  }, [pendingReassign, todos, assignPerson, unassignPerson, assignTag, unassignTag, loadAll])

  const cancelReassign = useCallback(() => {
    setPendingReassign(null)
  }, [])

  const isDndEnabled =
    !isMobile &&
    (listGroupBy === 'project' || listGroupBy === 'people' || listGroupBy === 'tag' || listGroupBy === 'status')
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

          {savedViews.length > 0 && (
            <DndContext key={viewReorderKey} sensors={viewSortSensors} collisionDetection={closestCenter} onDragEnd={handleViewDragEnd}>
              <SortableContext items={savedViewIds} strategy={horizontalListSortingStrategy}>
                <div className={styles.savedViewsBar}>
                  {savedViews.map((view) => {
                    return (
                      <SortableViewChip
                        key={view.id}
                        view={view}
                        isActive={activeViewId === view.id}
                        isRenaming={renamingViewId === view.id}
                        renameText={renameText}
                        onRenameChange={setRenameText}
                        onFinishRename={handleFinishRename}
                        onCancelRename={() => { setRenamingViewId(null); setRenameText('') }}
                        onApply={handleApplyView}
                        onStartRename={handleStartRename}
                        onContextMenu={handleViewContextMenu}
                        onRemove={(id, name) => showBulkConfirmation('custom', [], {
                          title: `Delete saved view "${name}"?`,
                          message: 'This action cannot be undone.',
                          confirmLabel: 'Delete',
                          onConfirm: () => removeView(id),
                        })}
                      />
                    )
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}

          <div className={styles.toolbar}>
            <div className={styles.toolbarControls}>
              <div className={styles.toolbarField}>
                <span className={styles.toolbarLabel}>Group</span>
                <IconSelect<ListGroupBy>
                  value={listGroupBy}
                  options={groupByOptions}
                  onChange={(v) => { setListGroupBy(v); setActiveViewId(null) }}
                  ariaLabel="Group tasks by"
                />
              </div>
              <div className={styles.toolbarField}>
                <span className={styles.toolbarLabel}>Sort</span>
                <IconSelect<ListItemSortBy>
                  value={listSortBy}
                  options={itemSortByOptions}
                  onChange={(v) => { setListSortBy(v); setActiveViewId(null) }}
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
            </div>
            <div className={styles.toolbarActions}>
              <button
                className={styles.toolbarActionBtn}
                onClick={handleSaveView}
                title="Save current view"
              >
                Save View
              </button>
              <button
                className={styles.toolbarActionBtn}
                onClick={handleSavePreset}
                title="Save as a Dashboard / Canvas list"
              >
                Save to Dashboard
              </button>
              <button
                className={styles.toolbarActionBtn}
                onClick={() => setShowExport(true)}
                title="Export as plain text"
              >
                Export
              </button>
            </div>
          </div>

          {totalActive === 0 && (
            <div className={styles.empty}>
              {isFilterActive ? (
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
              const { todos: todosWithGhosts, ghostIds } = addGhostParents(section.todos, todos)
              const isCollapsed = !!collapsed[section.key]
              const isOver = overSectionKey === section.key
              const dropIdx = (isOver && activeDragTodo)
                ? computeDropIndex(section.todos, todos, activeDragTodo, collapsedParents)
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
                        todos={todosWithGhosts}
                        assignedPeopleMap={assignedPeopleMap}
                        assignedTagsMap={assignedTagsMap}
                        ghostIds={ghostIds}
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
            allTags={taskEdit.allTags}
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
            assignedTags={[]}
            allTags={taskEdit.allTags}
            onClose={taskEdit.closeEditPopup}
            onCreate={taskEdit.onCreate}
            assignedOrgs={[]}
            allOrgs={taskEdit.allOrgs}
            onAssignPerson={() => {}}
            onUnassignPerson={() => {}}
            onAssignTag={() => {}}
            onUnassignTag={() => {}}
            onAssignOrg={() => {}}
            onUnassignOrg={() => {}}
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
      {showSaveViewDialog && (
        <>
          <div className={styles.dialogBackdrop} onClick={() => setShowSaveViewDialog(false)} />
          <div className={styles.dialog}>
            <div className={styles.dialogTitle}>Save View</div>
            <input
              className={styles.dialogInput}
              value={saveViewName}
              onChange={(e) => setSaveViewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmSaveView()
                if (e.key === 'Escape') setShowSaveViewDialog(false)
              }}
              placeholder="View name"
              autoFocus
            />
            <div className={styles.dialogActions}>
              <button className={styles.dialogCancel} onClick={() => setShowSaveViewDialog(false)}>Cancel</button>
              <button className={styles.dialogConfirm} onClick={handleConfirmSaveView} disabled={!saveViewName.trim()}>Save</button>
            </div>
          </div>
        </>
      )}
      {showSavePresetDialog && (
        <>
          <div className={styles.dialogBackdrop} onClick={() => setShowSavePresetDialog(false)} />
          <div className={styles.dialog}>
            <div className={styles.dialogTitle}>Save to Dashboard</div>
            <div className={styles.dialogHint}>
              Captures current filters + grouping as a reusable list, available on the Dashboard and as a canvas inset.
            </div>
            <input
              className={styles.dialogInput}
              value={savePresetName}
              onChange={(e) => { setSavePresetName(e.target.value); setSavePresetError('') }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmSavePreset()
                if (e.key === 'Escape') setShowSavePresetDialog(false)
              }}
              placeholder="Preset name"
              autoFocus
            />
            <label className={styles.dialogToggle}>
              <input
                type="checkbox"
                checked={savePresetPin}
                onChange={(e) => setSavePresetPin(e.target.checked)}
              />
              Pin to Dashboard
            </label>
            {savePresetError && <div className={styles.dialogError}>{savePresetError}</div>}
            <div className={styles.dialogActions}>
              <button className={styles.dialogCancel} onClick={() => setShowSavePresetDialog(false)}>Cancel</button>
              <button className={styles.dialogConfirm} onClick={handleConfirmSavePreset} disabled={!savePresetName.trim()}>Save</button>
            </div>
          </div>
        </>
      )}
      {showExport && (
        <PlainTextExportPopup
          sections={sections}
          assignedPeopleMap={assignedPeopleMap}
          assignedTagsMap={assignedTagsMap}
          statusMap={statusMap}
          onClose={() => setShowExport(false)}
        />
      )}
      {viewContextMenu && createPortal(
        <CanvasContextMenu
          x={viewContextMenu.x}
          y={viewContextMenu.y}
          items={viewContextMenu.items}
          onClose={() => setViewContextMenu(null)}
        />,
        document.body,
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
