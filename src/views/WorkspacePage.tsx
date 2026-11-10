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
  type SensorInstance,
} from '@dnd-kit/core'
import { useBlocker } from 'react-router'
import type { PersistedTodoItem } from '../models'
import type { CalendarDateType } from '../models/workspace-layout'
import { useWorkspaceStore } from '../stores/workspace-store'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'
import { useStatusStore } from '../stores/status-store'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useStatusUpdateStore } from '../stores/status-update-store'
import { useSubtaskStore } from '../stores/subtask-store'
import { useEntityAssignmentsForLoadedTodos } from '../hooks/use-entity-assignments-for-todos'
import { useClearSelectionOnOutsideClick } from '../hooks/use-clear-selection-on-outside-click'
import { buildTaskCollision, dispatchTaskDrop, type CalendarDropChoiceRequest } from '../utils/task-dnd'
import { buildRescheduleUpdate } from '../utils/reschedule'
import { applyPaneDrop, currentPaneContext, currentPanes } from '../services/eisenhower-drop'
import { startOfToday } from '../utils/date'
import { dragTasks } from '../components/workspace/eisenhower/eisenhower-drag'
import { dropGhost, dropTargetForHit, geometryCells, hitTestWorkspace, sameDropHit } from '../utils/workspace-drop'
import { DRAG_ACTIVATION_DISTANCE_PX } from '../constants'
import { WorkspaceView } from '../components/workspace/WorkspaceView'
import { MobileWorkspaceView } from '../components/workspace/MobileWorkspaceView'
import { SyncStatusButton } from '../components/layout/SyncStatusButton'
import { useIsMobile } from '../hooks/use-is-mobile'
import { measureWorkspace } from '../components/workspace/measure'
import { UnsavedPrompt } from '../components/workspace/UnsavedPrompt'
import { EditListHost } from '../components/workspace/list/EditList'
import { NumberEditorHost } from '../components/workspace/glance/NumberEditor'
import { ChartEditorHost } from '../components/workspace/glance/ChartEditor'
import { PulseEditorHost } from '../components/workspace/glance/PulseEditor'
import { getUnsavedListIds, useListDraftStore } from '../stores/list-draft-store'
import { unsavedDraftsKept } from '../data/draft-storage'
import { useUnsavedListIds } from '../hooks/use-list-draft'
import { WidgetKindIcon } from '../components/shared/icons'
import {
  isWorkspaceDragType,
  isWorkspacePanelDragData,
  isWorkspaceTabDragData,
  runDrop,
  tabsCount,
  WorkspaceDragContext,
  type WorkspaceDragState,
} from '../components/workspace/workspace-drag'
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
import { EntityActionHost } from '../components/settings/EntityActionHost'
import { CheckinDialog } from '../components/checkin/CheckinDialog'
import { CheckinImportDialog } from '../components/checkin/CheckinImportDialog'
import { TaskDialog } from '../components/overlays/TaskDialog'
import { ReviewDeck } from '../components/overlays/ReviewDeck'
import { DragOverlayTask } from '../components/workspace/DragOverlayTask'
import { createTaskDropAnimation } from '../components/workspace/task-drop-animation'
import { TaskDropLandingContext } from '../components/task/dnd/task-drop-landing'
import styles from './WorkspacePage.module.css'

/**
 * A sensor that never starts a drag (it has no activators): phones use it
 * in place of the pointer sensor, since drags are off there. Swapping
 * sensors rather than passing none keeps the list the same length — dnd-kit
 * uses it as an effect's dependency array, which must not change size.
 */
class NoDragSensor implements SensorInstance {
  static activators = []
  autoScrollEnabled = false
}

/** Offset of a tab / panel ghost from the pointer (px). */
const GHOST_OFFSET = { x: 12, y: 10 }

/**
 * A tab or panel ghost follows the pointer at +12 / +10 px; where it would
 * leave the window at the bottom (right) it goes above (left of) the pointer.
 */
const followPointer: Modifier = ({ activatorEvent, draggingNodeRect, overlayNodeRect, transform, active }) => {
  if (!isWorkspaceDragType(active?.data.current?.type) || !draggingNodeRect || !activatorEvent) return transform
  const e = activatorEvent as PointerEvent
  if (typeof e.clientX !== 'number') return transform
  const pointerX = e.clientX + transform.x
  const pointerY = e.clientY + transform.y
  const w = overlayNodeRect?.width ?? 0
  const h = overlayNodeRect?.height ?? 0
  const flipX = pointerX + GHOST_OFFSET.x + w > window.innerWidth
  const flipY = pointerY + GHOST_OFFSET.y + h > window.innerHeight
  return {
    ...transform,
    x: transform.x + (e.clientX - draggingNodeRect.left) + (flipX ? -GHOST_OFFSET.x - w : GHOST_OFFSET.x),
    y: transform.y + (e.clientY - draggingNodeRect.top) + (flipY ? -GHOST_OFFSET.y - h : GHOST_OFFSET.y),
  }
}

/**
 * Loads everything the workspace's widgets read, whatever route the app was
 * opened on: all tasks, people, tags, statuses, lists, status updates — and the people / tag assignments of the
 * loaded tasks, so chips and person / tag groups render on a cold load. It
 * doesn't subscribe to the tasks themselves, so a task edit doesn't re-render
 * the page.
 */
function useWorkspaceData(): void {
  useEffect(() => {
    void useTodoStore.getState().loadAll()
    void usePersonStore.getState().ensureLoaded()
    void useTagStore.getState().ensureLoaded()
    void useStatusStore.getState().ensureLoaded()
    void useListDefinitionStore.getState().ensureLoaded()
    void useStatusUpdateStore.getState().ensureLoaded()
    void useSubtaskStore.getState().ensureLoaded()
  }, [])
  useEntityAssignmentsForLoadedTodos()
  useClearSelectionOnOutsideClick()
}

/**
 * Tab and panel drags: measures the workspace when one starts, follows the
 * pointer to find the drop target, and applies the move on drop.
 */
function useWorkspaceDragState() {
  const [drag, setDragState] = useState<WorkspaceDragState | null>(null)
  // Source of truth for handlers (the state copy drives rendering).
  const dragRef = useRef<WorkspaceDragState | null>(null)
  const setDrag = useCallback((next: WorkspaceDragState | null) => {
    dragRef.current = next
    setDragState(next)
  }, [])

  const update = useCallback((x: number, y: number) => {
    const current = dragRef.current
    const layout = useWorkspaceStore.getState().working
    if (!current || !layout) return
    const geo = current.geometry
    const hit = hitTestWorkspace(geo, { x, y })
    const target = hit ? dropTargetForHit(layout, geo, hit, current.source) : null
    const ghost = target ? dropGhost(layout, geo, current.source, target, current.tabs.map((t) => t.id)) : null
    const accepts = ghost != null
    let insertLeft: number | null = null
    if (hit?.kind === 'tab-strip') {
      const panel = geometryCells(geo).find((c) => c.id === hit.cellId)
      if (panel?.header) insertLeft = hit.lineX - panel.header.left
    }
    const sameGhost = JSON.stringify(ghost) === JSON.stringify(current.ghost)
    if (sameDropHit(hit, current.hit) && sameGhost && insertLeft === current.insertLeft) return
    setDrag({ ...current, hit, target, accepts, ghost, insertLeft })
  }, [setDrag])

  const active = drag != null
  useEffect(() => {
    if (!active) return
    let pointer: { x: number; y: number } | null = null
    const onMove = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY }
      update(e.clientX, e.clientY)
    }
    // The columns (or a column) scrolling under the drag — dnd-kit's
    // auto-scroll at an edge — move every cell: measured again, once a
    // frame, and the pointer hit-tested against the new places (cr31 W3).
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const current = dragRef.current
        const area = document.querySelector<HTMLElement>('[data-ws-area]')
        if (!current || !area) return
        dragRef.current = { ...current, geometry: measureWorkspace(area) }
        if (pointer) update(pointer.x, pointer.y)
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('scroll', onScroll, true)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [active, update])

  const start = useCallback((event: DragStartEvent): boolean => {
    const data = event.active.data.current
    const tab = isWorkspaceTabDragData(data) ? data : null
    const panel = isWorkspacePanelDragData(data) ? data : null
    if (!tab && !panel) return false
    const area = document.querySelector<HTMLElement>('[data-ws-area]')
    if (!area) return true
    setDrag({
      source: tab ? { type: 'tab', tabId: tab.tabId } : { type: 'panel', panelId: panel?.panelId ?? '' },
      tabs: tab ? [{ id: tab.tabId, kind: tab.kind, title: tab.title }] : panel?.tabs ?? [],
      hit: null,
      target: null,
      accepts: false,
      ghost: null,
      insertLeft: null,
      geometry: measureWorkspace(area),
    })
    return true
  }, [setDrag])

  const end = useCallback((commit: boolean) => {
    const current = dragRef.current
    setDrag(null)
    if (commit && current?.target && current.accepts) {
      const ws = useWorkspaceStore.getState()
      if (current.source.type === 'tab') ws.moveTab(current.source.tabId, current.target)
      else ws.movePanel(current.source.panelId, current.target)
    }
  }, [setDrag])

  return { drag, start, end }
}

/** A whole panel being dragged: a small card with its tabs (the first raised), placeholder lines and an `N tabs` badge. */
function PanelGhost({ tabs }: { tabs: WorkspaceDragState['tabs'] }) {
  return (
    <div className={styles.panelGhost} data-testid="ws-panel-ghost">
      <div className={styles.panelGhostHeader}>
        {tabs.map((t, i) => (
          <span key={t.id} className={`${styles.panelGhostTab} ${i === 0 ? styles.panelGhostTabFirst : ''}`}>
            <span className={styles.ghostIcon}><WidgetKindIcon kind={t.kind} size={11} /></span>
            <span className={styles.ghostTitle}>{t.title}</span>
          </span>
        ))}
      </div>
      <div className={styles.panelGhostBody} aria-hidden="true">
        <span className={styles.panelGhostLine} />
        <span className={styles.panelGhostLine} />
        <span className={styles.panelGhostLine} />
      </div>
      <span className={styles.panelGhostBadge}>{tabsCount(tabs.length)}</span>
    </div>
  )
}

/**
 * Blocks in-app navigation away from unsaved list edits until the user
 * answers (layouts are saved at once: nothing about them is asked).
 * Closing or reloading the tab loses nothing: the unsaved list edits are
 * kept in the browser and come back unsaved (`data/draft-storage`), so the
 * browser's generic "leave site?" prompt is asked only when they couldn't
 * be kept (storage full or blocked).
 */
function UnsavedNavigationGuard() {
  const unsavedLists = useUnsavedListIds()
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) =>
        getUnsavedListIds().length > 0 && currentLocation.pathname !== nextLocation.pathname,
      [],
    ),
  )

  const unsaved = unsavedLists.length > 0
  useEffect(() => {
    if (!unsaved) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (unsavedDraftsKept()) return
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
  const [activeDrag, setActiveDrag] = useState<ActiveTaskDrag | null>(null)
  /**
   * The last drag was a task row's (the lifted overlay): its drop animates
   * (D25 E4). Kept past the drop — the animation runs after it — and set at
   * the next drag's start; tab, panel and calendar-entry ghosts just go.
   */
  const [liftedDrag, setLiftedDrag] = useState(false)
  const [taskDrop] = useState(createTaskDropAnimation)
  const landDrop = taskDrop.land
  const calendarChoice = useCalendarDropChoice()
  const autoScroll = useAutoScrollUnderPointer()
  const tabDrag = useWorkspaceDragState()
  const isMobile = useIsMobile()

  useWorkspaceData()

  // Opened from here, not at startup: the app's startup chain (incl. the sync
  // file load) has finished before any page mounts.
  useEffect(() => {
    if (!useWorkspaceStore.getState().hydrated) void useWorkspaceStore.getState().init()
    // Unsaved list edits kept from before a reload.
    void useListDraftStore.getState().restore()
  }, [])

  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } })
  const noDragSensor = useSensor(NoDragSensor)
  const sensors = useSensors(isMobile ? noDragSensor : pointerSensor)

  // Tab and panel drags find their target from pointer geometry, not dnd-kit
  // droppables; task drags match the widgets' droppables (calendar days,
  // Eisenhower quadrants) under the pointer.
  const collisionDetection = useMemo(() => buildTaskCollision([
    { when: (active) => isWorkspaceDragType(active.data.current?.type), accept: () => false },
  ]), [])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    landDrop('settle')
    if (tabDrag.start(event)) {
      setLiftedDrag(false)
      return
    }
    const data = event.active.data.current
    const todo = data?.todo as PersistedTodoItem | undefined
    const calendarEntry = isCalendarEntryDragData(data) ? data.calendarEntry : undefined
    setLiftedDrag(todo != null && !calendarEntry)
    if (todo) setActiveDrag({ todo, calendarEntry })
  }, [tabDrag, landDrop])

  const chooseType = calendarChoice.choose
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    if (isWorkspaceDragType(event.active.data.current?.type)) {
      tabDrag.end(true)
      return
    }
    setActiveDrag(null)
    // A calendar day or an Eisenhower pane: the row changes there, later.
    if (event.over) landDrop('in-place')
    await dispatchTaskDrop(event, {
      calendar: {
        reschedule: async (todoId, date, type) => {
          const t = useTodoStore.getState().todos.find((x) => x.id === todoId)
          if (!t) return
          await useTodoStore.getState().update(todoId, buildRescheduleUpdate(t, date, type))
        },
        chooseType,
      },
      eisenhower: {
        tasksFor: dragTasks,
        panes: currentPanes,
        context: () => currentPaneContext(startOfToday()),
        apply: applyPaneDrop,
      },
    })
  }, [tabDrag, chooseType, landDrop])

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
      onDragEnd={(e) => { void runDrop(() => handleDragEnd(e)) }}
      onDragCancel={handleDragCancel}
    >
      <WorkspaceDragContext.Provider value={drag}>
        <PendingCalendarDropContext.Provider value={calendarChoice.pending}>
          <TaskDropLandingContext.Provider value={landDrop}>
            <div className={styles.page} data-dragging-tab={drag ? 'true' : undefined}>
              {working
                ? (isMobile ? <MobileWorkspaceView layout={working} status={<SyncStatusButton />} /> : <WorkspaceView layout={working} />)
                : hydrated ? null : <div className={styles.loading}>Loading…</div>}
            </div>
          </TaskDropLandingContext.Provider>
        </PendingCalendarDropContext.Provider>
      </WorkspaceDragContext.Provider>

      <DragOverlay dropAnimation={liftedDrag ? taskDrop.animation : null} modifiers={[followPointer]}>
        {drag ? (
          <div className={styles.ghostWrap}>
            {drag.source.type === 'panel' ? <PanelGhost tabs={drag.tabs} /> : (
              <div className={styles.ghost} data-testid="ws-drag-ghost">
                <span className={styles.ghostIcon}>{drag.tabs[0] && <WidgetKindIcon kind={drag.tabs[0].kind} size={12} />}</span>
                <span className={styles.ghostTitle}>{drag.tabs[0]?.title}</span>
              </div>
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
          <DragOverlayTask todo={activeDrag.todo} />
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

      <TaskDialog />
      <ReviewDeck />
      <CheckinDialog />
      <CheckinImportDialog />
      <TaskEditPopupHost />
      <EntityActionHost />
      <EditListHost />
      <NumberEditorHost />
      <ChartEditorHost />
      <PulseEditorHost />
      <UnsavedNavigationGuard />
    </DndContext>
  )
}
