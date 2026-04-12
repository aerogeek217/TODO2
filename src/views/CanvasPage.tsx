import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  pointerWithin,
} from '@dnd-kit/core'
import { useCanvasStore } from '../stores/canvas-store'
import { useProjectStore } from '../stores/project-store'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'
import { useOrgStore } from '../stores/org-store'
import { useUIStore } from '../stores/ui-store'
import { useFilterStore } from '../stores/filter-store'
import { useFileStorageStore } from '../stores/file-storage-store'
import { useListInsetStore } from '../stores/list-inset-store'
import { useStickyNoteStore } from '../stores/sticky-note-store'
import { useTaskboardStore } from '../stores/taskboard-store'
import { useCanvasDnD } from '../hooks/use-canvas-dnd'
import { useTaskEditCallbacks } from '../hooks/use-task-edit-callbacks'
import { CanvasView } from '../components/canvas/CanvasView'
import { ProjectNavigator } from '../components/canvas/ProjectNavigator'
import { TaskRow } from '../components/task/TaskRow'
import { TaskEditPopup } from '../components/task/TaskEditPopup'
import type { PersistedTodoItem } from '../models'
import type { ReactFlowInstance } from '@xyflow/react'
import { DragInsertContext } from '../components/canvas/DragInsertContext'
import { shouldNormalize, normalizeSortOrders } from '../services/task-placement'
import { FilteredListPopup } from '../components/overlays/FilteredListPopup'
import { parseTaskInput, applyNlpMetadata } from '../services/nlp-task-creator'
import overlayStyles from '../components/canvas/DragOverlayTask.module.css'

export function CanvasPage() {
  const { selectedCanvasId } = useCanvasStore()
  const { projects, loadByCanvas: loadProjects, add: addProject, updatePosition, bulkUpdatePositions, update: updateProject, remove: removeProject } = useProjectStore()
  const { todos, loadByCanvas: loadTodos, add: addTodo, addAt: addTodoAt, update: updateTodo, applyMutations } = useTodoStore()
  const { people, assignedPeopleMap, load: loadPeople, loadAssignments, assignPerson } = usePersonStore()
  const { tags, assignedTagsMap, load: loadTags, loadAssignments: loadTagAssignments, assignTag } = useTagStore()
  const { orgs, assignedOrgsMap, personOrgMap, load: loadOrgs, loadAssignments: loadOrgAssignments, loadPersonOrgMap, assignOrg } = useOrgStore()
  const { openEditPopup, showBulkConfirmation } = useUIStore()
  const taskEdit = useTaskEditCallbacks()
  const { filters, isActive: isFilterActive } = useFilterStore()
  const { insets, loadByCanvas: loadInsets, add: addInset, update: updateInset, updatePosition: updateInsetPosition, remove: removeInset } = useListInsetStore()
  const { notes: stickyNotes, loadByCanvas: loadNotes, add: addNote, update: updateNote, updatePosition: updateNotePosition, updateText: updateNoteText, updateTitle: updateNoteTitle, updateColor: updateNoteColor, remove: removeNote } = useStickyNoteStore()



  const { entries: taskboardEntries, load: loadTaskboard } = useTaskboardStore()
  const [taskboardPosition, setTaskboardPosition] = useState<{ x: number; y: number }>(() => {
    const saved = localStorage.getItem('taskboardPosition')
    return saved ? JSON.parse(saved) : { x: -400, y: 0 }
  })
  const [isTaskboardCollapsed, setIsTaskboardCollapsed] = useState(() => localStorage.getItem('taskboardCollapsed') === 'true')
  const [taskboardSize, setTaskboardSize] = useState<{ w: number; h: number }>(() => {
    const saved = localStorage.getItem('taskboardSize')
    return saved ? JSON.parse(saved) : { w: 320, h: 400 }
  })
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null)
  const isProjectNavigatorOpen = useUIStore((s) => s.isProjectNavigatorOpen)

  useEffect(() => {
    loadPeople()
    loadTags()
    loadOrgs()
    loadTaskboard()
  }, [loadPeople, loadTags, loadOrgs, loadTaskboard])

  useEffect(() => {
    loadPersonOrgMap()
  }, [people, orgs, loadPersonOrgMap])

  useEffect(() => {
    if (selectedCanvasId) {
      loadProjects(selectedCanvasId)
      loadTodos(selectedCanvasId)
      loadInsets(selectedCanvasId)
      loadNotes(selectedCanvasId)
    }
  }, [selectedCanvasId, loadProjects, loadTodos, loadInsets, loadNotes])

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

  // Load people and tag assignments when todos change
  useEffect(() => {
    const todoIds = todos.map((t) => t.id)
    if (todoIds.length > 0) {
      loadAssignments(todoIds)
      loadTagAssignments(todoIds)
      loadOrgAssignments(todoIds)
    }
  }, [todos, loadAssignments, loadTagAssignments, loadOrgAssignments])

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

  const { todosByProject, assignedGhostIds } = useMemo(() => {
    const map = new Map<number, PersistedTodoItem[]>()
    const assignedParentIds = new Set<number>()
    const todoById = new Map<number, PersistedTodoItem>()
    for (const todo of todos) {
      if (todo.projectId != null) {
        todoById.set(todo.id, todo)
        // Hide completed tasks when showCompleted is off
        if (!filters.showCompleted && todo.isCompleted) continue
        // Hide assigned tasks when showAssigned is off
        if (!filters.showAssigned && todo.isAssigned) continue
        const list = map.get(todo.projectId) ?? []
        list.push(todo)
        map.set(todo.projectId, list)
      }
    }
    // Add back assigned parents whose non-assigned children are visible
    if (!filters.showAssigned) {
      for (const [, list] of map) {
        for (const todo of list) {
          if (todo.parentId != null && !map.get(todo.projectId!)?.some(t => t.id === todo.parentId)) {
            const parent = todoById.get(todo.parentId)
            if (parent?.isAssigned && !assignedParentIds.has(parent.id)) {
              assignedParentIds.add(parent.id)
              list.push(parent)
            }
          }
        }
      }
    }
    // Sort each project's tasks by sortOrder
    for (const [, list] of map) {
      list.sort((a, b) => a.sortOrder - b.sortOrder)
    }
    return { todosByProject: map, assignedGhostIds: assignedParentIds }
  }, [todos, filters.showCompleted, filters.showAssigned])

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

  // Ghost-filter: compute IDs of todos that don't match non-completion filters (dimmed on canvas)
  const { matchesFilter } = useFilterStore()
  const filterGhostIds = useMemo(() => {
    if (!isFilterActive) return undefined
    // Check if any filter besides showCompleted/showAssigned is active
    const hasNonVisibilityFilter = filters.priorities !== null || filters.starredOnly || filters.hardDeadlineOnly || filters.personIds !== null || filters.tagIds !== null || filters.orgIds !== null || filters.searchText !== '' || filters.dateRangeStart !== null || filters.dateRangeEnd !== null
    if (!hasNonVisibilityFilter) return undefined
    const ghost = new Set<number>()
    for (const todo of todos) {
      if (!filters.showCompleted && todo.isCompleted) continue // already hidden
      if (!filters.showAssigned && todo.isAssigned) continue // already hidden
      const personIds = (assignedPeopleMap.get(todo.id) ?? []).map((p) => p.id!)
      const tagIds = (assignedTagsMap.get(todo.id) ?? []).map((t) => t.id!)
      const pOrgIds = (assignedPeopleMap.get(todo.id) ?? []).flatMap((p) => personOrgMap.get(p.id!) ?? [])
      const dOrgIds = (assignedOrgsMap.get(todo.id) ?? []).map((o) => o.id!)
      if (!matchesFilter(todo, personIds, tagIds, pOrgIds, dOrgIds, true)) {
        ghost.add(todo.id)
      }
    }
    return ghost.size > 0 ? ghost : undefined
  }, [todos, isFilterActive, filters, assignedPeopleMap, assignedTagsMap, assignedOrgsMap, personOrgMap, matchesFilter])

  // Merge filter ghosts, assigned-parent ghosts, and drag-child ghosts
  const ghostTodoIds = useMemo(() => {
    const dragChildIds = dnd.activeDragChildren.map(c => c.id)
    if (!filterGhostIds && assignedGhostIds.size === 0 && dragChildIds.length === 0) return undefined
    const merged = new Set(filterGhostIds)
    for (const id of assignedGhostIds) merged.add(id)
    for (const id of dragChildIds) merged.add(id)
    return merged.size > 0 ? merged : undefined
  }, [filterGhostIds, assignedGhostIds, dnd.activeDragChildren])

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
      const { title, resolved } = parseTaskInput(rawTitle, people, tags, currentProjects, orgs)
      const pid = resolved.projectId ?? projectId
      const id = await addTodo(title || rawTitle, selectedCanvasId, pid)
      await applyNlpMetadata(
        id, resolved,
        (tid) => useTodoStore.getState().todos.find((t) => t.id === tid) as PersistedTodoItem | undefined,
        updateTodo, assignPerson, assignTag, assignOrg,
      )
    },
    [selectedCanvasId, addTodo, updateTodo, assignPerson, assignTag, assignOrg, people, tags, orgs]
  )

  const handleInsertTask = useCallback(
    async (rawTitle: string, projectId: number, beforeTodoId: number | null, parentId: number | undefined): Promise<number> => {
      if (!selectedCanvasId) return -1
      // Read projects at call time to avoid re-creating this callback on position-only changes
      const currentProjects = useProjectStore.getState().projects
      const { title, resolved } = parseTaskInput(rawTitle, people, tags, currentProjects, orgs)
      const pid = resolved.projectId ?? projectId
      const projectTodos = todosByProject.get(pid) ?? []
      const siblings = projectTodos.filter(t =>
        parentId ? t.parentId === parentId : t.parentId == null
      ).sort((a, b) => a.sortOrder - b.sortOrder)
      const { computeInsertionSort } = await import('../services/task-placement')
      const sortOrder = computeInsertionSort(siblings, beforeTodoId)
      const id = await addTodoAt(title || rawTitle, pid, selectedCanvasId, parentId, sortOrder)
      await applyNlpMetadata(
        id, resolved,
        (tid) => useTodoStore.getState().todos.find((t) => t.id === tid) as PersistedTodoItem | undefined,
        updateTodo, assignPerson, assignTag, assignOrg,
      )
      return id
    },
    [selectedCanvasId, todosByProject, addTodoAt, updateTodo, assignPerson, assignTag, assignOrg, people, tags, orgs]
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

  const handleConvertNoteLines = useCallback(
    async (lines: string[]) => {
      if (!selectedCanvasId) return
      for (const line of lines) {
        const { title, resolved } = parseTaskInput(line, people, tags, projects, orgs)
        let pid = resolved.projectId
        if (!pid) {
          pid = projects[0]?.id
          if (!pid) {
            pid = await addProject('Notes', selectedCanvasId)
          }
        }
        const id = await addTodo(title || line, selectedCanvasId, pid)
        await applyNlpMetadata(
          id, resolved,
          (tid) => useTodoStore.getState().todos.find((t) => t.id === tid) as PersistedTodoItem | undefined,
          updateTodo, assignPerson, assignTag, assignOrg,
        )
      }
    },
    [selectedCanvasId, addTodo, updateTodo, assignPerson, assignTag, assignOrg, people, tags, projects, orgs, addProject]
  )

  const handleResizeNote = useCallback(
    async (id: number, width: number, height: number) => {
      const note = stickyNotes.find(n => n.id === id)
      if (!note) return
      await updateNote({ ...note, width, height, modifiedAt: new Date() })
    },
    [stickyNotes, updateNote]
  )

  const handleAddListInset = useCallback(
    async (preset: string, x: number, y: number) => {
      if (!selectedCanvasId) return
      const names: Record<string, string> = {
        'due-this-week': 'Due This Week',
        'starred': 'Follow Up',
        'high-priority': 'High Priority',
      }
      await addInset(names[preset] || preset, preset as 'due-this-week' | 'starred' | 'high-priority', selectedCanvasId, x, y)
    },
    [selectedCanvasId, addInset]
  )

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

  const handleAddStickyNote = useCallback(async (x: number, y: number) => {
    if (selectedCanvasId) await addNote(selectedCanvasId, x, y)
  }, [selectedCanvasId, addNote])

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
    onAddListInset: handleAddListInset,
    onResizeInset: handleResizeInset,
  }), [removeInset, handleToggleCollapseInset, updateInsetPosition, handleAddListInset, handleResizeInset])

  const stickyHandlers = useMemo(() => ({
    onAddStickyNote: handleAddStickyNote,
    onDeleteNote: removeNote,
    onUpdateNoteText: updateNoteText,
    onUpdateNoteTitle: updateNoteTitle,
    onUpdateNoteColor: updateNoteColor,
    onNoteDragStop: updateNotePosition,
    onResizeNote: handleResizeNote,
    onConvertNoteLines: handleConvertNoteLines,
  }), [handleAddStickyNote, removeNote, updateNoteText, updateNoteTitle, updateNoteColor, updateNotePosition, handleResizeNote, handleConvertNoteLines])

  const handleTaskboardDragStop = useCallback((x: number, y: number) => {
    setTaskboardPosition({ x, y })
    localStorage.setItem('taskboardPosition', JSON.stringify({ x, y }))
  }, [])

  const handleToggleTaskboardCollapse = useCallback(() => {
    setIsTaskboardCollapsed(prev => {
      const next = !prev
      localStorage.setItem('taskboardCollapsed', String(next))
      return next
    })
  }, [])

  const handleCloseTaskboard = useCallback(() => {
    const count = useTaskboardStore.getState().entries.length
    showBulkConfirmation('custom', [], {
      title: 'Clear taskboard',
      message: `Remove all ${count} task${count !== 1 ? 's' : ''} from the taskboard?`,
      confirmLabel: 'Clear',
      onConfirm: () => useTaskboardStore.getState().clear(),
    })
  }, [showBulkConfirmation])

  const handleResizeTaskboard = useCallback((w: number, h: number) => {
    setTaskboardSize({ w, h })
    localStorage.setItem('taskboardSize', JSON.stringify({ w, h }))
  }, [])

  return (
    <DndContext
      sensors={dnd.sensors}
      measuring={dnd.measuring}
      collisionDetection={pointerWithin}
      onDragStart={dnd.handleDragStart}
      onDragMove={dnd.handleDragMove}
      onDragOver={dnd.handleDragOver}
      onDragEnd={dnd.handleDragEnd}
    >
      <DragInsertContext.Provider value={{ insertTodoId: dnd.insertTodoId, insertIndentLevel: dnd.insertIndentLevel, insertAtEnd: dnd.insertAtEnd, insertProjectId: dnd.insertProjectId, activeDragTodoId: dnd.activeDragTodo?.id ?? null, dragExpandedProjectId: dnd.dragExpandedProjectId, dragGroupIds: dnd.dragGroupIds }}>
      <CanvasView
        projects={projects}
        todosByProject={todosByProject}
        assignedPeopleMap={assignedPeopleMap}
        assignedTagsMap={assignedTagsMap}
        assignedOrgsMap={assignedOrgsMap}
        ghostTodoIds={ghostTodoIds}
        onNodeDragStop={handleNodeDragStop}
        onReactFlowInit={handleReactFlowInit}
        onOpenDetail={handleClickTask}
        projectHandlers={projectHandlers}
        listInsets={insets}
        allTodos={todos}
        insetHandlers={insetHandlers}
        stickyNotes={stickyNotes}
        stickyHandlers={stickyHandlers}
        allPeople={people}
        allTags={tags}
        allOrgs={orgs}
        taskboardEntries={taskboardEntries}
        isTaskboardCollapsed={isTaskboardCollapsed}
        onToggleTaskboardCollapse={handleToggleTaskboardCollapse}
        onCloseTaskboard={handleCloseTaskboard}
        onTaskboardDragStop={handleTaskboardDragStop}
        taskboardPosition={taskboardPosition}
        taskboardWidth={taskboardSize.w}
        taskboardHeight={taskboardSize.h}
        onResizeTaskboard={handleResizeTaskboard}
        onCascadeShift={handleCascadeShift}
      />
      {isProjectNavigatorOpen && (
        <ProjectNavigator
          projects={projects}
          todosByProject={todosByProject}
          rfInstance={rfInstanceRef.current}
        />
      )}
      </DragInsertContext.Provider>

      <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
        {dnd.activeDragTodo && (
          <div className={overlayStyles.overlay}>
            <TaskRow
              todo={dnd.activeDragTodo}
              ghost
            />
            {dnd.activeDragChildren.map(child => (
              <TaskRow
                key={child.id}
                todo={child}
                indentLevel={1}
                ghost
              />
            ))}
            {dnd.multiDragCount > 1 && !dnd.activeDragChildren.length && (
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

      <FilteredListPopup />
    </DndContext>
  )
}
