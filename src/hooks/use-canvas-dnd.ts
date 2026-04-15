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
import { resolveDropTarget, resolveDropPreview, type DropContext } from '../services/drop-resolver'
import { placeTaskAt, placeMultipleAt, indentTasks, outdentTasks, shouldNormalize, normalizeSortOrders } from '../services/task-placement'
import { getFlatVisualOrder, bySortOrder } from '../utils/hierarchy'

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
  const [activeDragChildren, setActiveDragChildren] = useState<PersistedTodoItem[]>([])
  const [multiDragCount, setMultiDragCount] = useState(0)
  const [dragExpandedProjectId, setDragExpandedProjectId] = useState<number | null>(null)
  const [insertTodoId, setInsertTodoId] = useState<number | null>(null)
  const [insertIndentLevel, setInsertIndentLevel] = useState(0)
  const [insertAtEnd, setInsertAtEnd] = useState(false)
  const [insertProjectId, setInsertProjectId] = useState<number | null>(null)
  const [dragGroupIds, setDragGroupIds] = useState<Set<number> | null>(null)

  // Track last valid task-level preview to suppress gap flicker
  const lastPreviewRef = useRef<{
    insertTodoId: number | null
    insertAtEnd: boolean
    forProjectId: number | null
    pointerY: number
  }>({ insertTodoId: null, insertAtEnd: false, forProjectId: null, pointerY: 0 })

  // Cache the expanded over-context from the last accepted preview so
  // handleDragEnd uses the same target the green indicator line showed
  const lastExpandedOverRef = useRef<{
    overType: 'task' | 'project' | null
    overTodo: PersistedTodoItem | null
    overProjectId: number | null
  } | null>(null)

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

          case 'indent': {
            const projectTodos = todosByProject.get(resolution.projectId) ?? []
            const mutations = indentTasks(projectTodos, resolution.taskIds)
            if (mutations.length > 0) await applyMutations(mutations)
            await normalizeProject(resolution.projectId)
            break
          }

          case 'outdent': {
            const projectTodos = todosByProject.get(resolution.projectId) ?? []
            const mutations = outdentTasks(projectTodos, resolution.taskIds)
            if (mutations.length > 0) await applyMutations(mutations)
            await normalizeProject(resolution.projectId)
            break
          }

          case 'create-project': {
            if (!selectedCanvasId) break
            const projectId = await addProject('New Project', selectedCanvasId, resolution.position.x, resolution.position.y)
            const taskIds = resolution.taskIds
            const target = { projectId, parentId: undefined as number | undefined, beforeTodoId: null }
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
      const flat = getFlatVisualOrder(projectTodos)
      const collapsed = useUIStore.getState().collapsedParents
      const idx = flat.findIndex(t => t.id === overTodo!.id)
      const hasVisChildren = idx >= 0 && idx < flat.length - 1 &&
        flat[idx + 1].parentId === overTodo!.id && !collapsed.has(overTodo!.id)
      if (idx < 0 || hasVisChildren) {
        return { overType, overTodo, overProjectId }
      }
      const origPid = overTodo.projectId!
      const dragIds = multiDragIdsRef.current
      for (let i = idx + 1; i < flat.length; i++) {
        if (flat[i].parentId != null && collapsed.has(flat[i].parentId!)) continue
        if (flat[i].id === activeTodoId) continue
        if (dragIds && dragIds.has(flat[i].id)) continue
        return { overType: 'task' as const, overTodo: flat[i], overProjectId }
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
    setActiveDragChildren([])
    setMultiDragCount(0)
    setDragExpandedProjectId(null)
    setInsertTodoId(null)
    setInsertIndentLevel(0)
    setInsertAtEnd(false)
    setInsertProjectId(null)
    setDragGroupIds(null)
    lastPreviewRef.current = { insertTodoId: null, insertAtEnd: false, forProjectId: null, pointerY: 0 }
    lastExpandedOverRef.current = null
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
        lastPreviewRef.current = { insertTodoId: null, insertAtEnd: false, forProjectId: null, pointerY: 0 }
        lastExpandedOverRef.current = null
        const sel = useUIStore.getState().selectedTodoIds
        const isMulti = sel.size > 1 && sel.has(todo.id)

        // Find children of the dragged task
        const children = todos.filter(t => t.parentId === todo.id)
          .sort(bySortOrder)
        setActiveDragChildren(children)

        if (isMulti) {
          const dragSet = new Set(sel)
          // Include children of selected parents
          for (const id of sel) {
            for (const t of todos) {
              if (t.parentId === id) dragSet.add(t.id)
            }
          }
          multiDragIdsRef.current = dragSet
          setMultiDragCount(dragSet.size)
          const groupIds = new Set(dragSet)
          groupIds.delete(todo.id)
          setDragGroupIds(groupIds)
        } else if (children.length > 0) {
          const dragSet = new Set([todo.id, ...children.map(c => c.id)])
          multiDragIdsRef.current = dragSet
          setMultiDragCount(dragSet.size)
          setDragGroupIds(new Set(children.map(c => c.id)))
        } else {
          multiDragIdsRef.current = null
          setMultiDragCount(0)
          setDragGroupIds(null)
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
    [todos, startEdgePan]
  )

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      const { over, delta } = event
      const activeTodo = event.active.data.current?.todo as PersistedTodoItem | undefined
      if (!activeTodo) {
        setInsertTodoId(null)
        setInsertIndentLevel(0)
        setInsertAtEnd(false)
        setInsertProjectId(null)
        lastExpandedOverRef.current = null
        return
      }

      const overData = over?.data.current

      // Hovering over taskboard — clear insert preview (taskboard handles its own highlight)
      if (overData?.type === 'taskboard' || overData?.type === 'taskboard-task') {
        setInsertTodoId(null)
        setInsertIndentLevel(0)
        setInsertAtEnd(false)
        setInsertProjectId(null)
        lastExpandedOverRef.current = null
        return
      }

      const rawOverType: 'task' | 'project' | null = overData?.type === 'task' ? 'task'
        : overData?.type === 'project' ? 'project'
        : null
      const rawOverTodo: PersistedTodoItem | null = rawOverType === 'task' ? (overData!.todo as PersistedTodoItem) : null
      const rawOverProjectId: number | null = rawOverType === 'project' ? (overData!.projectId as number) : null

      const { overType, overTodo, overProjectId } = expandTargetArea(
        rawOverType, rawOverTodo, rawOverProjectId,
        over ? { rect: over.rect ? { top: over.rect.top, height: over.rect.height } : undefined } : null,
        activeTodo.id,
      )

      const preview = resolveDropPreview(activeTodo, overType, overTodo, overProjectId, delta, todosByProject)

      // When cursor enters the 1-2px gap between task rows, dnd-kit reports the
      // project container instead of a task. Suppress the preview update so the
      // green indicator line doesn't flicker to end-of-list and back.
      const pointerY = edgePanRef.current.pointerY
      if (
        preview.insertAtEnd &&
        rawOverType !== 'task' &&
        lastPreviewRef.current.insertTodoId != null &&
        !lastPreviewRef.current.insertAtEnd &&
        preview.insertProjectId != null &&
        preview.insertProjectId === lastPreviewRef.current.forProjectId &&
        Math.abs(pointerY - lastPreviewRef.current.pointerY) < 20
      ) {
        return
      }

      lastPreviewRef.current = {
        insertTodoId: preview.insertTodoId,
        insertAtEnd: preview.insertAtEnd,
        forProjectId: overTodo?.projectId ?? preview.insertProjectId ?? null,
        pointerY,
      }
      lastExpandedOverRef.current = { overType, overTodo, overProjectId }

      setInsertTodoId(preview.insertTodoId)
      setInsertIndentLevel(preview.insertIndentLevel)
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
      if (overData?.type === 'project') {
        targetProjectId = overData.projectId as number
      } else if (overData?.type === 'task') {
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

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      // Cache values needed for drop execution before resetting state
      const cachedExpansion = lastExpandedOverRef.current
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

      const activeType = active.data.current?.type
      const overData = over?.data.current

      // ── Taskboard entry being dragged ──
      if (activeType === 'taskboard-task') {
        const activeEntryId = active.data.current?.entryId as number

        if (overData?.type === 'taskboard-task') {
          // Dropped on another taskboard entry → reorder (SortableContext handles visual)
          const overEntryId = overData.entryId as number
          const entries = useTaskboardStore.getState().entries
          const fromIndex = entries.findIndex(e => e.id === activeEntryId)
          const toIndex = entries.findIndex(e => e.id === overEntryId)
          if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
            useTaskboardStore.getState().reorder(fromIndex, toIndex)
          }
          return
        }

        if (overData?.type === 'taskboard') {
          // Dropped on taskboard zone → move to end
          const entries = useTaskboardStore.getState().entries
          const fromIndex = entries.findIndex(e => e.id === activeEntryId)
          if (fromIndex !== -1 && fromIndex !== entries.length - 1) {
            useTaskboardStore.getState().reorder(fromIndex, entries.length - 1)
          }
          return
        }

        // Dropped anywhere else → remove from taskboard
        await useTaskboardStore.getState().remove(activeTodo.id)
        return
      }

      // Dropped onto the taskboard — add task(s) at drop position
      if (overData?.type === 'taskboard' || overData?.type === 'taskboard-task') {
        const tbState = useTaskboardStore.getState()

        // Determine insert index
        let targetIndex = tbState.entries.length
        if (overData?.type === 'taskboard-task') {
          const overEntryId = overData.entryId as number
          const idx = tbState.entries.findIndex(e => e.id === overEntryId)
          if (idx !== -1) {
            targetIndex = idx
            const overRect = over?.rect
            const translated = active.rect.current.translated
            const initialRect = active.rect.current.initial
            let activeCenter: number | null = null
            if (translated) activeCenter = translated.top + translated.height / 2
            else if (initialRect) activeCenter = initialRect.top + initialRect.height / 2 + delta.y
            if (activeCenter != null && overRect) {
              const overCenter = overRect.top + overRect.height / 2
              if (activeCenter > overCenter) targetIndex++
            }
          }
        }

        if (dragIds) {
          await tbState.addMultipleAt([...dragIds], targetIndex)
        } else {
          await tbState.addAt(activeTodo.id, targetIndex)
        }
        return
      }

      // Use the cached expansion from the last accepted preview so the drop
      // matches what the green indicator line showed. Fall back to fresh
      // expansion only if no preview was computed (e.g. very fast drag).
      let overType: 'task' | 'project' | null
      let overTodo: PersistedTodoItem | null
      let overProjectId: number | null
      if (cachedExpansion) {
        ({ overType, overTodo, overProjectId } = cachedExpansion)
      } else {
        const rawOverType: 'task' | 'project' | null = overData?.type === 'task' ? 'task'
          : overData?.type === 'project' ? 'project'
          : null
        const rawOverTodo: PersistedTodoItem | null = rawOverType === 'task' ? (overData!.todo as PersistedTodoItem) : null
        const rawOverProjectId: number | null = rawOverType === 'project' ? (overData!.projectId as number) : null
        ;({ overType, overTodo, overProjectId } = expandTargetArea(
          rawOverType, rawOverTodo, rawOverProjectId,
          over ? { rect: over.rect ? { top: over.rect.top, height: over.rect.height } : undefined } : null,
          activeTodo.id,
        ))
      }

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
    },
    [todosByProject, selectedCanvasId, executeDrop, resetDragState, expandTargetArea, rfInstanceRef]
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
    activeDragChildren,
    multiDragCount,
    dragExpandedProjectId,
    insertTodoId,
    insertIndentLevel,
    insertAtEnd,
    insertProjectId,
    dragGroupIds,
    // Config
    sensors,
    measuring,
  }
}
