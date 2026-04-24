import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
} from '@dnd-kit/core'
import { RAILS_DRAG_TYPE, isRailsDropId, type FloatDescriptor, type FloatDockTarget } from '../utils/rail-dnd'
import { useCanvasRailsStore } from '../stores/canvas-rails-store'
import { describeFloatDockTarget, computeEmptySideCornerClaim } from '../utils/float-dock-announce'
import type { FloatDragKind } from '../stores/ui-store'
import { buildTaskCollision } from '../utils/task-dnd'
import { useCanvasStore } from '../stores/canvas-store'
import { useProjectStore } from '../stores/project-store'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useOrgStore } from '../stores/org-store'
import { useTagStore } from '../stores/tag-store'
import { useUIStore } from '../stores/ui-store'
import { useStatusStore } from '../stores/status-store'
import { useFilterStore, computeFilterPersonOrgIds, matchesFilter } from '../stores/filter-store'
import { useFileStorageStore } from '../stores/file-storage-store'
import { useListInsetStore } from '../stores/list-inset-store'
import { useFloatingNoteStore } from '../stores/floating-note-store'
import { useFloatingCalendarStore } from '../stores/floating-calendar-store'
import { useFloatingTaskboardStore } from '../stores/floating-taskboard-store'
import { useFloatingHorizonsStore } from '../stores/floating-horizons-store'
import { useTaskboardStore } from '../stores/taskboard-store'
import { useCanvasDnD } from '../hooks/use-canvas-dnd'
import { useTaskEditCallbacks } from '../hooks/use-task-edit-callbacks'
import { CanvasView } from '../components/canvas/CanvasView'
import { ProjectNavigator } from '../components/canvas/ProjectNavigator'
import { RailsFrame } from '../components/canvas/rails/RailsFrame'
import { TaskRow } from '../components/task/TaskRow'
import { TaskEditPopup } from '../components/task/TaskEditPopup'
import { ListDefinitionPickerPopup } from '../components/overlays/ListDefinitionPickerPopup'
import { DashboardListsEditor } from '../components/settings/DashboardListsEditor'
import { WidgetKindMenu } from '../components/shared/WidgetKindMenu'
import type { SlotKind } from '../models/canvas-rails'
import { useListDefinitionStore } from '../stores/list-definition-store'
import type { PersistedTodoItem, Project, Status } from '../models'
import type { ReactFlowInstance } from '@xyflow/react'
import { DragInsertContext, DragPreviewContext } from '../components/canvas/DragInsertContext'
import { shouldNormalize, normalizeSortOrders } from '../services/task-placement'
import { bySortOrder } from '../utils/sort-order'
import { FilteredListPopup } from '../components/overlays/FilteredListPopup'
import { parseTaskInput, applyNlpMetadata } from '../services/nlp-task-creator'
import { getFilterDefaults, supplementWithFilterDefaults } from '../utils/filter-defaults'
import overlayStyles from '../components/canvas/DragOverlayTask.module.css'

export function CanvasPage() {
  const { selectedCanvasId } = useCanvasStore()
  const { projects, loadByCanvas: loadProjects, add: addProject, updatePosition, bulkUpdatePositions, update: updateProject, remove: removeProject } = useProjectStore()
  const { todos, loadByCanvas: loadTodos, add: addTodo, addAt: addTodoAt, update: updateTodo, applyMutations } = useTodoStore()
  const { people, assignedPeopleMap, load: loadPeople, loadAssignments, assignPerson } = usePersonStore()
  const { orgs, assignedOrgsMap, personOrgMap, load: loadOrgs, loadAssignments: loadOrgAssignments, loadPersonOrgMap, assignOrg } = useOrgStore()
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const loadTags = useTagStore((s) => s.load)
  const loadTagAssignments = useTagStore((s) => s.loadAssignments)
  const { openEditPopup, showBulkConfirmation } = useUIStore()
  const { statuses } = useStatusStore()
  const taskEdit = useTaskEditCallbacks()
  const { filters } = useFilterStore()
  const { insets, loadByCanvas: loadInsets, add: addInset, update: updateInset, updatePosition: updateInsetPosition, remove: removeInset } = useListInsetStore()
  const loadDefinitions = useListDefinitionStore((s) => s.load)
  const addListDefinition = useListDefinitionStore((s) => s.add)
  const [addListPickerPos, setAddListPickerPos] = useState<{ x: number; y: number; flowX: number; flowY: number } | null>(null)
  const [addWidgetMenuPos, setAddWidgetMenuPos] = useState<{ x: number; y: number; flowX: number; flowY: number } | null>(null)
  const [showListEditor, setShowListEditor] = useState(false)
  const [listEditorInitialId, setListEditorInitialId] = useState<number | null>(null)
  const floatingNotes = useFloatingNoteStore((s) => s.notes)
  const loadFloatingNotes = useFloatingNoteStore((s) => s.loadByCanvas)
  const updateFloatingNotePosition = useFloatingNoteStore((s) => s.updatePosition)
  const updateFloatingNoteSize = useFloatingNoteStore((s) => s.updateSize)
  const removeFloatingNote = useFloatingNoteStore((s) => s.remove)
  const floatingCalendars = useFloatingCalendarStore((s) => s.calendars)
  const loadFloatingCalendars = useFloatingCalendarStore((s) => s.loadByCanvas)
  const updateFloatingCalendarPosition = useFloatingCalendarStore((s) => s.updatePosition)
  const updateFloatingCalendarSize = useFloatingCalendarStore((s) => s.updateSize)
  const removeFloatingCalendar = useFloatingCalendarStore((s) => s.remove)

  const floatingTaskboards = useFloatingTaskboardStore((s) => s.taskboards)
  const loadFloatingTaskboards = useFloatingTaskboardStore((s) => s.loadByCanvas)
  const updateFloatingTaskboardPosition = useFloatingTaskboardStore((s) => s.updatePosition)
  const updateFloatingTaskboardSize = useFloatingTaskboardStore((s) => s.updateSize)
  const setFloatingTaskboardCollapsed = useFloatingTaskboardStore((s) => s.setCollapsed)
  const removeFloatingTaskboard = useFloatingTaskboardStore((s) => s.remove)

  const floatingHorizons = useFloatingHorizonsStore((s) => s.horizons)
  const loadFloatingHorizons = useFloatingHorizonsStore((s) => s.loadByCanvas)
  const updateFloatingHorizonsPosition = useFloatingHorizonsStore((s) => s.updatePosition)
  const updateFloatingHorizonsSize = useFloatingHorizonsStore((s) => s.updateSize)
  const removeFloatingHorizons = useFloatingHorizonsStore((s) => s.remove)

  const taskboard = useTaskboardStore((s) => s.board)
  const loadTaskboard = useTaskboardStore((s) => s.load)
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null)
  const isProjectNavigatorOpen = useUIStore((s) => s.isProjectNavigatorOpen)

  useEffect(() => {
    loadPeople()
    loadOrgs()
    loadTags()
    loadTaskboard()
    loadDefinitions()
  }, [loadPeople, loadOrgs, loadTags, loadTaskboard, loadDefinitions])

  useEffect(() => {
    loadPersonOrgMap()
  }, [people, orgs, loadPersonOrgMap])

  useEffect(() => {
    if (selectedCanvasId) {
      loadProjects(selectedCanvasId)
      loadTodos(selectedCanvasId)
      loadInsets(selectedCanvasId)
      loadFloatingNotes(selectedCanvasId)
      loadFloatingCalendars(selectedCanvasId)
      loadFloatingTaskboards(selectedCanvasId)
      loadFloatingHorizons(selectedCanvasId)
    }
  }, [selectedCanvasId, loadProjects, loadTodos, loadInsets, loadFloatingNotes, loadFloatingCalendars, loadFloatingTaskboards, loadFloatingHorizons])

  // Reset normalization guard when file-storage completes an operation (e.g. import)
  const normalizedRef = useRef(false)
  const fsLoading = useFileStorageStore((s) => s.isLoading)
  useEffect(() => {
    normalizedRef.current = false
  }, [fsLoading])

  // Normalize sortOrders on canvas load if any project has drifted values
  useEffect(() => {
    if (todos.length === 0 || normalizedRef.current) return
    normalizedRef.current = true
    const byProject = new Map<number, PersistedTodoItem[]>()
    for (const t of todos) {
      if (t.projectId == null) continue
      const list = byProject.get(t.projectId) ?? []
      list.push(t)
      byProject.set(t.projectId, list)
    }
    for (const [, projectTodos] of byProject) {
      if (shouldNormalize(projectTodos)) {
        const mutations = normalizeSortOrders(projectTodos)
        if (mutations.length > 0) applyMutations(mutations)
      }
    }
  }, [todos, applyMutations])

  // Load people / org / tag assignments when todos change
  useEffect(() => {
    const todoIds = todos.map((t) => t.id)
    if (todoIds.length > 0) {
      loadAssignments(todoIds)
      loadOrgAssignments(todoIds)
      loadTagAssignments(todoIds)
    }
  }, [todos, loadAssignments, loadOrgAssignments, loadTagAssignments])

  // Consume pending canvas navigation target from command palette
  const pendingTarget = useUIStore((s) => s.pendingCanvasTarget)
  useEffect(() => {
    if (!pendingTarget) return
    const rf = rfInstanceRef.current
    if (!rf) return
    // Center the viewport on the target position
    const el = document.querySelector('.react-flow')
    const w = el?.clientWidth ?? window.innerWidth
    const h = el?.clientHeight ?? window.innerHeight
    const zoom = 1
    rf.setViewport({ x: -pendingTarget.x * zoom + w / 2, y: -pendingTarget.y * zoom + h / 2, zoom })
    useUIStore.getState().setPendingCanvasTarget(null)
  }, [pendingTarget])

  // Canvas only hides tasks for "only" filter variants; other values ghost instead.
  //
  // Per-project array stabilization: when only one project's todos change (the
  // common case — editing a single task), unaffected projects keep the same
  // array reference. This lets downstream useMemo + React.memo short-circuit
  // for nodes whose data truly didn't change (see CanvasView dataNodes cache).
  const prevTodosByProjectRef = useRef<Map<number, PersistedTodoItem[]>>(new Map())
  const todosByProject = useMemo(() => {
    const prev = prevTodosByProjectRef.current
    const visibleByProject = new Map<number, PersistedTodoItem[]>()
    for (const todo of todos) {
      if (todo.projectId == null) continue
      if (!filters.showCompleted && todo.isCompleted) continue
      if (!filters.showHiddenStatuses) {
        const s = statuses.find(x => x.id === todo.statusId)
        if (s?.hideByDefault) continue
      }
      const visList = visibleByProject.get(todo.projectId) ?? []
      visList.push(todo)
      visibleByProject.set(todo.projectId, visList)
    }

    const stable = new Map<number, PersistedTodoItem[]>()
    for (const [pid, vis] of visibleByProject) {
      vis.sort(bySortOrder)
      const prevList = prev.get(pid)
      if (
        prevList &&
        prevList.length === vis.length &&
        prevList.every((t, i) => t === vis[i])
      ) {
        stable.set(pid, prevList)
      } else {
        stable.set(pid, vis)
      }
    }
    prevTodosByProjectRef.current = stable
    return stable
  }, [todos, filters.showCompleted, filters.showHiddenStatuses, statuses])

  // --- DnD (extracted to useCanvasDnD hook) ---
  const dnd = useCanvasDnD({
    todos,
    todosByProject,
    projects,
    selectedCanvasId,
    addProject,
    applyMutations,
    rfInstanceRef,
  })

  // Ghost-filter: compute IDs of visible todos that don't match non-hiding filters (dimmed on canvas)
  // "only" variants hide tasks entirely (handled in todosByProject); regular variants ghost here
  const filterGhostIds = useMemo(() => {
    const hasGhostFilter =
      filters.personIds !== null || filters.orgIds !== null ||
      filters.projectIds !== null ||
      filters.statusIds !== null || filters.searchText !== '' ||
      filters.dateRangeStart !== null || filters.dateRangeEnd !== null ||
      filters.tags !== null
    if (!hasGhostFilter) return undefined
    const filterPersonOrgIds = computeFilterPersonOrgIds(filters.personIds, filters.personFilterMode, personOrgMap)
    // Hoist O(n) lookups out of the per-todo loop. At 10k todos × P projects ×
    // S statuses these would otherwise contribute quadratic-ish work on every
    // filter change; one-pass maps turn each access into O(1).
    const projectsById = new Map<number, Project>()
    for (const p of projects) if (p.id != null) projectsById.set(p.id, p)
    const statusesById = new Map<number, Status>()
    for (const s of statuses) if (s.id != null) statusesById.set(s.id, s)
    const ghost = new Set<number>()
    for (const todo of todos) {
      if (todo.projectId == null) continue
      // Skip tasks already hidden by todosByProject
      if (!filters.showCompleted && todo.isCompleted) continue
      if (!filters.showHiddenStatuses) {
        const s = todo.statusId != null ? statusesById.get(todo.statusId) : undefined
        if (s?.hideByDefault) continue
      }
      const people = assignedPeopleMap.get(todo.id) ?? []
      const orgs = assignedOrgsMap.get(todo.id) ?? []
      const personIds = people.map((p) => p.id!)
      const pOrgIds = people.flatMap((p) => personOrgMap.get(p.id!) ?? [])
      const dOrgIds = orgs.map((o) => o.id!)
      const tagIds = (assignedTagsMap.get(todo.id) ?? []).map((t) => t.id!)
      const searchCtx = filters.searchText
        ? {
            projectName: todo.projectId != null ? projectsById.get(todo.projectId)?.name : undefined,
            personNames: people.map(p => p.name),
            orgNames: orgs.map(o => o.name),
            statusName: todo.statusId != null ? statusesById.get(todo.statusId)?.name : undefined,
          }
        : undefined
      if (!matchesFilter(filters, todo, personIds, pOrgIds, dOrgIds, filterPersonOrgIds, statuses, undefined, searchCtx, tagIds)) {
        ghost.add(todo.id)
      }
    }
    return ghost.size > 0 ? ghost : undefined
  }, [todos, filters, assignedPeopleMap, assignedOrgsMap, personOrgMap, assignedTagsMap, statuses, projects])

  const ghostTodoIds = filterGhostIds

  const handleNodeDragStop = useCallback(
    (projectId: number, x: number, y: number) => {
      updatePosition(projectId, x, y)
    },
    [updatePosition]
  )

  const handleCascadeShift = useCallback(
    (shifts: Array<{ projectId: number; x: number; y: number }>) => {
      bulkUpdatePositions(shifts.map(s => ({ id: s.projectId, x: s.x, y: s.y })))
    },
    [bulkUpdatePositions]
  )

  const handleAddTask = useCallback(
    async (projectId: number, rawTitle: string) => {
      if (!selectedCanvasId) return
      // Read projects at call time to avoid re-creating this callback on position-only changes
      const currentProjects = useProjectStore.getState().projects
      const { title, resolved } = parseTaskInput(rawTitle, people, currentProjects, orgs)
      const fd = getFilterDefaults(useFilterStore.getState().filters)
      supplementWithFilterDefaults(resolved, fd)
      const pid = resolved.projectId ?? projectId
      const id = await addTodo(title || rawTitle, selectedCanvasId, pid)
      await applyNlpMetadata(
        id, resolved,
        (tid) => useTodoStore.getState().todos.find((t) => t.id === tid) as PersistedTodoItem | undefined,
        updateTodo, assignPerson, assignOrg,
      )
    },
    [selectedCanvasId, addTodo, updateTodo, assignPerson, assignOrg, people, orgs]
  )

  const handleInsertTask = useCallback(
    async (rawTitle: string, projectId: number, beforeTodoId: number | null): Promise<number> => {
      if (!selectedCanvasId) return -1
      // Read projects at call time to avoid re-creating this callback on position-only changes
      const currentProjects = useProjectStore.getState().projects
      const { title, resolved } = parseTaskInput(rawTitle, people, currentProjects, orgs)
      const fd = getFilterDefaults(useFilterStore.getState().filters)
      supplementWithFilterDefaults(resolved, fd)
      const pid = resolved.projectId ?? projectId
      const projectTodos = todosByProject.get(pid) ?? []
      const siblings = [...projectTodos].sort(bySortOrder)
      const { computeInsertionSort } = await import('../services/task-placement')
      const sortOrder = computeInsertionSort(siblings, beforeTodoId)
      const id = await addTodoAt(title || rawTitle, pid, selectedCanvasId, sortOrder)
      await applyNlpMetadata(
        id, resolved,
        (tid) => useTodoStore.getState().todos.find((t) => t.id === tid) as PersistedTodoItem | undefined,
        updateTodo, assignPerson, assignOrg,
      )
      return id
    },
    [selectedCanvasId, todosByProject, addTodoAt, updateTodo, assignPerson, assignOrg, people, orgs]
  )

  const handleDeleteProject = useCallback(
    (projectId: number) => {
      const project = projects.find(p => p.id === projectId)
      const taskCount = todos.filter(t => t.projectId === projectId).length
      const name = project?.name ?? 'this project'
      const message = taskCount > 0
        ? `Remove "${name}"? Its ${taskCount} task${taskCount !== 1 ? 's' : ''} will be moved to a new "Orphaned Tasks" project.`
        : `Remove "${name}"?`
      showBulkConfirmation('custom', [projectId], {
        title: 'Remove project',
        message,
        confirmLabel: 'Remove',
        onConfirm: () => removeProject(projectId),
      })
    },
    [projects, todos, removeProject, showBulkConfirmation]
  )

  const handleRenameProject = useCallback(
    async (projectId: number, name: string) => {
      const project = projects.find((p) => p.id === projectId)
      if (!project) return
      await updateProject({ ...project, name })
    },
    [projects, updateProject]
  )

  const handleToggleCollapse = useCallback(
    async (projectId: number) => {
      const project = projects.find((p) => p.id === projectId)
      if (!project) return
      await updateProject({ ...project, isCollapsed: !project.isCollapsed })
    },
    [projects, updateProject]
  )

  const handleResizeProject = useCallback(
    async (projectId: number, width: number) => {
      const project = projects.find(p => p.id === projectId)
      if (!project) return
      await updateProject({ ...project, width })
    },
    [projects, updateProject]
  )

  const handleSetProjectColor = useCallback(
    async (projectId: number, color: string | undefined) => {
      const project = projects.find(p => p.id === projectId)
      if (!project) return
      await updateProject({ ...project, color })
    },
    [projects, updateProject]
  )

  const handleToggleCollapseInset = useCallback(
    async (id: number) => {
      const inset = insets.find(i => i.id === id)
      if (!inset) return
      await updateInset({ ...inset, isCollapsed: !inset.isCollapsed })
    },
    [insets, updateInset]
  )

  const handleResizeInset = useCallback(
    async (id: number, width: number, height: number) => {
      const inset = insets.find(i => i.id === id)
      if (!inset) return
      await updateInset({ ...inset, width, height })
    },
    [insets, updateInset]
  )

  const handleRequestAddWidget = useCallback(
    (screenX: number, screenY: number, flowX: number, flowY: number) => {
      setAddWidgetMenuPos({ x: screenX, y: screenY, flowX, flowY })
    },
    [],
  )

  const handlePickWidgetKind = useCallback(
    async (kind: SlotKind) => {
      if (!selectedCanvasId || !addWidgetMenuPos) return
      const { x, y, flowX, flowY } = addWidgetMenuPos
      if (kind === 'lens') {
        // Defer to the list-definition picker to finish placement.
        setAddWidgetMenuPos(null)
        setAddListPickerPos({ x, y, flowX, flowY })
        return
      }
      setAddWidgetMenuPos(null)
      if (kind === 'notes') {
        await useFloatingNoteStore.getState().add(selectedCanvasId, flowX, flowY)
      } else if (kind === 'calendar') {
        await useFloatingCalendarStore.getState().add(selectedCanvasId, flowX, flowY)
      } else if (kind === 'taskboard') {
        await useTaskboardStore.getState().ensureLoaded()
        await useFloatingTaskboardStore.getState().add(selectedCanvasId, flowX, flowY)
      } else if (kind === 'horizons') {
        await useFloatingHorizonsStore.getState().add(selectedCanvasId, flowX, flowY)
      }
    },
    [selectedCanvasId, addWidgetMenuPos],
  )

  const handlePickListDef = useCallback(
    async (listDefinitionId: number) => {
      if (!selectedCanvasId || !addListPickerPos) return
      await addInset(listDefinitionId, selectedCanvasId, addListPickerPos.flowX, addListPickerPos.flowY)
    },
    [selectedCanvasId, addInset, addListPickerPos],
  )

  // One-click "Create new list" from the canvas list picker: create a blank
  // list definition, drop it on the canvas at the captured flow position, and
  // open the list editor targeting the new def so the user can configure it.
  const handleCreateNewListOnCanvas = useCallback(async () => {
    if (!selectedCanvasId || !addListPickerPos) return
    const defs = useListDefinitionStore.getState().listDefinitions
    let candidate = 'New list'
    let n = 2
    const lower = new Set(defs.map((d) => d.name.toLowerCase()))
    while (lower.has(candidate.toLowerCase())) candidate = `New list ${n++}`
    const id = await addListDefinition({ name: candidate })
    await addInset(id, selectedCanvasId, addListPickerPos.flowX, addListPickerPos.flowY)
    setAddListPickerPos(null)
    setListEditorInitialId(id)
    setShowListEditor(true)
  }, [selectedCanvasId, addListPickerPos, addListDefinition, addInset])

  const handleClickTask = useCallback(
    (todoId: number) => openEditPopup(todoId),
    [openEditPopup]
  )

  const handleReactFlowInit = useCallback((instance: ReactFlowInstance) => {
    rfInstanceRef.current = instance
  }, [])

  // Listen for fit-view events from App (Ctrl+0 / command palette)
  useEffect(() => {
    const handler = () => {
      rfInstanceRef.current?.fitView({ padding: 0.15, duration: 300 })
    }
    window.addEventListener('canvas-fit-view', handler)
    return () => window.removeEventListener('canvas-fit-view', handler)
  }, [])

  const handleAddProject = useCallback(async (x: number, y: number) => {
    if (selectedCanvasId) await addProject('New Project', selectedCanvasId, x, y)
  }, [selectedCanvasId, addProject])

  const handleResizeFloatingNote = useCallback(
    async (id: number, width: number, height: number) => {
      await updateFloatingNoteSize(id, width, height)
    },
    [updateFloatingNoteSize],
  )

  const projectHandlers = useMemo(() => ({
    onAddTask: handleAddTask,
    onInsertTask: handleInsertTask,
    onDeleteProject: handleDeleteProject,
    onRenameProject: handleRenameProject,
    onToggleCollapse: handleToggleCollapse,
    onResizeProject: handleResizeProject,
    onSetProjectColor: handleSetProjectColor,
    onAddProject: handleAddProject,
  }), [handleAddTask, handleInsertTask, handleDeleteProject, handleRenameProject, handleToggleCollapse, handleResizeProject, handleSetProjectColor, handleAddProject])

  const insetHandlers = useMemo(() => ({
    onDeleteInset: removeInset,
    onToggleCollapseInset: handleToggleCollapseInset,
    onInsetDragStop: updateInsetPosition,
    onRequestAddWidget: handleRequestAddWidget,
    onResizeInset: handleResizeInset,
  }), [removeInset, handleToggleCollapseInset, updateInsetPosition, handleRequestAddWidget, handleResizeInset])

  const noteHandlers = useMemo(() => ({
    onDeleteNote: removeFloatingNote,
    onNoteDragStop: updateFloatingNotePosition,
    onResizeNote: handleResizeFloatingNote,
  }), [removeFloatingNote, updateFloatingNotePosition, handleResizeFloatingNote])

  const handleResizeFloatingCalendar = useCallback(
    async (id: number, width: number, height: number) => {
      await updateFloatingCalendarSize(id, width, height)
    },
    [updateFloatingCalendarSize],
  )

  const floatingCalendarHandlers = useMemo(() => ({
    onDeleteCalendar: removeFloatingCalendar,
    onCalendarDragStop: updateFloatingCalendarPosition,
    onResizeCalendar: handleResizeFloatingCalendar,
  }), [removeFloatingCalendar, updateFloatingCalendarPosition, handleResizeFloatingCalendar])

  const handleTaskboardDragStop = useCallback((id: number, x: number, y: number) => {
    updateFloatingTaskboardPosition(id, x, y)
  }, [updateFloatingTaskboardPosition])

  const handleToggleTaskboardCollapse = useCallback((id: number) => {
    const current = useFloatingTaskboardStore.getState().taskboards.find((n) => n.id === id)
    if (!current) return
    setFloatingTaskboardCollapsed(id, !current.collapsed)
  }, [setFloatingTaskboardCollapsed])

  const handleCloseTaskboard = useCallback((id: number) => {
    removeFloatingTaskboard(id)
  }, [removeFloatingTaskboard])
  // showBulkConfirmation kept available for future clear-entries affordance.
  void showBulkConfirmation

  const handleResizeTaskboard = useCallback((id: number, w: number, h: number) => {
    updateFloatingTaskboardSize(id, w, h)
  }, [updateFloatingTaskboardSize])

  const handleHorizonsDragStop = useCallback((id: number, x: number, y: number) => {
    updateFloatingHorizonsPosition(id, x, y)
  }, [updateFloatingHorizonsPosition])

  const handleCloseHorizons = useCallback((id: number) => {
    removeFloatingHorizons(id)
  }, [removeFloatingHorizons])

  const handleResizeHorizons = useCallback((id: number, w: number, h: number) => {
    updateFloatingHorizonsSize(id, w, h)
  }, [updateFloatingHorizonsSize])

  /**
   * Float-dock handler — called by `CanvasView` on release of a floating
   * widget over a rail drop zone. Builds the `FloatDescriptor` from the
   * appropriate floating-store row (threading calendar `orientation` /
   * `weekOffset` and lens `listDefinitionId`), dispatches one of the two
   * `canvas-rails-store` dock reducers, applies any empty-side corner claim,
   * and emits a screen-reader announcement mirroring `useRailsDragMonitor`'s
   * pattern. Store reducers delete the source float row on success, so
   * `CanvasView`'s usual position-persist path does not run for this release.
   */
  const handleFloatDock = useCallback(async (
    desc: { kind: FloatDragKind; floatId: number },
    target: FloatDockTarget,
  ) => {
    let descriptor: FloatDescriptor | null = null
    switch (desc.kind) {
      case 'note':
        descriptor = { kind: 'note', id: desc.floatId }
        break
      case 'calendar': {
        const cal = useFloatingCalendarStore.getState().calendars.find((c) => c.id === desc.floatId)
        if (!cal) return
        descriptor = {
          kind: 'calendar',
          id: desc.floatId,
          orientation: cal.orientation,
          weekOffset: cal.weekOffset,
        }
        break
      }
      case 'inset': {
        const inset = useListInsetStore.getState().insets.find((i) => i.id === desc.floatId)
        if (!inset) return
        descriptor = { kind: 'lens', id: desc.floatId, listDefinitionId: inset.listDefinitionId }
        break
      }
      case 'taskboard': {
        await useTaskboardStore.getState().ensureLoaded()
        const board = useTaskboardStore.getState().board
        if (!board?.id) {
          console.warn('handleFloatDock: taskboard still unavailable after ensureLoaded')
          return
        }
        descriptor = { kind: 'taskboard', id: desc.floatId, taskboardId: board.id }
        break
      }
      case 'horizons':
        descriptor = { kind: 'horizons', id: desc.floatId }
        break
    }
    if (!descriptor) return

    const railsStore = useCanvasRailsStore.getState()
    if (target.kind === 'tab-strip') {
      railsStore.dockFloatIntoSlot(descriptor, target.slotId, 'center', target.insertIdx)
    } else if (target.kind === 'slot') {
      railsStore.dockFloatIntoSlot(descriptor, target.slotId, target.zone)
    } else {
      railsStore.dockFloatAsNewSlot(descriptor, { kind: 'empty-side', side: target.side })
      if (target.claim) {
        for (const { corner, owner } of computeEmptySideCornerClaim(target.side, target.claim)) {
          if (owner == null) railsStore.clearCornerOwner(corner)
          else railsStore.setCornerOwner(corner, owner)
        }
      }
    }

    useUIStore.getState().setFloatAnnouncement(
      describeFloatDockTarget(target, useCanvasRailsStore.getState().rails),
    )
  }, [])

  const dragInsertValue = useMemo(
    () => ({
      activeDragTodoId: dnd.activeDragTodo?.id ?? null,
      dragExpandedProjectId: dnd.dragExpandedProjectId,
      dragSelectionIds: dnd.dragSelectionIds,
    }),
    [dnd.activeDragTodo?.id, dnd.dragExpandedProjectId, dnd.dragSelectionIds],
  )
  const dragPreviewValue = useMemo(
    () => ({
      insertTodoId: dnd.insertTodoId,
      insertAtEnd: dnd.insertAtEnd,
      insertProjectId: dnd.insertProjectId,
    }),
    [dnd.insertTodoId, dnd.insertAtEnd, dnd.insertProjectId],
  )

  // F12: rails drags and task drags share the canvas `DndContext` but route to
  // disjoint droppable sets. Rails drags match against `rails:*` zones;
  // everything else (task / taskboard-task) matches non-rails zones.
  const collisionDetection = useMemo(() => buildTaskCollision([
    {
      when: (active) => active.data.current?.type === RAILS_DRAG_TYPE,
      accept: (id) => isRailsDropId(String(id)),
      algorithm: 'pointerWithin',
    },
    {
      when: () => true,
      accept: (id) => !isRailsDropId(String(id)),
      algorithm: 'pointerWithin',
    },
  ]), [])

  return (
    <DndContext
      sensors={dnd.sensors}
      measuring={dnd.measuring}
      collisionDetection={collisionDetection}
      onDragStart={dnd.handleDragStart}
      onDragMove={dnd.handleDragMove}
      onDragOver={dnd.handleDragOver}
      onDragEnd={dnd.handleDragEnd}
      onDragCancel={dnd.handleDragCancel}
    >
      <DragInsertContext.Provider value={dragInsertValue}>
      <DragPreviewContext.Provider value={dragPreviewValue}>
      <RailsFrame>
        <CanvasView
          projects={projects}
          todosByProject={todosByProject}
          assignedPeopleMap={assignedPeopleMap}
          assignedOrgsMap={assignedOrgsMap}
          personOrgMap={personOrgMap}
          ghostTodoIds={ghostTodoIds}
          onNodeDragStop={handleNodeDragStop}
          onReactFlowInit={handleReactFlowInit}
          onOpenDetail={handleClickTask}
          projectHandlers={projectHandlers}
          listInsets={insets}
          allTodos={todos}
          insetHandlers={insetHandlers}
          floatingNotes={floatingNotes}
          noteHandlers={noteHandlers}
          floatingCalendars={floatingCalendars}
          floatingCalendarHandlers={floatingCalendarHandlers}
          allPeople={people}
          allOrgs={orgs}
          floatingTaskboards={floatingTaskboards}
          taskboard={taskboard}
          onToggleTaskboardCollapse={handleToggleTaskboardCollapse}
          onCloseTaskboard={handleCloseTaskboard}
          onTaskboardDragStop={handleTaskboardDragStop}
          onResizeTaskboard={handleResizeTaskboard}
          floatingHorizons={floatingHorizons}
          onHorizonsDragStop={handleHorizonsDragStop}
          onCloseHorizons={handleCloseHorizons}
          onResizeHorizons={handleResizeHorizons}
          onCascadeShift={handleCascadeShift}
          showCompleted={filters.showCompleted}
          showHiddenStatuses={filters.showHiddenStatuses}
          onFloatDock={handleFloatDock}
        />
        {isProjectNavigatorOpen && (
          <ProjectNavigator
            projects={projects}
            todosByProject={todosByProject}
            rfInstance={rfInstanceRef.current}
          />
        )}
      </RailsFrame>
      </DragPreviewContext.Provider>
      </DragInsertContext.Provider>

      <DragOverlay dropAnimation={null}>
        {dnd.activeDragTodo && (
          <div className={overlayStyles.overlay} data-drag-overlay>
            <TaskRow
              todo={dnd.activeDragTodo}
              ghost
            />
            {dnd.multiDragCount > 1 && (
              <div className={overlayStyles.badge}>{dnd.multiDragCount}</div>
            )}
          </div>
        )}
      </DragOverlay>

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

      <FilteredListPopup />

      {addWidgetMenuPos && (
        <WidgetKindMenu
          anchor={{ x: addWidgetMenuPos.x, y: addWidgetMenuPos.y }}
          heading="Add widget"
          onChangeKind={handlePickWidgetKind}
          onClose={() => setAddWidgetMenuPos(null)}
        />
      )}
      {addListPickerPos && (
        <ListDefinitionPickerPopup
          x={addListPickerPos.x}
          y={addListPickerPos.y}
          onSelect={handlePickListDef}
          onCreateNew={() => { void handleCreateNewListOnCanvas() }}
          onClose={() => setAddListPickerPos(null)}
        />
      )}
      {showListEditor && (
        <DashboardListsEditor
          onClose={() => { setShowListEditor(false); setListEditorInitialId(null) }}
          initialSelectedId={listEditorInitialId ?? undefined}
        />
      )}
    </DndContext>
  )
}
