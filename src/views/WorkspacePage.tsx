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
import type { CalendarDateType } from '../models/workspace-layout'
import { useWorkspaceStore } from '../stores/workspace-store'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'
import { useStatusStore } from '../stores/status-store'
import { useProjectStore } from '../stores/project-store'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useUIStore } from '../stores/ui-store'
import { useEntityAssignmentsForTodos } from '../hooks/use-entity-assignments-for-todos'
import { buildTaskCollision, dispatchTaskDrop, type CalendarDropChoiceRequest } from '../utils/task-dnd'
import { buildRescheduleUpdate } from '../utils/reschedule'
import { dropChangesLayout, dropTargetForHit, hitTestWorkspace } from '../utils/workspace-drop'
import { DRAG_ACTIVATION_DISTANCE_PX } from '../constants'
import { WorkspaceView } from '../components/workspace/WorkspaceView'
import { MobileWorkspaceView } from '../components/workspace/MobileWorkspaceView'
import { useIsMobile } from '../hooks/use-is-mobile'
import { measureWorkspace } from '../components/workspace/measure'
import { UnsavedPrompt } from '../components/workspace/UnsavedPrompt'
import { ListOptionsHost } from '../components/workspace/list/ListOptionsHost'
import { getUnsavedListIds, useUnsavedListIds } from '../stores/list-draft-store'
import { PlusIcon, WidgetKindIcon } from '../components/workspace/icons'
import {
  isWorkspaceTabDragData,
  TabDragContext,
  WORKSPACE_TAB_DRAG,
  type TabDragState,
} from '../components/workspace/workspace-drag'
import { TaskRow } from '../components/task/TaskRow'
import { CalendarEntryButton } from '../components/workspace/calendar/CalendarEntryButton'
import { CalendarDropChooser } from '../components/workspace/calendar/CalendarDropChooser'
import {
  isCalendarEntryDragData,
  PendingCalendarDropContext,
  type CalendarEntryDragData,
  type PendingCalendarDrop,
} from '../components/workspace/calendar/calendar-drag'
import calendarStyles from '../components/workspace/calendar/CalendarWidget.module.css'
import { TaskEditPopupHost } from '../components/task/TaskEditPopupHost'
import { FilteredListPopup } from '../components/overlays/FilteredListPopup'
import { DashboardListsEditor } from '../components/settings/DashboardListsEditor'
import { StandaloneListEditor } from '../components/shared/StandaloneListEditor'
import overlayStyles from '../components/workspace/DragOverlayTask.module.css'
import styles from './WorkspacePage.module.css'

/** No drag sensors on mobile: layout editing and task drags are desktop-only there. */
const NO_SENSORS: ReturnType<typeof useSensors> = []

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
 * saved lists — and the people / tag assignments of the
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

/**
 * Blocks in-app navigation away from unsaved work — the layout or a list
 * definition — until the user answers; asks the browser to confirm an unload.
 */
function UnsavedNavigationGuard() {
  const isDirty = useWorkspaceStore((s) => s.isDirty)
  const unsavedLists = useUnsavedListIds()
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) =>
        (useWorkspaceStore.getState().isDirty || getUnsavedListIds().length > 0)
        && currentLocation.pathname !== nextLocation.pathname,
      [],
    ),
  )

  const unsaved = isDirty || unsavedLists.length > 0
  useEffect(() => {
    if (!unsaved) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [unsaved])

  if (blocker.state !== 'blocked') return null
  return (
    <UnsavedPrompt
      lead="You’re leaving the workspace."
      layout={isDirty}
      listIds={unsavedLists}
      onDone={() => blocker.proceed()}
      onCancel={() => blocker.reset()}
    />
  )
}

/**
 * dnd-kit scrolls the dragged item's scrollable ancestors whenever the
 * pointer is near or past their edges — even from another column, so a row
 * dragged out of a list toward a calendar scrolled the list. Only scroll a
 * container while the pointer is inside it.
 */
function useAutoScrollUnderPointer() {
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const onMove = (e: PointerEvent) => { pointerRef.current = { x: e.clientX, y: e.clientY } }
    window.addEventListener('pointerdown', onMove, { passive: true, capture: true })
    window.addEventListener('pointermove', onMove, { passive: true, capture: true })
    return () => {
      window.removeEventListener('pointerdown', onMove, { capture: true })
      window.removeEventListener('pointermove', onMove, { capture: true })
    }
  }, [])
  return useMemo(() => ({
    canScroll: (el: Element) => {
      const p = pointerRef.current
      if (!p) return true
      const r = el.getBoundingClientRect()
      return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom
    },
  }), [])
}

/** A task drag in progress (list row or calendar entry), for the drag overlay. */
interface ActiveTaskDrag {
  todo: PersistedTodoItem
  /** Set for a calendar entry: the overlay draws the entry, not a task row. */
  calendarEntry?: CalendarEntryDragData['calendarEntry']
}

interface CalendarChoice {
  todo: PersistedTodoItem
  date: Date
  at: { x: number; y: number }
  scope: string | undefined
  settle: (type: CalendarDateType | null) => void
}

/**
 * The Due / Follow-up chooser for a list drag dropped on a calendar showing
 * both date types: `choose` opens it and resolves with the pick (`null` =
 * cancelled); `pending` keeps the day highlighted while it's open.
 */
function useCalendarDropChoice() {
  const [request, setRequest] = useState<CalendarChoice | null>(null)
  const openRef = useRef<CalendarChoice | null>(null)
  const choose = useCallback((req: CalendarDropChoiceRequest) => new Promise<CalendarDateType | null>((resolve) => {
    openRef.current?.settle(null)
    let settled = false
    const choice: CalendarChoice = {
      todo: req.todo,
      date: req.date,
      at: req.at ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      scope: req.scope,
      settle: (type) => {
        if (settled) return
        settled = true
        if (openRef.current === choice) {
          openRef.current = null
          setRequest(null)
        }
        resolve(type)
      },
    }
    openRef.current = choice
    setRequest(choice)
  }), [])
  const done = useCallback((type: CalendarDateType | null) => request?.settle(type), [request])
  const pending = useMemo<PendingCalendarDrop | null>(
    () => (request?.scope ? { scope: request.scope, dateMs: request.date.getTime() } : null),
    [request],
  )
  return { request, choose, done, pending }
}

export function WorkspacePage() {
  const working = useWorkspaceStore((s) => s.working)
  const hydrated = useWorkspaceStore((s) => s.hydrated)
  const showListsEditor = useUIStore((s) => s.listsEditorOpen)
  const listsEditorInitialId = useUIStore((s) => s.listsEditorInitialId)
  const closeListsEditor = useUIStore((s) => s.closeListsEditor)
  const [activeDrag, setActiveDrag] = useState<ActiveTaskDrag | null>(null)
  const calendarChoice = useCalendarDropChoice()
  const autoScroll = useAutoScrollUnderPointer()
  const tabDrag = useTabDragState()
  const isMobile = useIsMobile()

  useWorkspaceData()

  // Opened from here, not at startup: the app's startup chain (incl. the sync
  // file load) has finished before any page mounts.
  useEffect(() => {
    if (!useWorkspaceStore.getState().hydrated) void useWorkspaceStore.getState().init()
  }, [])

  const pointerSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } }),
  )
  const sensors = isMobile ? NO_SENSORS : pointerSensors

  // Tab drags find their target from pointer geometry, not dnd-kit
  // droppables; task drags match the widgets' droppables (calendar days)
  // under the pointer.
  const collisionDetection = useMemo(() => buildTaskCollision([
    { when: (active) => active.data.current?.type === WORKSPACE_TAB_DRAG, accept: () => false, algorithm: 'pointerWithin' },
    { when: () => true, accept: () => true, algorithm: 'pointerWithin' },
  ]), [])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    if (tabDrag.start(event)) return
    const data = event.active.data.current
    const todo = data?.todo as PersistedTodoItem | undefined
    if (todo) setActiveDrag({ todo, calendarEntry: isCalendarEntryDragData(data) ? data.calendarEntry : undefined })
  }, [tabDrag])

  const chooseType = calendarChoice.choose
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    if (isWorkspaceTabDragData(event.active.data.current)) {
      tabDrag.end(true)
      return
    }
    setActiveDrag(null)
    await dispatchTaskDrop(event, {
      calendar: {
        reschedule: async (todoId, date, type) => {
          const t = useTodoStore.getState().todos.find((x) => x.id === todoId)
          if (!t) return
          await useTodoStore.getState().update(buildRescheduleUpdate(t, date, type))
        },
        chooseType,
      },
    })
  }, [tabDrag, chooseType])

  const handleDragCancel = useCallback(() => {
    tabDrag.end(false)
    setActiveDrag(null)
  }, [tabDrag])

  const drag = tabDrag.drag

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      autoScroll={autoScroll}
      onDragStart={handleDragStart}
      onDragEnd={(e) => { void handleDragEnd(e) }}
      onDragCancel={handleDragCancel}
    >
      <TabDragContext.Provider value={drag}>
        <PendingCalendarDropContext.Provider value={calendarChoice.pending}>
          <div className={styles.page} data-dragging-tab={drag ? 'true' : undefined}>
            {working
              ? (isMobile ? <MobileWorkspaceView layout={working} /> : <WorkspaceView layout={working} />)
              : hydrated ? null : <div className={styles.loading}>Loading…</div>}
          </div>
        </PendingCalendarDropContext.Provider>
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
        ) : activeDrag?.calendarEntry ? (
          <div className={calendarStyles.ghost} data-drag-overlay>
            <CalendarEntryButton
              entry={activeDrag.calendarEntry.entry}
              today={activeDrag.calendarEntry.today}
              size={activeDrag.calendarEntry.size}
              wrap={activeDrag.calendarEntry.wrap}
              ghost
            />
          </div>
        ) : activeDrag ? (
          <div className={overlayStyles.overlay} data-drag-overlay>
            <TaskRow todo={activeDrag.todo} ghost />
          </div>
        ) : null}
      </DragOverlay>
      {calendarChoice.request && (
        <CalendarDropChooser
          todo={calendarChoice.request.todo}
          date={calendarChoice.request.date}
          at={calendarChoice.request.at}
          onDone={calendarChoice.done}
        />
      )}

      <TaskEditPopupHost />
      <FilteredListPopup />
      {showListsEditor && (
        <DashboardListsEditor onClose={closeListsEditor} initialSelectedId={listsEditorInitialId ?? undefined} />
      )}
      <StandaloneListEditor />
      <ListOptionsHost />
      <UnsavedNavigationGuard />
    </DndContext>
  )
}
