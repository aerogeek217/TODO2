import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core'
import { useBlocker } from 'react-router'
import type { PersistedTodoItem } from '../models'
import { useWorkspaceStore } from '../stores/workspace-store'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'
import { useStatusStore } from '../stores/status-store'
import { useProjectStore } from '../stores/project-store'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useTaskboardStore } from '../stores/taskboard-store'
import { useUIStore } from '../stores/ui-store'
import { useEntityAssignmentsForTodos } from '../hooks/use-entity-assignments-for-todos'
import { buildTaskCollision, dispatchTaskDrop } from '../utils/task-dnd'
import { buildRescheduleUpdate } from '../utils/reschedule'
import { dropChangesLayout, dropTargetForHit, hitTestWorkspace } from '../utils/workspace-drop'
import { DRAG_ACTIVATION_DISTANCE_PX } from '../constants'
import { WorkspaceView } from '../components/workspace/WorkspaceView'
import { measureWorkspace } from '../components/workspace/measure'
import { UnsavedChangesDialog } from '../components/workspace/LayoutDialogs'
import { PlusIcon, WidgetKindIcon } from '../components/workspace/icons'
import {
  isWorkspaceTabDragData,
  TabDragContext,
  WORKSPACE_TAB_DRAG,
  type TabDragState,
} from '../components/workspace/workspace-drag'
import { TaskRow } from '../components/task/TaskRow'
import { TaskEditPopupHost } from '../components/task/TaskEditPopupHost'
import { FilteredListPopup } from '../components/overlays/FilteredListPopup'
import { DashboardListsEditor } from '../components/settings/DashboardListsEditor'
import { StandaloneListEditor } from '../components/shared/StandaloneListEditor'
import overlayStyles from '../components/canvas/DragOverlayTask.module.css'
import styles from './WorkspacePage.module.css'

/** The tab ghost follows the pointer at +12 / +10 px. */
const followPointer: Modifier = ({ activatorEvent, draggingNodeRect, transform, active }) => {
  if (!isWorkspaceTabDragData(active?.data.current) || !draggingNodeRect || !activatorEvent) return transform
  const e = activatorEvent as PointerEvent
  if (typeof e.clientX !== 'number') return transform
  return {
    ...transform,
    x: transform.x + (e.clientX - draggingNodeRect.left) + 12,
    y: transform.y + (e.clientY - draggingNodeRect.top) + 10,
  }
}

/**
 * Loads everything the workspace's widgets read, whatever route the app was
 * opened on: all tasks (not one canvas's), people, tags, statuses, projects,
 * saved lists, the taskboard — and the people / tag assignments of the
 * loaded tasks, so chips and person / tag groups render on a cold load.
 */
function useWorkspaceData(): void {
  const todos = useTodoStore((s) => s.todos)
  useEffect(() => {
    void useTodoStore.getState().loadAll()
    void useProjectStore.getState().loadAll()
    void usePersonStore.getState().ensureLoaded()
    void useTagStore.getState().ensureLoaded()
    void useStatusStore.getState().ensureLoaded()
    void useListDefinitionStore.getState().ensureLoaded()
    void useTaskboardStore.getState().ensureLoaded()
  }, [])
  useEntityAssignmentsForTodos(todos)
}

/**
 * Tab drags: measures the workspace when a tab drag starts, follows the
 * pointer to find the drop target, and applies the move on drop.
 */
function useTabDragState() {
  const [drag, setDragState] = useState<TabDragState | null>(null)
  // Source of truth for handlers (the state copy drives rendering).
  const dragRef = useRef<TabDragState | null>(null)
  const setDrag = useCallback((next: TabDragState | null) => {
    dragRef.current = next
    setDragState(next)
  }, [])

  const update = useCallback((x: number, y: number) => {
    const current = dragRef.current
    const layout = useWorkspaceStore.getState().working
    if (!current || !layout) return
    const hit = hitTestWorkspace(current.geometry, { x, y })
    const target = hit ? dropTargetForHit(layout, current.geometry, hit, current.tabId) : null
    const accepts = target != null && dropChangesLayout(layout, current.tabId, target)
    let insertLeft: number | null = null
    if (hit?.kind === 'tab-strip') {
      const cell = current.geometry.columns.flatMap((c) => c.cells).find((c) => c.id === hit.cellId)
      if (cell?.header) insertLeft = hit.lineX - cell.header.left
    }
    if (JSON.stringify([hit, accepts, insertLeft]) === JSON.stringify([current.hit, current.accepts, current.insertLeft])) return
    setDrag({ ...current, hit, target, accepts, insertLeft })
  }, [setDrag])

  const active = drag != null
  useEffect(() => {
    if (!active) return
    const onMove = (e: PointerEvent) => update(e.clientX, e.clientY)
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [active, update])

  const start = useCallback((event: DragStartEvent): boolean => {
    const data = event.active.data.current
    if (!isWorkspaceTabDragData(data)) return false
    const area = document.querySelector<HTMLElement>('[data-ws-area]')
    if (!area) return true
    setDrag({
      tabId: data.tabId,
      kind: data.kind,
      title: data.title,
      hit: null,
      target: null,
      accepts: false,
      insertLeft: null,
      geometry: measureWorkspace(area),
    })
    return true
  }, [setDrag])

  const end = useCallback((commit: boolean) => {
    const current = dragRef.current
    setDrag(null)
    if (commit && current?.target && current.accepts) {
      useWorkspaceStore.getState().moveTab(current.tabId, current.target)
    }
  }, [setDrag])

  return { drag, start, end }
}

/** Blocks in-app navigation away from a layout with unsaved changes until the user answers. */
function UnsavedNavigationGuard() {
  const isDirty = useWorkspaceStore((s) => s.isDirty)
  const name = useWorkspaceStore((s) => s.working?.name ?? '')
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) =>
        useWorkspaceStore.getState().isDirty && currentLocation.pathname !== nextLocation.pathname,
      [],
    ),
  )

  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  if (blocker.state !== 'blocked') return null
  return (
    <UnsavedChangesDialog
      layoutName={name}
      lead="You’re leaving the workspace."
      onSave={() => { void useWorkspaceStore.getState().save().then(() => blocker.proceed()) }}
      onDiscard={() => { useWorkspaceStore.getState().discard(); blocker.proceed() }}
      onCancel={() => blocker.reset()}
    />
  )
}

export function WorkspacePage() {
  const working = useWorkspaceStore((s) => s.working)
  const hydrated = useWorkspaceStore((s) => s.hydrated)
  const showListsEditor = useUIStore((s) => s.listsEditorOpen)
  const listsEditorInitialId = useUIStore((s) => s.listsEditorInitialId)
  const closeListsEditor = useUIStore((s) => s.closeListsEditor)
  const [activeDragTodo, setActiveDragTodo] = useState<PersistedTodoItem | null>(null)
  const tabDrag = useTabDragState()

  useWorkspaceData()

  // Opened from here, not at startup: the app's startup chain (incl. the sync
  // file load) has finished before any page mounts.
  useEffect(() => {
    if (!useWorkspaceStore.getState().hydrated) void useWorkspaceStore.getState().init()
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }),
  )

  // Tab drags find their target from pointer geometry, not dnd-kit
  // droppables; task drags match the widgets' droppables (calendar days,
  // the taskboard) under the pointer.
  const collisionDetection = useMemo(() => buildTaskCollision([
    { when: (active) => active.data.current?.type === WORKSPACE_TAB_DRAG, accept: () => false, algorithm: 'pointerWithin' },
    { when: () => true, accept: () => true, algorithm: 'pointerWithin' },
  ]), [])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    if (tabDrag.start(event)) return
    const todo = event.active.data.current?.todo as PersistedTodoItem | undefined
    if (todo) setActiveDragTodo(todo)
  }, [tabDrag])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    if (isWorkspaceTabDragData(event.active.data.current)) {
      tabDrag.end(true)
      return
    }
    setActiveDragTodo(null)
    await dispatchTaskDrop(event, {
      taskboard: useTaskboardStore.getState(),
      calendar: {
        reschedule: async (todoId, date) => {
          const t = useTodoStore.getState().todos.find((x) => x.id === todoId)
          if (!t) return
          await useTodoStore.getState().update(buildRescheduleUpdate(t, date))
        },
      },
    })
  }, [tabDrag])

  const handleDragCancel = useCallback(() => {
    tabDrag.end(false)
    setActiveDragTodo(null)
  }, [tabDrag])

  const drag = tabDrag.drag

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={(e) => { void handleDragEnd(e) }}
      onDragCancel={handleDragCancel}
    >
      <TabDragContext.Provider value={drag}>
        <div className={styles.page} data-dragging-tab={drag ? 'true' : undefined}>
          {working ? <WorkspaceView layout={working} /> : hydrated ? null : <div className={styles.loading}>Loading…</div>}
        </div>
      </TabDragContext.Provider>

      <DragOverlay dropAnimation={null} modifiers={[followPointer]}>
        {drag ? (
          <div className={styles.ghostWrap}>
            <div className={styles.ghost} data-testid="ws-drag-ghost">
              <span className={styles.ghostIcon}><WidgetKindIcon kind={drag.kind} size={12} /></span>
              <span className={styles.ghostTitle}>{drag.title}</span>
            </div>
            {drag.hit?.kind === 'column-edge' && drag.accepts && (
              <div className={styles.ghostLabel}><PlusIcon size={12} strokeWidth={2} /> New column</div>
            )}
          </div>
        ) : activeDragTodo ? (
          <div className={overlayStyles.overlay} data-drag-overlay>
            <TaskRow todo={activeDragTodo} ghost />
          </div>
        ) : null}
      </DragOverlay>

      <TaskEditPopupHost />
      <FilteredListPopup />
      {showListsEditor && (
        <DashboardListsEditor onClose={closeListsEditor} initialSelectedId={listsEditorInitialId ?? undefined} />
      )}
      <StandaloneListEditor />
      <UnsavedNavigationGuard />
    </DndContext>
  )
}
