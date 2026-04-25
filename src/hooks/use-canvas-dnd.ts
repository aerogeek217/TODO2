import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragMoveEvent,
} from '@dnd-kit/core'
import type { PersistedTodoItem, Project } from '../models'
import type { ReactFlowInstance } from '@xyflow/react'
import { useTodoStore } from '../stores/todo-store'
import { useUIStore } from '../stores/ui-store'
import { useUndoStore } from '../stores/undo-store'
import { useTaskboardStore } from '../stores/taskboard-store'
import { usePersonStore } from '../stores/person-store'
import { useOrgStore } from '../stores/org-store'
import { useTagStore } from '../stores/tag-store'
import { resolveDropTarget, resolveDropPreview, type DropContext } from '../services/drop-resolver'
import { placeTaskAt, placeMultipleAt, shouldNormalize, normalizeSortOrders } from '../services/task-placement'
import { bySortOrder } from '../utils/sort-order'
import { buildRescheduleUpdate } from '../utils/reschedule'
import {
  TASK_DROP_KIND,
  dispatchTaskDrop,
} from '../utils/task-dnd'
import {
  resolveCrossGroupMutation,
  parseBlockContextId,
  type CrossGroupMutation,
} from '../utils/cross-group-drag'

interface UseCanvasDnDOptions {
  todos: PersistedTodoItem[]
  todosByProject: Map<number, PersistedTodoItem[]>
  projects: Project[]
  selectedCanvasId: number | null
  addProject: (name: string, canvasId: number, x?: number, y?: number) => Promise<number>
  applyMutations: (mutations: { todoId: number; changes: Record<string, unknown> }[]) => Promise<void>
  rfInstanceRef: React.RefObject<ReactFlowInstance | null>
}

export function useCanvasDnD({
  todos,
  todosByProject,
  projects,
  selectedCanvasId,
  addProject,
  applyMutations,
  rfInstanceRef,
}: UseCanvasDnDOptions) {
  const multiDragIdsRef = useRef<Set<number> | null>(null)
  const [activeDragTodo, setActiveDragTodo] = useState<PersistedTodoItem | null>(null)
  const [multiDragCount, setMultiDragCount] = useState(0)
  const [dragExpandedProjectId, setDragExpandedProjectId] = useState<number | null>(null)
  const [insertTodoId, setInsertTodoId] = useState<number | null>(null)
  const [insertAtEnd, setInsertAtEnd] = useState(false)
  const [insertProjectId, setInsertProjectId] = useState<number | null>(null)
  const [dragSelectionIds, setDragSelectionIds] = useState<Set<number> | null>(null)

  // Edge panning during drag
  const edgePanRef = useRef<{
    active: boolean
    pointerX: number
    pointerY: number
    animId: number | null
  }>({ active: false, pointerX: 0, pointerY: 0, animId: null })
  const pointerListenerRef = useRef<((e: PointerEvent) => void) | null>(null)
  // Pending phantom-cleanup setTimeouts, tracked so we can cancel them on re-drag
  // (isConnected guards already prevent visible impact; this is code hygiene).
  const phantomTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  // Pointer sensor with distance constraint to avoid conflicting with React Flow pan
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  )

  // Re-measure droppable rects every 200ms during drag
  const measuring = useMemo(() => ({
    droppable: {
      strategy: MeasuringStrategy.WhileDragging,
      frequency: 200,
    }
  }), [])

  // Edge-of-screen panning during task drag
  const startEdgePan = useCallback(() => {
    const EDGE = 60
    const SPEED = 12

    const loop = () => {
      if (!edgePanRef.current.active) return
      const rf = rfInstanceRef.current
      const el = document.querySelector('.react-flow')
      if (!rf || !el) { edgePanRef.current.animId = requestAnimationFrame(loop); return }

      const r = el.getBoundingClientRect()
      const { pointerX: px, pointerY: py } = edgePanRef.current
      let dx = 0, dy = 0

      if (px > r.left && px < r.left + EDGE) dx = SPEED * ((r.left + EDGE - px) / EDGE)
      else if (px > r.right - EDGE && px < r.right) dx = -SPEED * ((px - r.right + EDGE) / EDGE)
      if (py > r.top && py < r.top + EDGE) dy = SPEED * ((r.top + EDGE - py) / EDGE)
      else if (py > r.bottom - EDGE && py < r.bottom) dy = -SPEED * ((py - r.bottom + EDGE) / EDGE)

      if (dx !== 0 || dy !== 0) {
        const vp = rf.getViewport()
        // Scale screen-pixel pan by zoom so canvas-unit traversal feels consistent across zoom levels
        rf.setViewport({ x: vp.x + dx * vp.zoom, y: vp.y + dy * vp.zoom, zoom: vp.zoom })
      }
      edgePanRef.current.animId = requestAnimationFrame(loop)
    }
    edgePanRef.current.animId = requestAnimationFrame(loop)
  }, [rfInstanceRef])

  const stopEdgePan = useCallback(() => {
    edgePanRef.current.active = false
    if (edgePanRef.current.animId != null) {
      cancelAnimationFrame(edgePanRef.current.animId)
      edgePanRef.current.animId = null
    }
  }, [])

  // Cleanup edge pan on unmount
  useEffect(() => {
    const pending = phantomTimeoutsRef.current
    return () => {
      if (pointerListenerRef.current) window.removeEventListener('pointermove', pointerListenerRef.current)
      stopEdgePan()
      for (const tid of pending) clearTimeout(tid)
      pending.clear()
    }
  }, [stopEdgePan])

  const normalizeProject = useCallback(
    async (projectId: number) => {
      const fresh = useTodoStore.getState().todos.filter(t => t.projectId === projectId)
      if (shouldNormalize(fresh)) {
        const normMuts = normalizeSortOrders(fresh)
        if (normMuts.length > 0) await applyMutations(normMuts)
      }
    },
    [applyMutations]
  )

  const executeDrop = useCallback(
    async (ctx: DropContext) => {
      const resolution = resolveDropTarget(ctx)

      if (resolution.type === 'noop') return

      useUndoStore.getState().beginGroup()

      try {
        switch (resolution.type) {
          case 'place': {
            const task = todos.find(t => t.id === resolution.taskId)
            if (!task) break
            const projectTodos = todosByProject.get(resolution.target.projectId) ?? []
            const mutations = placeTaskAt(projectTodos, task, resolution.target)
            await applyMutations(mutations)
            await normalizeProject(resolution.target.projectId)
            break
          }

          case 'place-multi': {
            const mutations = placeMultipleAt(todos, resolution.taskIds, resolution.target)
            await applyMutations(mutations)
            await normalizeProject(resolution.target.projectId)
            break
          }

          case 'create-project': {
            if (!selectedCanvasId) break
            const projectId = await addProject('New Project', selectedCanvasId, resolution.position.x, resolution.position.y)
            const taskIds = resolution.taskIds
            const target = { projectId, beforeTodoId: null }
            if (taskIds.size === 1) {
              const task = todos.find(t => t.id === Array.from(taskIds)[0])
              if (task) {
                const projectTodos = todosByProject.get(projectId) ?? []
                const mutations = placeTaskAt(projectTodos, task, target)
                await applyMutations(mutations)
              }
            } else {
              const mutations = placeMultipleAt(todos, taskIds, target)
              await applyMutations(mutations)
            }
            break
          }
        }
      } catch (e) {
        // Catch mid-drop failures so they don't become unhandled rejections.
        // Per-call optimistic rollback already restores state; the finally block
        // below closes the undo group with whatever successful entries accumulated.
        console.error('Drop execution failed:', e)
      } finally {
        useUndoStore.getState().endGroup(`Move task`)
      }
    },
    [todos, todosByProject, selectedCanvasId, addProject, applyMutations, normalizeProject]
  )

  /** Resolve target area expansion: bottom 40% shifts to next visible task */
  const expandTargetArea = useCallback(
    (overType: 'task' | 'project' | null, overTodo: PersistedTodoItem | null, overProjectId: number | null, over: { rect?: { top: number; height: number } } | null, activeTodoId: number) => {
      if (overType !== 'task' || !overTodo || !over?.rect || overTodo.id === activeTodoId) {
        return { overType, overTodo, overProjectId }
      }
      const pointerY = edgePanRef.current.pointerY
      if (pointerY <= 0 || overTodo.projectId == null) {
        return { overType, overTodo, overProjectId }
      }
      const relY = (pointerY - over.rect.top) / over.rect.height
      if (relY <= 0.6) {
        return { overType, overTodo, overProjectId }
      }
      const projectTodos = todosByProject.get(overTodo.projectId) ?? []
      const sorted = [...projectTodos].sort(bySortOrder)
      const idx = sorted.findIndex(t => t.id === overTodo!.id)
      if (idx < 0) {
        return { overType, overTodo, overProjectId }
      }
      const origPid = overTodo.projectId!
      const dragIds = multiDragIdsRef.current
      for (let i = idx + 1; i < sorted.length; i++) {
        if (sorted[i].id === activeTodoId) continue
        if (dragIds && dragIds.has(sorted[i].id)) continue
        return { overType: 'task' as const, overTodo: sorted[i], overProjectId }
      }
      return { overType: 'project' as const, overTodo: null, overProjectId: origPid }
    },
    [todosByProject]
  )

  const resetDragState = useCallback(() => {
    stopEdgePan()
    if (pointerListenerRef.current) {
      window.removeEventListener('pointermove', pointerListenerRef.current)
      pointerListenerRef.current = null
    }
    setActiveDragTodo(null)
    setMultiDragCount(0)
    setDragExpandedProjectId(null)
    setInsertTodoId(null)
    setInsertAtEnd(false)
    setInsertProjectId(null)
    setDragSelectionIds(null)
    multiDragIdsRef.current = null
  }, [stopEdgePan])

  const handleDragCancel = useCallback(() => {
    resetDragState()
  }, [resetDragState])

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event
      const todo = active.data.current?.todo as PersistedTodoItem | undefined
      if (todo) {
        setActiveDragTodo(todo)
        const sel = useUIStore.getState().selectedTodoIds
        const isMulti = sel.size > 1 && sel.has(todo.id)

        if (isMulti) {
          const dragSet = new Set(sel)
          multiDragIdsRef.current = dragSet
          setMultiDragCount(dragSet.size)
          const selectionIds = new Set(dragSet)
          selectionIds.delete(todo.id)
          setDragSelectionIds(selectionIds)
        } else {
          multiDragIdsRef.current = null
          setMultiDragCount(0)
          setDragSelectionIds(null)
        }

        // Start edge panning and pointer tracking
        const initEvent = event.activatorEvent as PointerEvent
        edgePanRef.current.pointerX = initEvent.clientX
        edgePanRef.current.pointerY = initEvent.clientY
        edgePanRef.current.active = true
        startEdgePan()
        const onPointerMove = (e: PointerEvent) => {
          edgePanRef.current.pointerX = e.clientX
          edgePanRef.current.pointerY = e.clientY
        }
        window.addEventListener('pointermove', onPointerMove)
        pointerListenerRef.current = onPointerMove
      }
    },
    [startEdgePan]
  )

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      const { over, delta } = event
      const activeTodo = event.active.data.current?.todo as PersistedTodoItem | undefined
      if (!activeTodo) {
        setInsertTodoId(null)
        setInsertAtEnd(false)
        setInsertProjectId(null)
        return
      }

      const overData = over?.data.current

      // Hovering over taskboard / calendar day — clear insert preview (those
      // surfaces render their own drop feedback).
      if (overData?.type === TASK_DROP_KIND.taskboard
        || overData?.type === TASK_DROP_KIND.taskboardTask
        || overData?.type === TASK_DROP_KIND.calendarDay
      ) {
        setInsertTodoId(null)
        setInsertAtEnd(false)
        setInsertProjectId(null)
        return
      }

      const rawOverType: 'task' | 'project' | null = overData?.type === TASK_DROP_KIND.task ? 'task'
        : overData?.type === TASK_DROP_KIND.project ? 'project'
        : null
      const rawOverTodo: PersistedTodoItem | null = rawOverType === 'task' ? (overData!.todo as PersistedTodoItem) : null
      const rawOverProjectId: number | null = rawOverType === 'project' ? (overData!.projectId as number) : null

      const { overType, overTodo, overProjectId } = expandTargetArea(
        rawOverType, rawOverTodo, rawOverProjectId,
        over ? { rect: over.rect ? { top: over.rect.top, height: over.rect.height } : undefined } : null,
        activeTodo.id,
      )

      const preview = resolveDropPreview(activeTodo, overType, overTodo, overProjectId, delta, todosByProject)

      setInsertTodoId(preview.insertTodoId)
      setInsertAtEnd(preview.insertAtEnd)
      setInsertProjectId(preview.insertProjectId)
    },
    [todosByProject, expandTargetArea]
  )

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { over } = event
      if (!over) {
        setDragExpandedProjectId(null)
        return
      }
      const overData = over.data.current
      let targetProjectId: number | null = null
      if (overData?.type === TASK_DROP_KIND.project) {
        targetProjectId = overData.projectId as number
      } else if (overData?.type === TASK_DROP_KIND.task) {
        targetProjectId = (overData.todo as PersistedTodoItem).projectId ?? null
      }
      if (targetProjectId != null) {
        const project = projects.find((p) => p.id === targetProjectId)
        if (project?.isCollapsed) {
          setDragExpandedProjectId(targetProjectId)
          return
        }
      }
      setDragExpandedProjectId(null)
    },
    [projects]
  )

  const dispatchCrossGroupMutation = useCallback(
    async (mutation: CrossGroupMutation) => {
      switch (mutation.kind) {
        case 'status': {
          await useTodoStore.getState().bulkSetStatus([mutation.todoId], mutation.statusId)
          return
        }
        case 'people': {
          if (mutation.removeId != null) {
            await usePersonStore.getState().unassignPerson(mutation.todoId, mutation.removeId)
          }
          if (mutation.addId != null) {
            await usePersonStore.getState().assignPerson(mutation.todoId, mutation.addId)
          }
          return
        }
        case 'org': {
          if (mutation.removeId != null) {
            await useOrgStore.getState().unassignOrg(mutation.todoId, mutation.removeId)
          }
          if (mutation.addId != null) {
            await useOrgStore.getState().assignOrg(mutation.todoId, mutation.addId)
          }
          return
        }
        case 'tag': {
          if (mutation.removeId != null) {
            await useTagStore.getState().unassignTag(mutation.todoId, mutation.removeId)
          }
          if (mutation.addId != null) {
            await useTagStore.getState().assignTag(mutation.todoId, mutation.addId)
          }
          return
        }
      }
    },
    [],
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      // Cache values needed for drop execution before resetting state
      const dragIds = multiDragIdsRef.current

      // Cancel any pending phantom-cleanup timers from a previous drag before
      // spawning fresh ones. Stale phantoms are also removed from the DOM below.
      for (const tid of phantomTimeoutsRef.current) clearTimeout(tid)
      phantomTimeoutsRef.current.clear()

      // Clone overlay as a phantom before it unmounts (for animated drop transition)
      document.querySelector('[data-drop-phantom]')?.remove()  // clean up stale
      const prefersReducedMotion = typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      const overlayEl = prefersReducedMotion ? null : document.querySelector<HTMLElement>('[data-drag-overlay]')
      if (overlayEl) {
        const rect = overlayEl.getBoundingClientRect()
        const phantom = overlayEl.cloneNode(true) as HTMLElement
        phantom.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;transform:none;margin:0;z-index:10000;pointer-events:none;will-change:transform,opacity`
        phantom.setAttribute('data-drop-phantom', '')
        document.body.appendChild(phantom)
        // Fallback: fade out if FLIP doesn't claim it within 300ms
        const tidOuter = setTimeout(() => {
          phantomTimeoutsRef.current.delete(tidOuter)
          if (phantom.isConnected) {
            phantom.style.transition = 'opacity 180ms ease'
            phantom.style.opacity = '0'
            phantom.addEventListener('transitionend', () => phantom.remove(), { once: true })
            // Safety net: remove if transitionend never fires
            const tidInner = setTimeout(() => {
              phantomTimeoutsRef.current.delete(tidInner)
              if (phantom.isConnected) phantom.remove()
            }, 300)
            phantomTimeoutsRef.current.add(tidInner)
          }
        }, 300)
        phantomTimeoutsRef.current.add(tidOuter)
      }

      // Reset all drag state (edge pan, pointer tracking, UI state, refs)
      resetDragState()

      const { active, over, delta } = event

      const activeTodo = active.data.current?.todo as PersistedTodoItem | undefined
      if (!activeTodo) return

      // Shared taskboard + calendar-day branches. Returns true when the drop
      // was consumed (taskboard reorder/add/remove or calendar reschedule);
      // false when no shared branch fired and we should continue into the
      // project-placement resolver below.
      const handled = await dispatchTaskDrop(event, {
        taskboard: useTaskboardStore.getState(),
        multiDragIds: dragIds,
        calendar: {
          reschedule: async (todoId, date) => {
            const todo = useTodoStore.getState().todos.find((t) => t.id === todoId)
            if (!todo) return
            await useTodoStore.getState().update(buildRescheduleUpdate(todo, date))
          },
        },
      })
      if (handled) return

      const overData = over?.data.current
      const rawOverType: 'task' | 'project' | null = overData?.type === TASK_DROP_KIND.task ? 'task'
        : overData?.type === TASK_DROP_KIND.project ? 'project'
        : null
      const rawOverTodo: PersistedTodoItem | null = rawOverType === 'task' ? (overData!.todo as PersistedTodoItem) : null
      const rawOverProjectId: number | null = rawOverType === 'project' ? (overData!.projectId as number) : null
      const { overType, overTodo, overProjectId } = expandTargetArea(
        rawOverType, rawOverTodo, rawOverProjectId,
        over ? { rect: over.rect ? { top: over.rect.top, height: over.rect.height } : undefined } : null,
        activeTodo.id,
      )

      const ctx: DropContext = {
        activeTodo,
        overType,
        overTodo,
        overProjectId,
        delta,
        dragIds,
        todosByProject,
        screenToFlow: rfInstanceRef.current?.screenToFlowPosition ?? null,
        initialRect: active.rect.current.initial ? { left: active.rect.current.initial.left, top: active.rect.current.initial.top } : null,
        canvasId: selectedCanvasId,
      }

      await executeDrop(ctx)

      // Cross-group drag mutation (Phase 6 of lists-consistency). Triggered
      // only for single-task, same-project drops where both the dragged row
      // and the hovered row sit in `SortableTaskList` group containers:
      // replace semantics on people/org/tag, scalar set for status, skip
      // for date dimensions. Cross-project drags fall through to the
      // existing project-change behavior alone (no field mutation layered
      // on). Multi-drag is skipped to keep semantics unambiguous when the
      // selection spans multiple source groups.
      if (!dragIds) {
        const sourceContainer = parseBlockContextId(active.data.current?.sortable?.containerId)
        const targetContainer = parseBlockContextId(over?.data.current?.sortable?.containerId)
        if (
          sourceContainer
          && targetContainer
          && sourceContainer.projectId === targetContainer.projectId
          && sourceContainer.projectId === activeTodo.projectId
        ) {
          const project = projects.find((p) => p.id === sourceContainer.projectId)
          if (project?.groupBy) {
            const mutation = resolveCrossGroupMutation(
              project.groupBy,
              sourceContainer.blockKey,
              targetContainer.blockKey,
              activeTodo.id,
            )
            if (mutation) await dispatchCrossGroupMutation(mutation)
          }
        }
      }
    },
    [todosByProject, selectedCanvasId, executeDrop, resetDragState, expandTargetArea, rfInstanceRef, projects, dispatchCrossGroupMutation]
  )

  return {
    // Event handlers
    handleDragStart,
    handleDragMove,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    // State
    activeDragTodo,
    multiDragCount,
    dragExpandedProjectId,
    insertTodoId,
    insertAtEnd,
    insertProjectId,
    dragSelectionIds,
    // Config
    sensors,
    measuring,
  }
}
