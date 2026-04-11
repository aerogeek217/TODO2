import { useEffect, useMemo, useState, useCallback } from 'react'
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
import { useTagStore } from '../stores/tag-store'
import { useProjectStore } from '../stores/project-store'
import { useOrgStore } from '../stores/org-store'
import { useUIStore } from '../stores/ui-store'
import { useFilterStore } from '../stores/filter-store'
import { useSavedViewStore, savedFiltersToRuntime } from '../stores/saved-view-store'
import { useTaskEditCallbacks } from '../hooks/use-task-edit-callbacks'
import { TaskList } from '../components/task/TaskList'
import { TaskRow } from '../components/task/TaskRow'
import { TaskEditPopup } from '../components/task/TaskEditPopup'
import { SectionHeader } from '../components/shared/SectionHeader'
import { ReassignDialog } from '../components/overlays/ReassignDialog'
import { FilteredListPopup } from '../components/overlays/FilteredListPopup'
import { PlainTextExportPopup } from '../components/overlays/PlainTextExportPopup'
import { Priority } from '../models'
import type { PersistedTodoItem, Person, Tag, Project, Org, ListSortBy } from '../models'
import { startOfToday, MS_PER_DAY } from '../utils/date'
import { useIsMobile } from '../hooks/use-is-mobile'
import styles from './ListView.module.css'

interface Section {
  key: string
  label: string
  accentColor?: string
  todos: PersistedTodoItem[]
}

const sortByOptions: { value: ListSortBy; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'due', label: 'Due Date' },
  { value: 'people', label: 'People' },
  { value: 'org', label: 'Org' },
  { value: 'tag', label: 'Tag' },
  { value: 'project', label: 'Project' },
]


export function buildPrioritySections(todos: PersistedTodoItem[]): Section[] {
  const sections: Section[] = []
  const high = todos.filter((t) => t.priority === Priority.High)
  const medium = todos.filter((t) => t.priority === Priority.Medium)
  const normal = todos.filter((t) => t.priority === Priority.Normal)

  if (high.length > 0) sections.push({ key: 'high', label: 'High', accentColor: 'var(--color-priority-high)', todos: high })
  if (medium.length > 0) sections.push({ key: 'medium', label: 'Medium', accentColor: 'var(--color-priority-medium)', todos: medium })
  if (normal.length > 0) sections.push({ key: 'normal', label: 'Normal', todos: normal })
  return sections
}

export function buildDueSections(todos: PersistedTodoItem[]): Section[] {
  const today = startOfToday()
  const tomorrow = new Date(today.getTime() + MS_PER_DAY)
  const weekEnd = new Date(today.getTime() + 7 * MS_PER_DAY)

  const overdue: PersistedTodoItem[] = []
  const dueToday: PersistedTodoItem[] = []
  const thisWeek: PersistedTodoItem[] = []
  const later: PersistedTodoItem[] = []
  const noDue: PersistedTodoItem[] = []

  for (const t of todos) {
    if (!t.dueDate) {
      noDue.push(t)
    } else {
      const d = new Date(t.dueDate)
      if (d < today) overdue.push(t)
      else if (d < tomorrow) dueToday.push(t)
      else if (d < weekEnd) thisWeek.push(t)
      else later.push(t)
    }
  }

  const sections: Section[] = []
  if (overdue.length > 0) sections.push({ key: 'overdue', label: 'Overdue', accentColor: 'var(--color-priority-high)', todos: overdue })
  if (dueToday.length > 0) sections.push({ key: 'today', label: 'Today', accentColor: 'var(--color-priority-medium)', todos: dueToday })
  if (thisWeek.length > 0) sections.push({ key: 'week', label: 'This Week', accentColor: 'var(--color-accent)', todos: thisWeek })
  if (later.length > 0) sections.push({ key: 'later', label: 'Later', todos: later })
  if (noDue.length > 0) sections.push({ key: 'none', label: 'No Due Date', todos: noDue })
  return sections
}

export function buildPeopleSections(
  todos: PersistedTodoItem[],
  people: Person[],
  assignedPeopleMap: Map<number, Person[]>,
  orgs?: Org[],
  assignedOrgsMap?: Map<number, Org[]>,
): Section[] {
  const sections: Section[] = []
  const assignedTodoIds = new Set<number>()

  for (const person of people) {
    const personTodos = todos.filter((t) => {
      const assigned = assignedPeopleMap.get(t.id) ?? []
      return assigned.some((p) => p.id === person.id)
    })
    if (personTodos.length > 0) {
      for (const t of personTodos) assignedTodoIds.add(t.id)
      sections.push({
        key: `person-${person.id}`,
        label: person.name,
        accentColor: person.color,
        todos: personTodos,
      })
    }
  }

  const unassigned = todos.filter((t) => !assignedTodoIds.has(t.id))
  if (unassigned.length > 0 && orgs && assignedOrgsMap) {
    // Sub-group unassigned-to-person tasks by their direct org assignment
    const orgGroupedIds = new Set<number>()
    for (const org of orgs) {
      const orgTodos = unassigned.filter((t) => {
        const todoOrgs = assignedOrgsMap.get(t.id) ?? []
        return todoOrgs.some((o) => o.id === org.id)
      })
      if (orgTodos.length > 0) {
        for (const t of orgTodos) orgGroupedIds.add(t.id)
        sections.push({
          key: `org-${org.id}`,
          label: org.name,
          accentColor: org.color,
          todos: orgTodos,
        })
      }
    }
    const remaining = unassigned.filter((t) => !orgGroupedIds.has(t.id))
    if (remaining.length > 0) {
      sections.push({ key: 'unassigned', label: 'Unassigned', todos: remaining })
    }
  } else if (unassigned.length > 0) {
    sections.push({ key: 'unassigned', label: 'Unassigned', todos: unassigned })
  }
  return sections
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

function parseSectionPriority(key: string): Priority | null {
  if (key === 'high') return Priority.High
  if (key === 'medium') return Priority.Medium
  if (key === 'normal') return Priority.Normal
  return null
}

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

// --- Main component ---

export function ListView() {
  const { todos, loadAll, update: updateTodo } = useTodoStore()
  const { people, assignedPeopleMap, load: loadPeople, loadAssignments: loadPeopleAssignments, assignPerson, unassignPerson } = usePersonStore()
  const { tags, assignedTagsMap, load: loadTags, loadAssignments: loadTagAssignments, assignTag, unassignTag } = useTagStore()
  const { projects, loadAll: loadAllProjects } = useProjectStore()
  const { orgs, assignedOrgsMap, personOrgMap, load: loadOrgs, loadAssignments: loadOrgAssignments, loadPersonOrgMap } = useOrgStore()
  const { listSortBy, setListSortBy, openEditPopup } = useUIStore()
  const { filters, applyFilter, setAllFilters } = useFilterStore()
  const taskEdit = useTaskEditCallbacks()
  const { views: savedViews, activeViewId, load: loadSavedViews, saveCurrentView, renameView, removeView, setActiveViewId } = useSavedViewStore()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [activeDragTodo, setActiveDragTodo] = useState<PersistedTodoItem | null>(null)
  const [overSectionKey, setOverSectionKey] = useState<string | null>(null)
  const [pendingReassign, setPendingReassign] = useState<PendingReassign | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [renamingViewId, setRenamingViewId] = useState<number | null>(null)
  const [renameText, setRenameText] = useState('')
  const [showSaveViewDialog, setShowSaveViewDialog] = useState(false)
  const [saveViewName, setSaveViewName] = useState('')
  const isMobile = useIsMobile()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  useEffect(() => {
    loadAll()
    loadPeople()
    loadTags()
    loadAllProjects()
    loadOrgs()
    loadSavedViews()
  }, [loadAll, loadPeople, loadTags, loadAllProjects, loadOrgs, loadSavedViews])

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
  }, [listSortBy])

  useEffect(() => {
    loadPersonOrgMap()
  }, [people, orgs, loadPersonOrgMap])

  const activeTodos = useMemo(() => {
    const filtered = applyFilter(todos, assignedPeopleMap, assignedTagsMap, personOrgMap, assignedOrgsMap)
    // When grouped by People, include assigned tasks that pass all other filters
    if (listSortBy === 'people' && !filters.showAssigned) {
      const filteredIds = new Set(filtered.map(t => t.id))
      const { matchesFilter } = useFilterStore.getState()
      const assignedExtras = todos.filter(t => {
        if (!t.isAssigned || filteredIds.has(t.id) || t.isCompleted) return false
        // Check all filters except showAssigned
        const personIds = (assignedPeopleMap.get(t.id) ?? []).map(p => p.id!)
        const tagIds = (assignedTagsMap.get(t.id) ?? []).map(tg => tg.id!)
        const personOrgIds = personIds.flatMap(pid => personOrgMap.get(pid) ?? [])
        const directOrgIds = (assignedOrgsMap.get(t.id) ?? []).map(o => o.id!)
        // Temporarily treat as non-assigned for filter check
        const proxy = { ...t, isAssigned: false }
        return matchesFilter(proxy, personIds, tagIds, personOrgIds, directOrgIds)
      })
      if (assignedExtras.length > 0) return [...filtered, ...assignedExtras]
    }
    return filtered
  }, [todos, filters, assignedPeopleMap, assignedTagsMap, personOrgMap, assignedOrgsMap, applyFilter, listSortBy])

  const sections = useMemo(() => {
    switch (listSortBy) {
      case 'priority':
        return buildPrioritySections(activeTodos)
      case 'due':
        return buildDueSections(activeTodos)
      case 'people':
        return buildPeopleSections(activeTodos, people, assignedPeopleMap, orgs, assignedOrgsMap)
      case 'tag':
        return buildTagSections(activeTodos, tags, assignedTagsMap)
      case 'project':
        return buildProjectSections(activeTodos, projects)
      case 'org':
        return buildOrgSections(activeTodos, orgs, assignedPeopleMap, assignedOrgsMap, personOrgMap, filters.orgIds)
    }
  }, [listSortBy, activeTodos, people, assignedPeopleMap, assignedOrgsMap, tags, assignedTagsMap, projects, orgs, personOrgMap, filters.orgIds])

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

  const handleApplyView = useCallback((view: { sortBy: ListSortBy; filters: import('../models/saved-view').SavedViewFilters; id: number }) => {
    setListSortBy(view.sortBy)
    const runtime = savedFiltersToRuntime(view.filters)
    setAllFilters({ ...useFilterStore.getState().filters, ...runtime })
    setActiveViewId(view.id)
  }, [setListSortBy, setAllFilters, setActiveViewId])

  const handleSaveView = useCallback(() => {
    setSaveViewName('')
    setShowSaveViewDialog(true)
  }, [])

  const handleConfirmSaveView = useCallback(async () => {
    const name = saveViewName.trim()
    if (!name) return
    await saveCurrentView(name, listSortBy, filters)
    setShowSaveViewDialog(false)
    setSaveViewName('')
  }, [saveViewName, saveCurrentView, listSortBy, filters])

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
    if (listSortBy === 'priority') {
      const newPriority = parseSectionPriority(toKey)
      if (newPriority != null) {
        updateTodo({ ...todo, priority: newPriority, modifiedAt: new Date() })
      }
    } else if (listSortBy === 'project') {
      const newProjectId = parseSectionProjectId(toKey)
      if (newProjectId !== null && newProjectId !== todo.projectId) {
        updateTodo({ ...todo, projectId: newProjectId, modifiedAt: new Date() })
        // Disassociate children left behind in original project
        const orphans = todos.filter(t => t.parentId === todo.id && t.projectId === todo.projectId)
        for (const child of orphans) {
          updateTodo({ ...child, parentId: undefined, modifiedAt: new Date() })
        }
      }
    } else if (listSortBy === 'people') {
      const fromLabel = sectionLabelMap.get(fromKey) ?? fromKey
      const toLabel = sectionLabelMap.get(toKey) ?? toKey
      setPendingReassign({ todo, fromKey, toKey, fromLabel, toLabel, attribute: 'person' })
    } else if (listSortBy === 'tag') {
      const fromLabel = sectionLabelMap.get(fromKey) ?? fromKey
      const toLabel = sectionLabelMap.get(toKey) ?? toKey
      setPendingReassign({ todo, fromKey, toKey, fromLabel, toLabel, attribute: 'tag' })
    }
    // 'due' — no reassignment (ambiguous target dates)
  }, [listSortBy, sectionLabelMap, updateTodo])

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

    if (attribute === 'person') {
      const fromPersonId = parseSectionPersonId(fromKey)
      const toPersonId = parseSectionPersonId(toKey)
      if (fromPersonId != null) await unassignPerson(todo.id, fromPersonId)
      if (toPersonId != null) await assignPerson(todo.id, toPersonId)
    } else if (attribute === 'tag') {
      const fromTagId = parseSectionTagId(fromKey)
      const toTagId = parseSectionTagId(toKey)
      if (fromTagId != null) await unassignTag(todo.id, fromTagId)
      if (toTagId != null) await assignTag(todo.id, toTagId)
    }

    setPendingReassign(null)
    // Reload to reflect changes
    await loadAll()
  }, [pendingReassign, assignPerson, unassignPerson, assignTag, unassignTag, loadAll])

  const cancelReassign = useCallback(() => {
    setPendingReassign(null)
  }, [])

  const isDndEnabled = !isMobile && listSortBy !== 'due'
  const totalActive = activeTodos.length

  const pageContent = (
    <>
      <div className={styles.page} onClick={() => useUIStore.getState().clearSelection()}>
        <div className={`${styles.container} ${styles.medium}`}>
          <div className={styles.pageHeader}>
            <div className={styles.pageTitle}>List</div>
            <div className={styles.pageSubtitle}>{totalActive} active tasks</div>
          </div>

          {savedViews.length > 0 && (
            <div className={styles.savedViewsBar}>
              {savedViews.map((view) => (
                <div key={view.id} className={`${styles.savedViewChip} ${activeViewId === view.id ? styles.savedViewChipActive : ''}`}>
                  {renamingViewId === view.id ? (
                    <input
                      className={styles.savedViewRenameInput}
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onBlur={handleFinishRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleFinishRename()
                        if (e.key === 'Escape') { setRenamingViewId(null); setRenameText('') }
                      }}
                      autoFocus
                    />
                  ) : (
                    <button
                      className={styles.savedViewName}
                      onClick={() => handleApplyView(view)}
                      onDoubleClick={() => handleStartRename(view.id, view.name)}
                      title="Click to apply, double-click to rename"
                    >
                      {view.name}
                    </button>
                  )}
                  <button
                    className={styles.savedViewRemove}
                    onClick={() => removeView(view.id)}
                    title="Remove saved view"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={styles.sortBar}>
            <span className={styles.sortLabel}>Group by</span>
            {sortByOptions.map(({ value, label }) => (
              <button
                key={value}
                className={`${styles.sortButton} ${listSortBy === value ? styles.sortButtonActive : ''}`}
                onClick={() => { setListSortBy(value); setActiveViewId(null) }}
              >
                {label}
              </button>
            ))}
            <button
              className={styles.saveViewButton}
              onClick={handleSaveView}
              title="Save current view"
            >
              Save View
            </button>
            <button
              className={styles.exportButton}
              onClick={() => setShowExport(true)}
              title="Export as plain text"
            >
              Export
            </button>
          </div>

          {totalActive === 0 && (
            <div className={styles.empty}>
              {filters.priorities !== null || filters.starredOnly || filters.hardDeadlineOnly || filters.personIds !== null || filters.tagIds !== null || filters.orgIds !== null || filters.searchText || filters.dateRangeStart !== null || filters.dateRangeEnd !== null ? (
                <>
                  No tasks match your current filters.
                  <button className={styles.clearFiltersButton} onClick={() => useFilterStore.getState().clearAll()}>Clear filters</button>
                </>
              ) : (
                'No active tasks.'
              )}
            </div>
          )}

          {sections.map((section) => {
            const { todos: todosWithGhosts, ghostIds } = addGhostParents(section.todos, todos)
            const isCollapsed = !!collapsed[section.key]
            const isOver = overSectionKey === section.key
            return (
              <DroppableSection key={section.key} sectionKey={section.key} isOver={isOver}>
                <SectionHeader
                  label={section.label}
                  count={section.todos.length}
                  accentColor={section.accentColor}
                  collapsed={isCollapsed}
                  onToggle={() => toggleSection(section.key)}
                />
                {!isCollapsed && (
                  <div className={styles.taskList}>
                    <TaskList
                      todos={todosWithGhosts}
                      assignedPeopleMap={assignedPeopleMap}
                      assignedTagsMap={assignedTagsMap}
                      ghostIds={ghostIds}
                      draggable={isDndEnabled}
                      sectionKey={section.key}
                      dropIndicator={isOver && !!activeDragTodo}
                      onOpenDetail={handleClick}
                    />
                  </div>
                )}
              </DroppableSection>
            )
          })}
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
      {showExport && (
        <PlainTextExportPopup
          sections={sections}
          assignedPeopleMap={assignedPeopleMap}
          assignedTagsMap={assignedTagsMap}
          onClose={() => setShowExport(false)}
        />
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
      <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
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
