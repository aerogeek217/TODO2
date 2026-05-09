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
import { useProjectStore } from '../stores/project-store'
import { useOrgStore } from '../stores/org-store'
import { useTagStore } from '../stores/tag-store'
import { useStatusStore } from '../stores/status-store'
import { useUIStore } from '../stores/ui-store'
import { useFilterStore, applyFilter, criteriaToPredicate, predicateToCriteria } from '../stores/filter-store'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useSettingsStore } from '../stores/settings-store'
import { encodeGroupSort } from '../utils/list-view-encoding'
import { useTaskEditCallbacks } from '../hooks/use-task-edit-callbacks'
import { useEntityAssignmentsForTodos } from '../hooks/use-entity-assignments-for-todos'
import { TaskList } from '../components/task/TaskList'
import { TaskRow } from '../components/task/TaskRow'
import { TaskEditPopup } from '../components/task/TaskEditPopup'
import { SectionHeader } from '../components/shared/SectionHeader'
import { ReassignDialog } from '../components/overlays/ReassignDialog'
import { FilteredListPopup } from '../components/overlays/FilteredListPopup'
import { copyTasksRich, type CopyTaskSection } from '../services/task-copy'
import {
  buildFlatSection,
  buildDateSections,
  buildScheduledSections,
  buildDeadlineSections,
  buildPeopleSections,
  buildProjectSections,
  buildOrgSections,
  buildStatusSections,
  buildTagSections,
  itemSortComparator,
  truncateSections,
} from '../services/list-view-sections'
import { FavoriteChip, ListDefinitionSelector, NewListPrompt } from '../components/list-view/SavedListsControls'
import { DRAG_ACTIVATION_DISTANCE_PX } from '../constants'
import { createPortal } from 'react-dom'
import type { PersistedTodoItem, PersistedListDefinition, ListGroupBy, ListItemSortBy } from '../models'
import { LIST_GROUP_VALUES, LIST_SORT_VALUES } from '../models'
import type { RuntimeFilterField } from '../models/list-definition'
import { applyRuntimeFilter } from '../services/dashboard-lists'
import { RuntimeFilterPicker } from '../components/canvas/RuntimeFilterPicker'
import { TASK_DROP_KIND } from '../utils/task-dnd'
import { useIsMobile } from '../hooks/use-is-mobile'
import { SortGroupToolbar, type SortGroupOption } from '../components/shared/SortGroupToolbar'
import { groupByIcons, itemSortByIcons } from '../components/shared/list-option-icons'
import styles from './ListView.module.css'

const groupByOptions: readonly SortGroupOption<ListGroupBy>[] = [
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

const itemSortByOptions: readonly SortGroupOption<ListItemSortBy>[] = [
  { value: 'manual', label: 'None', icon: itemSortByIcons.manual },
  { value: 'name', label: 'Name', icon: itemSortByIcons.name },
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
  { value: 'tag', label: 'Tag' },
]

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

// --- Main component ---

export function ListView() {
  const { todos, ensureAllLoaded: loadAll, update: updateTodo } = useTodoStore()
  const { people, assignedPeopleMap, ensureLoaded: loadPeople, assignPerson, unassignPerson } = usePersonStore()
  const { projects, ensureAllLoaded: loadAllProjects } = useProjectStore()
  const { orgs, assignedOrgsMap, personOrgMap, ensureLoaded: loadOrgs, loadPersonOrgMap } = useOrgStore()
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const loadTags = useTagStore((s) => s.ensureLoaded)
  const { statuses, ensureLoaded: loadStatuses } = useStatusStore()
  const { listGroupBy, setListGroupBy, listSortBy, setListSortBy, openEditPopup, showBulkConfirmation } = useUIStore()
  const updateListDefinition = useListDefinitionStore((s) => s.update)
  const allListDefinitions = useListDefinitionStore((s) => s.listDefinitions)
  const loadListDefinitions = useListDefinitionStore((s) => s.ensureLoaded)
  const removeListDefinition = useListDefinitionStore((s) => s.remove)
  // Local rename: `filters` from `filter-store` is the **manual** criteria
  // (chips + search + date controls). `effectiveFilters` below applies the
  // runtime-prompt narrowing on top — every render-layer read should use
  // `effectiveFilters`. The two persistence-boundary writes (saving the
  // current state to a def) deliberately read the raw `manualFilters` so the
  // saved predicate captures only the manual pre-filter; the runtime pick is
  // captured separately as `def.runtimeFilter`.
  const { filters: manualFilters, setAllFilters } = useFilterStore()
  const isFilterActive = useFilterStore((s) => s.isActive)
  // Runtime-filter slot lives in `filter-store` so that the FilterChipBar's
  // Clear-all button drops the runtime input alongside the predicate (the
  // store's `clearAll` clears both). `spec` persists on the loaded def via
  // Save; `value` is transient — mirrors the canvas-widget pattern.
  const runtimeFilterSpec = useFilterStore((s) => s.runtimeFilterSpec)
  const runtimeFilterValue = useFilterStore((s) => s.runtimeFilterValue)
  const setRuntimeFilterSpec = useFilterStore((s) => s.setRuntimeFilterSpec)
  const setRuntimeFilterValue = useFilterStore((s) => s.setRuntimeFilterValue)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } })
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

  useEntityAssignmentsForTodos(todos)

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
    if (!runtimeFilterSpec || runtimeFilterValue == null || runtimeFilterValue.length === 0) return manualFilters
    const narrowed = applyRuntimeFilter(criteriaToPredicate(manualFilters), runtimeFilterSpec, runtimeFilterValue)
    return predicateToCriteria(narrowed)
  }, [manualFilters, runtimeFilterSpec, runtimeFilterValue])

  const activeTodos = useMemo(() => {
    if (runtimeFilterSpec && runtimeFilterValue == null) return []
    return applyFilter(effectiveFilters, todos, assignedPeopleMap, personOrgMap, assignedOrgsMap, statuses, undefined, projectsById, assignedTagsMap)
  }, [todos, effectiveFilters, assignedPeopleMap, personOrgMap, assignedOrgsMap, statuses, projectsById, assignedTagsMap, runtimeFilterSpec, runtimeFilterValue])

  // Filter-aware group ordering (P5 + P6, item 12 / item 1): when groupBy
  // matches an active filter dimension (people / org / tag), restrict the
  // visible group sections to that filter's ids and tier-order them
  // direct→implicit. Reads off `effectiveFilters` so the runtime-prompt
  // pick (which writes into `personIds` / `orgIds` / `tags` via
  // `applyRuntimeFilter`) restricts the visible groups too — without this,
  // a multi-assignee task that survives the membership filter would still
  // emit sections for its other assignees.
  const restrictToPersonIds = useMemo(
    () => (effectiveFilters.personIds ? Array.from(effectiveFilters.personIds) : null),
    [effectiveFilters.personIds],
  )
  const restrictToOrgIds = useMemo(
    () => (effectiveFilters.orgIds ? Array.from(effectiveFilters.orgIds) : null),
    [effectiveFilters.orgIds],
  )
  const restrictToTagIds = useMemo(
    () => (effectiveFilters.tags ? Array.from(effectiveFilters.tags) : null),
    [effectiveFilters.tags],
  )

  // P6 cross-axis implicit-keys lookups. People grouping pulls members of
  // the task's directly-assigned orgs (only when person-filter mode is the
  // include-orgs default — direct-only mode skips the implicit tier so
  // tasks that only matched via person-org membership simply drop out of
  // the grouping). Org grouping is symmetric. Read from `effectiveFilters`
  // so the runtime-prompt's hard-coded `direct-only` mode (P5) is honored.
  const personFilterMode = effectiveFilters.personFilterMode
  const orgFilterMode = effectiveFilters.orgFilterMode
  const implicitPersonIdsFor = useCallback(
    (todo: PersistedTodoItem): readonly number[] => {
      const taskOrgs = assignedOrgsMap.get(todo.id) ?? []
      if (taskOrgs.length === 0) return []
      const orgIdSet = new Set<number>()
      for (const o of taskOrgs) {
        if (o.id != null) orgIdSet.add(o.id)
      }
      const memberIds: number[] = []
      const seen = new Set<number>()
      for (const [pid, orgIds] of personOrgMap) {
        for (const oid of orgIds) {
          if (orgIdSet.has(oid)) {
            if (!seen.has(pid)) {
              seen.add(pid)
              memberIds.push(pid)
            }
            break
          }
        }
      }
      return memberIds
    },
    [assignedOrgsMap, personOrgMap],
  )
  const implicitOrgIdsFor = useCallback(
    (todo: PersistedTodoItem): readonly number[] => {
      const taskPeople = assignedPeopleMap.get(todo.id) ?? []
      if (taskPeople.length === 0) return []
      const orgIds: number[] = []
      const seen = new Set<number>()
      for (const p of taskPeople) {
        if (p.id == null) continue
        const pOrgs = personOrgMap.get(p.id) ?? []
        for (const oid of pOrgs) {
          if (!seen.has(oid)) {
            seen.add(oid)
            orgIds.push(oid)
          }
        }
      }
      return orgIds
    },
    [assignedPeopleMap, personOrgMap],
  )

  const sections = useMemo(() => {
    switch (listGroupBy) {
      case 'none':
        return buildFlatSection(activeTodos)
      case 'date':
        return buildDateSections(activeTodos, weekStartsOn)
      case 'scheduled':
        return buildScheduledSections(activeTodos, weekStartsOn)
      case 'deadline':
        return buildDeadlineSections(activeTodos, weekStartsOn)
      case 'people':
        return buildPeopleSections(
          activeTodos,
          people,
          assignedPeopleMap,
          orgs,
          personOrgMap,
          restrictToPersonIds,
          personFilterMode === 'include-orgs' ? implicitPersonIdsFor : undefined,
        )
      case 'project':
        return buildProjectSections(activeTodos, projects)
      case 'org':
        return buildOrgSections(
          activeTodos,
          orgs,
          assignedOrgsMap,
          personOrgMap,
          effectiveFilters.orgIds,
          restrictToOrgIds,
          orgFilterMode === 'include-people' ? implicitOrgIdsFor : undefined,
        )
      case 'status':
        return buildStatusSections(activeTodos, statuses)
      case 'tag':
        return buildTagSections(activeTodos, assignedTagsMap, restrictToTagIds)
    }
  }, [
    listGroupBy,
    activeTodos,
    people,
    assignedPeopleMap,
    assignedOrgsMap,
    projects,
    orgs,
    personOrgMap,
    effectiveFilters.orgIds,
    statuses,
    assignedTagsMap,
    weekStartsOn,
    restrictToPersonIds,
    restrictToOrgIds,
    restrictToTagIds,
    personFilterMode,
    orgFilterMode,
    implicitPersonIdsFor,
    implicitOrgIdsFor,
  ])

  const withinGroupComparator = useMemo(
    () => itemSortComparator(listSortBy, weekStartsOn),
    [listSortBy, weekStartsOn],
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
    // Post-flatten `def.grouping` is a flat `TodoGroupBy` literal that maps
    // 1:1 onto ListView's `ListGroupBy`. ListView doesn't render alphabetical
    // group buckets, so the non-grouping sort fields (`'name'`, `'manual'`,
    // `'created'`) coerce to 'none' if they appear (defensive — neither
    // valid grouping nor in the LIST_GROUP_VALUES subset, but a future widen
    // could surface them).
    setListGroupBy(LIST_GROUP_VALUES.includes(def.grouping as ListGroupBy) ? (def.grouping as ListGroupBy) : 'none')
    // ListView's within-group sort is a smaller subset (`LIST_SORT_VALUES`).
    // Anything outside that subset coerces to 'manual'.
    setListSortBy(LIST_SORT_VALUES.includes(def.sort as ListItemSortBy) ? (def.sort as ListItemSortBy) : 'manual')
    setMaxTasks(def.maxTasks ?? null)
    setMaxTasksInput(def.maxTasks != null ? String(def.maxTasks) : '')
    setLimitMode(def.limitMode ?? 'hard')
    setRuntimeFilterSpec(def.runtimeFilter ?? null)
    setRuntimeFilterValue(undefined)
    setActiveLoadedDefId(def.id)
  }, [setAllFilters, setListGroupBy, setListSortBy])

  const applyAndMarkLoaded = useCallback((def: PersistedListDefinition) => {
    applyDefinition(def)
  }, [applyDefinition])

  const writeCurrentStateToDef = useCallback(async (def: PersistedListDefinition) => {
    const { sort, grouping } = encodeGroupSort(listGroupBy, listSortBy)
    const next: PersistedListDefinition = {
      ...def,
      // Persistence boundary: raw manual filter — runtime pick is captured separately as `def.runtimeFilter`.
      membership: { kind: 'custom', predicate: criteriaToPredicate(manualFilters) },
      sort,
      grouping,
    }
    if (maxTasks != null) {
      next.maxTasks = maxTasks
      next.limitMode = limitMode
    } else {
      delete next.maxTasks
      delete next.limitMode
    }
    if (runtimeFilterSpec) next.runtimeFilter = runtimeFilterSpec
    else delete next.runtimeFilter
    await updateListDefinition(next)
    setActiveLoadedDefId(def.id)
  }, [listGroupBy, listSortBy, manualFilters, maxTasks, limitMode, runtimeFilterSpec, updateListDefinition])

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
        // Persistence boundary: raw manual filter — runtime pick is captured separately as `def.runtimeFilter`.
        membership: { kind: 'custom', predicate: criteriaToPredicate(manualFilters) },
        sort,
        grouping,
        pinnedToDashboard: false,
        favorited: true,
        ...(maxTasks != null ? { maxTasks, limitMode } : {}),
        ...(runtimeFilterSpec ? { runtimeFilter: runtimeFilterSpec } : {}),
      })
      setActiveLoadedDefId(id)
      setShowNewListPrompt(false)
      setNewListName('')
    } catch (e) {
      setNewListError((e as Error).message)
    }
  }, [newListName, addListDefinition, manualFilters, listGroupBy, listSortBy, maxTasks, limitMode, runtimeFilterSpec])

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
              <SortGroupToolbar<ListItemSortBy, ListGroupBy>
                density="comfortable"
                sortBy={listSortBy}
                groupBy={listGroupBy}
                sortOptions={itemSortByOptions}
                groupOptions={groupByOptions}
                onSortChange={(v) => { setListSortBy(v); setActiveLoadedDefId(null) }}
                onGroupChange={(v) => { setListGroupBy(v); setActiveLoadedDefId(null) }}
              />
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
                    if (raw.trim() === '') { setMaxTasks(null); setActiveLoadedDefId(null); return }
                    const n = Number(raw)
                    if (Number.isFinite(n) && n >= 1) { setMaxTasks(Math.floor(n)); setActiveLoadedDefId(null) }
                  }}
                />
              </div>
              {maxTasks != null && (
                <div className={styles.limitModeGroup} role="group" aria-label="Limit mode">
                  <button
                    type="button"
                    className={`${styles.limitModeBtn} ${limitMode === 'hard' ? styles.limitModeBtnActive : ''}`}
                    onClick={() => { setLimitMode('hard'); setActiveLoadedDefId(null) }}
                    title="Hide tasks beyond the limit"
                  >Hard</button>
                  <button
                    type="button"
                    className={`${styles.limitModeBtn} ${limitMode === 'scroll' ? styles.limitModeBtnActive : ''}`}
                    onClick={() => { setLimitMode('scroll'); setActiveLoadedDefId(null) }}
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
                  aria-label="Prompt field"
                  onChange={(e) => {
                    const next = e.target.value as RuntimeFilterField | 'none'
                    if (next === 'none') {
                      setRuntimeFilterSpec(null)
                    } else {
                      setRuntimeFilterSpec({ field: next })
                    }
                    setRuntimeFilterValue(undefined)
                    setActiveLoadedDefId(null)
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
                  void copyTasksRich(copySections, { assignedPeopleMap, statusMap, weekStartsOn })
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
                onClick={() => { setLimitMode('scroll'); setActiveLoadedDefId(null) }}
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
            allTags={taskEdit.allTags}
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
        <NewListPrompt
          value={newListName}
          error={newListError}
          onChange={(next) => { setNewListName(next); setNewListError('') }}
          onConfirm={handleConfirmNewList}
          onCancel={() => setShowNewListPrompt(false)}
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
