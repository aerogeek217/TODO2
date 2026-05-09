import { memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, useRef, type ComponentType, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import {
  ReactFlow,
  Background,
  applyNodeChanges,
  useViewport,
  type CoordinateExtent,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useDndMonitor, useDroppable } from '@dnd-kit/core'
import { ProjectNode, type ProjectNodeData } from './ProjectNode'
import { ListInsetNode, type ListInsetNodeData } from './ListInsetNode'
import { FloatingNoteNode, type FloatingNoteNodeData } from './FloatingNoteNode'
import { FloatingCalendarNode, type FloatingCalendarNodeData } from './FloatingCalendarNode'
import { TaskboardNode, type TaskboardNodeData } from './TaskboardNode'
import { FloatingHorizonsNode, type FloatingHorizonsNodeData } from './FloatingHorizonsNode'
import { FloatingStatusNode, type FloatingStatusNodeData } from './FloatingStatusNode'
import { FloatingScoreboardNode, type FloatingScoreboardNodeData } from './FloatingScoreboardNode'
import { FloatingSnoozeGraveyardNode, type FloatingSnoozeGraveyardNodeData } from './FloatingSnoozeGraveyardNode'
import { DragInsertContext } from './DragInsertContext'
import { findResizeSnap, type AlignmentLine, type ScopedRect } from '../../utils/canvas/alignment'
import type { Project, PersistedTodoItem, Person, Org, ListInset, FloatingCalendar, FloatingNote, FloatingTaskboard, FloatingHorizons, FloatingStatus, FloatingScoreboard, FloatingSnoozeGraveyard, Taskboard } from '../../models'
import { useUIStore, type CanvasViewport, type FloatDragKind } from '../../stores/ui-store'
import { useSettingsStore } from '../../stores/settings-store'
import { encodeRailsDropId, RAILS_DRAG_KIND, RAILS_DRAG_TYPE, type FloatDockTarget, type RailsDragData } from '../../utils/rail-dnd'
import { deriveCanvasMinZoom } from '../../utils/canvas-bounds'
import { DEFAULT_FLOAT_HEIGHT, DEFAULT_FLOAT_WIDTH } from '../../constants'
import { REACT_FLOW_NODE_CLASS } from '../../utils/react-flow-dom'
import { useFloatDragLifecycle } from '../../hooks/use-float-drag-lifecycle'
import { useCascadeShifts } from '../../hooks/use-cascade-shifts'
import { CanvasContextMenu } from '../overlays/CanvasContextMenu'
import type { ContextMenuItem } from '../../models/context-menu'
import { CanvasToolbar } from './CanvasToolbar'
import styles from './CanvasView.module.css'
import './drag-preview.css'

const AlignmentGuides = memo(function AlignmentGuides({ lines }: { lines: AlignmentLine[] }) {
  const { x, y, zoom } = useViewport()
  if (lines.length === 0) return null

  return (
    <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 'var(--z-canvas-draw)', overflow: 'visible' } as React.CSSProperties}>
      {lines.map((line, i) => {
        if (line.orientation === 'vertical') {
          return (
            <line key={i}
              x1={line.position * zoom + x} y1={line.start * zoom + y}
              x2={line.position * zoom + x} y2={line.end * zoom + y}
              stroke="var(--color-accent)" strokeWidth={1} strokeDasharray="4 2" />
          )
        } else {
          return (
            <line key={i}
              x1={line.start * zoom + x} y1={line.position * zoom + y}
              x2={line.end * zoom + x} y2={line.position * zoom + y}
              stroke="var(--color-accent)" strokeWidth={1} strokeDasharray="4 2" />
          )
        }
      })}
    </svg>
  )
})

/**
 * Visualizes the canvas extent (`settings.canvasMaxExtent`): the in-bounds
 * area is left at default canvas styling, the out-of-bounds area is dimmed,
 * and the band edge is outlined. Single SVG child of `<ReactFlow>` reading
 * the live viewport via `useViewport()` so pan / zoom keeps the overlay
 * aligned with the flow coordinate system.
 *
 * The dim is drawn as a single `path` whose subpath-1 covers an arbitrarily
 * huge rect and subpath-2 traces the in-bounds rect; `fill-rule="evenodd"`
 * fills only the symmetric difference (i.e. only the area outside the band).
 * Outer dimensions are bounded by the SVG viewport, so the literal magnitude
 * doesn't matter as long as it's larger than any conceivable wrapper size.
 */
const BoundsOverlay = memo(function BoundsOverlay({ maxExtent }: { maxExtent: number }) {
  const { x, y, zoom } = useViewport()
  const left = -maxExtent * zoom + x
  const top = -maxExtent * zoom + y
  const right = maxExtent * zoom + x
  const bottom = maxExtent * zoom + y
  const w = right - left
  const h = bottom - top
  const HUGE = 1e6
  return (
    <svg
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible', zIndex: 0 } as React.CSSProperties}
      aria-hidden="true"
    >
      <path
        d={`M${-HUGE} ${-HUGE} L${HUGE} ${-HUGE} L${HUGE} ${HUGE} L${-HUGE} ${HUGE} Z M${left} ${top} L${right} ${top} L${right} ${bottom} L${left} ${bottom} Z`}
        fill="var(--color-canvas-bounds-out)"
        fillRule="evenodd"
      />
      <rect
        x={left}
        y={top}
        width={w}
        height={h}
        fill="none"
        stroke="var(--color-canvas-bounds-edge)"
        strokeWidth={1}
        strokeDasharray="6 4"
      />
    </svg>
  )
})

// React Flow node id prefixes for the floating widget kinds live in
// `services/float-kind-registry.ts`. Adding a new widget kind: append an entry
// there + define the matching floating-* store + dispatch handler.
const INSET_PREFIX = 'inset-'
const NOTE_PREFIX = 'note-'
const CALENDAR_PREFIX = 'calendar-'
const TASKBOARD_PREFIX = 'taskboard-'
const HORIZONS_PREFIX = 'horizons-'
const STATUS_PREFIX = 'status-'
const SCOREBOARD_PREFIX = 'scoreboard-'
const SNOOZE_GRAVEYARD_PREFIX = 'snooze-graveyard-'

/** Stable no-op used as a fallback for optional callback props so that omitted
 *  handlers don't produce a fresh function reference each render. */
const NOOP = () => {}

/**
 * Shallow-equal two objects. Returns true iff they have the same keys with
 * reference-equal values. Used to stabilize node `data` references so that
 * React.memo on canvas nodes short-circuits when nothing relevant changed.
 */
function shallowEqualObject<T extends object>(a: T, b: T): boolean {
  if (a === b) return true
  const aKeys = Object.keys(a) as Array<keyof T>
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false
    if (a[key] !== b[key]) return false
  }
  return true
}

// React Flow's `NodeTypes[string]` is `ComponentType<NodeProps & { data: any; type: any }>`,
// but each of our node components types its `data` to a specific shape (e.g. `ProjectNodeData`).
// Containing the cast here lets the `nodeTypes` object below register components by their
// real prop signatures instead of a per-row `as unknown as NodeTypes[string]` double-cast.
function asNodeType<TData>(
  C: ComponentType<NodeProps & { data: TData }>,
): NodeTypes[string] {
  return C as NodeTypes[string]
}

const nodeTypes: NodeTypes = {
  project: asNodeType(ProjectNode),
  listInset: asNodeType(ListInsetNode),
  floatingNote: asNodeType(FloatingNoteNode),
  floatingCalendar: asNodeType(FloatingCalendarNode),
  taskboard: asNodeType(TaskboardNode),
  floatingHorizons: asNodeType(FloatingHorizonsNode),
  floatingStatus: asNodeType(FloatingStatusNode),
  floatingScoreboard: asNodeType(FloatingScoreboardNode),
  floatingSnoozeGraveyard: asNodeType(FloatingSnoozeGraveyardNode),
}

export interface ProjectHandlers {
  onAddTask: (projectId: number, title: string) => void
  onInsertTask?: (title: string, projectId: number, beforeTodoId: number | null) => Promise<number>
  onDeleteProject: (projectId: number) => void
  onRenameProject: (projectId: number, name: string) => void
  onToggleCollapse: (projectId: number) => void
  onResizeProject?: (projectId: number, width: number) => void
  onSetProjectColor?: (projectId: number, color: string | undefined) => void
  onAddProject?: (x: number, y: number) => void
}

export interface InsetHandlers {
  onDeleteInset?: (id: number) => void
  onToggleCollapseInset?: (id: number) => void
  onInsetDragStop?: (id: number, x: number, y: number) => void
  /** Opens the widget-kind picker (notes / calendar / list / taskboard). `screenX`/`screenY` anchor the menu; `flowX`/`flowY` are the canvas-space coords where the widget will be placed. */
  onRequestAddWidget?: (screenX: number, screenY: number, flowX: number, flowY: number) => void
  onResizeInset?: (id: number, width: number, height: number) => void
}

export interface NoteHandlers {
  onDeleteNote?: (id: number) => void
  onNoteDragStop?: (id: number, x: number, y: number) => void
  onResizeNote?: (id: number, width: number, height: number) => void
}

export interface FloatingCalendarHandlers {
  onDeleteCalendar?: (id: number) => void
  onCalendarDragStop?: (id: number, x: number, y: number) => void
  onResizeCalendar?: (id: number, width: number, height: number) => void
}

interface CanvasViewProps {
  projects: Project[]
  todosByProject: Map<number, PersistedTodoItem[]>
  assignedPeopleMap: Map<number, Person[]>
  assignedOrgsMap?: Map<number, Org[]>
  personOrgMap?: Map<number, number[]>
  ghostTodoIds?: Set<number>
  onNodeDragStop: (projectId: number, x: number, y: number) => void
  onReactFlowInit?: (instance: ReactFlowInstance) => void
  onOpenDetail?: (todoId: number) => void
  projectHandlers: ProjectHandlers
  listInsets?: ListInset[]
  allTodos?: PersistedTodoItem[]
  insetHandlers: InsetHandlers
  floatingNotes?: FloatingNote[]
  noteHandlers: NoteHandlers
  floatingCalendars?: FloatingCalendar[]
  floatingCalendarHandlers?: FloatingCalendarHandlers
  allPeople?: Person[]
  allOrgs?: Org[]
  floatingTaskboards?: FloatingTaskboard[]
  taskboard?: Taskboard | null
  onTaskboardDragStop?: (id: number, x: number, y: number) => void
  onToggleTaskboardCollapse?: (id: number) => void
  onCloseTaskboard?: (id: number) => void
  onResizeTaskboard?: (id: number, width: number, height: number) => void
  floatingHorizons?: FloatingHorizons[]
  onHorizonsDragStop?: (id: number, x: number, y: number) => void
  onCloseHorizons?: (id: number) => void
  onResizeHorizons?: (id: number, width: number, height: number) => void
  floatingStatus?: FloatingStatus[]
  onStatusDragStop?: (id: number, x: number, y: number) => void
  onCloseStatus?: (id: number) => void
  onResizeStatus?: (id: number, width: number, height: number) => void
  floatingScoreboard?: FloatingScoreboard[]
  onScoreboardDragStop?: (id: number, x: number, y: number) => void
  onCloseScoreboard?: (id: number) => void
  onResizeScoreboard?: (id: number, width: number, height: number) => void
  floatingSnoozeGraveyard?: FloatingSnoozeGraveyard[]
  onSnoozeGraveyardDragStop?: (id: number, x: number, y: number) => void
  onCloseSnoozeGraveyard?: (id: number) => void
  onResizeSnoozeGraveyard?: (id: number, width: number, height: number) => void
  onCascadeShift?: (shifts: Array<{ projectId: number; x: number; y: number }>) => void
  showCompleted?: boolean
  showHiddenStatuses?: boolean
  /**
   * Float-dock dispatch (Phase 2 of float-dock). Invoked when a floating
   * widget (note/calendar/inset/taskboard) is released over a rail drop zone.
   * When present and a drop-zone is resolved, the usual position-persist path
   * is suppressed — the callback is the sole effect of the release. When
   * absent or when the pointer misses every rail hotspot, the float persists
   * its new position as before. Phase 3 wires this from CanvasPage to the
   * `canvas-rails-store` dock reducers.
   */
  onFloatDock?: (
    descriptor: { kind: FloatDragKind; floatId: number },
    target: FloatDockTarget,
  ) => void
}

export function CanvasView({
  projects,
  todosByProject,
  assignedPeopleMap,
  assignedOrgsMap,
  personOrgMap,
  ghostTodoIds,
  onNodeDragStop,
  onReactFlowInit,
  onOpenDetail,
  projectHandlers,
  listInsets,
  allTodos,
  insetHandlers,
  floatingNotes,
  noteHandlers,
  floatingCalendars,
  floatingCalendarHandlers,
  allPeople,
  allOrgs,
  floatingTaskboards,
  taskboard,
  onTaskboardDragStop,
  onToggleTaskboardCollapse,
  onCloseTaskboard,
  onResizeTaskboard,
  floatingHorizons,
  onHorizonsDragStop,
  onCloseHorizons,
  onResizeHorizons,
  floatingStatus,
  onStatusDragStop,
  onCloseStatus,
  onResizeStatus,
  floatingScoreboard,
  onScoreboardDragStop,
  onCloseScoreboard,
  onResizeScoreboard,
  floatingSnoozeGraveyard,
  onSnoozeGraveyardDragStop,
  onCloseSnoozeGraveyard,
  onResizeSnoozeGraveyard,
  onCascadeShift,
  showCompleted,
  showHiddenStatuses,
  onFloatDock,
}: CanvasViewProps) {
  const { onAddTask, onInsertTask, onDeleteProject, onRenameProject, onToggleCollapse, onResizeProject, onSetProjectColor, onAddProject } = projectHandlers
  const { onDeleteInset, onToggleCollapseInset, onInsetDragStop, onRequestAddWidget, onResizeInset } = insetHandlers
  const { onDeleteNote, onNoteDragStop, onResizeNote } = noteHandlers
  const { onDeleteCalendar, onCalendarDragStop, onResizeCalendar } = floatingCalendarHandlers ?? {}
  const { activeDragTodoId } = useContext(DragInsertContext)
  void activeDragTodoId
  const themeMode = useSettingsStore((s) => s.themeMode)
  // Suppress RF auto-pan while a float widget is being dragged. The float-dock
  // gesture pulls the widget toward a rail (out of the canvas), so RF's
  // `autoPanOnNodeDrag` panning the viewport behind the cursor is anti-pattern
  // here — it accumulates large drifts over the ~700 ms of post-rail-edge
  // dwell. Project-node drags keep auto-pan (this stays true when no float is
  // in flight).
  const isFloatDragging = useUIStore((s) => s.floatDrag !== null)
  // Derive React Flow's minZoom from the configured canvas extent so fitView
  // can always cover a fully-saturated band. Recomputes whenever the user
  // changes the extent in SettingsPage.
  const canvasMaxExtent = useSettingsStore((s) => s.canvasMaxExtent)
  const minZoom = useMemo(() => deriveCanvasMinZoom(canvasMaxExtent), [canvasMaxExtent])
  // Constrain node drag to the same band the persist layer clamps to. Without
  // this, a drag visually leaves the band; the persist clamp re-snaps on
  // commit but only after the 2-second drop-cache TTL expires (the cache
  // holds the un-clamped pointer position to suppress mid-drag prop-sync
  // jitter). Setting `nodeExtent` lets React Flow constrain the gesture
  // itself, so visual + persisted positions stay in sync.
  const nodeExtent = useMemo<CoordinateExtent>(
    () => [[-canvasMaxExtent, -canvasMaxExtent], [canvasMaxExtent, canvasMaxExtent]],
    [canvasMaxExtent],
  )
  const [canvasDotColor, setCanvasDotColor] = useState(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-canvas-dot').trim() || '#3a3a3a'
  )
  useEffect(() => {
    const update = () => {
      const val = getComputedStyle(document.documentElement).getPropertyValue('--color-canvas-dot').trim()
      if (val) setCanvasDotColor(val)
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [themeMode])

  // Drag-id tracking + drop-position cache + float-dock pointer lifecycle owned
  // by `useFloatDragLifecycle`. `useCascadeShifts` owns prevHeights / cascade
  // debounce / alignment-snap. `handleNodesChange` is a thin sequencer that
  // calls both. Decomposed in code-review-2026-04-25 P5.
  const { draggingIds, droppedPositions, processBatch: processFloatDragBatch } = useFloatDragLifecycle({
    onFloatDock,
    onTaskboardDragStop,
    onInsetDragStop,
    onNoteDragStop,
    onCalendarDragStop,
    onHorizonsDragStop,
    onStatusDragStop,
    onScoreboardDragStop,
    onSnoozeGraveyardDragStop,
    onNodeDragStop,
  })
  const { detectAndCacheDimChanges, processSetNodesUpdate, persistCascadeShifts } = useCascadeShifts()

  // Ref for bring-to-front callback (assigned after setNodes is available)
  const bringToFrontRef = useRef<(nodeId: string) => void>(() => {})
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null)
  const [alignmentLines, setAlignmentLines] = useState<AlignmentLine[]>([])
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

  // Phase 5 float-dock (reverse): register a single full-viewport droppable
  // covering the React Flow area so a rail tab-pill drag released over the
  // canvas resolves to `zone.kind === 'canvas'` in `useRailsDragMonitor`. The
  // droppable node is `pointer-events: none` so React Flow keeps its normal
  // pointer capture — dnd-kit's geometry-based collision detection uses the
  // element's bounding rect, not DOM hit-testing. Rail hotspots (DockOverlay
  // strips, slot bodies, tab strips) render on top of this zone geometrically
  // via smaller / edge-anchored rects, so `pointerWithin` naturally prefers
  // them; `rails:canvas` fires only when the release misses every rail zone.
  const canvasDropId = encodeRailsDropId({ kind: 'canvas' })
  const canvasDroppable = useDroppable({ id: canvasDropId, data: { type: RAILS_DRAG_TYPE } })
  const [tabDragActive, setTabDragActive] = useState(false)
  // Pointer position during a tab-pill drag, used to render the projected
  // landing-rect overlay (T2). Tracked via a window-level listener gated on
  // `tabDragActive` because dnd-kit doesn't surface a stream of pointer coords
  // mid-drag; the listener attaches at drag-start and detaches at drag-end.
  const [tabDragPointer, setTabDragPointer] = useState<{ x: number; y: number } | null>(null)
  useDndMonitor({
    onDragStart: ({ active }) => {
      const data = active.data.current as RailsDragData | undefined
      setTabDragActive(data?.type === RAILS_DRAG_TYPE && data.kind === RAILS_DRAG_KIND.tab)
    },
    onDragEnd: () => { setTabDragActive(false); setTabDragPointer(null) },
    onDragCancel: () => { setTabDragActive(false); setTabDragPointer(null) },
  })
  useEffect(() => {
    if (!tabDragActive) return
    const onMove = (e: PointerEvent) => {
      setTabDragPointer({ x: e.clientX, y: e.clientY })
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [tabDragActive])
  const canvasDropActive = tabDragActive && canvasDroppable.isOver
  // Project landing rect: `pointerToFlowPosition` centres the widget on the
  // pointer in flow coords. In screen coords (where the overlay lives) that
  // collapses to `pointer - DEFAULT_FLOAT_*/2` regardless of viewport zoom —
  // the overlay's job is to communicate the landing position, not to preview
  // the post-drop visual size at the current zoom.
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  let popOutOverlayStyle: CSSProperties | null = null
  if (canvasDropActive && tabDragPointer && wrapperRef.current) {
    const rect = wrapperRef.current.getBoundingClientRect()
    const x = tabDragPointer.x - rect.left - DEFAULT_FLOAT_WIDTH / 2
    const y = tabDragPointer.y - rect.top - DEFAULT_FLOAT_HEIGHT / 2
    popOutOverlayStyle = {
      transform: `translate(${x}px, ${y}px)`,
      width: DEFAULT_FLOAT_WIDTH,
      height: DEFAULT_FLOAT_HEIGHT,
    }
  }

  /** Get absolute rect for a node. Uses React Flow's positionAbsolute for non-dragging
   *  nodes (ground truth); falls back to manual parent offset for dragging nodes whose
   *  internal position may lag behind the local state. */
  const getNodeAbsoluteRect = useCallback((node: Node, _allNodes: Node[], isDragging: boolean): ScopedRect | null => {
    const internal = rfInstanceRef.current?.getInternalNode(node.id)
    const w = internal?.measured?.width ?? 280
    const h = internal?.measured?.height ?? 200
    const nodeId = node.id

    // For non-dragging nodes, trust React Flow's computed absolute position
    if (!isDragging && internal?.internals?.positionAbsolute) {
      return { x: internal.internals.positionAbsolute.x, y: internal.internals.positionAbsolute.y, width: w, height: h, nodeId }
    }

    return { x: node.position.x, y: node.position.y, width: w, height: h, nodeId }
  }, [])

  const resizeSnapRef = useRef<(nodeId: string, newWidth: number) => { width: number; lines: AlignmentLine[] }>(() => ({ width: 0, lines: [] }))

  const handleResizeSnap = useCallback((projectId: number, newWidth: number) => {
    return resizeSnapRef.current(String(projectId), newWidth)
  }, [])

  const handleResizeSnapByNodeId = useCallback((nodeId: string, newWidth: number) => {
    return resizeSnapRef.current(nodeId, newWidth)
  }, [])

  // Per-node data reference cache. When a node's newly-built data object is
  // shallow-equal to its prior build, we reuse the prior reference so React.memo
  // on ProjectNode/ListInsetNode/FloatingNoteNode/TaskboardNode can short-circuit.
  // Without this, any single-project change (new `todosByProject` Map reference)
  // produces fresh `data` objects for *every* node, forcing all nodes to re-render.
  // Cache stores `unknown` because each id maps to a kind-specific data shape; the
  // shape is recovered inside `stabilize<T>` from the call-site's typed argument.
  const nodeDataCacheRef = useRef(new Map<string, unknown>())

  // Stable per-project onBringToFront functions so the closure doesn't produce a
  // new reference every render (which would defeat the data cache).
  const bringToFrontFnsRef = useRef(new Map<string, () => void>())
  const getBringToFrontFn = useCallback((id: string) => {
    const cache = bringToFrontFnsRef.current
    let fn = cache.get(id)
    if (!fn) {
      fn = () => bringToFrontRef.current(id)
      cache.set(id, fn)
    }
    return fn
  }, [])

  // Build nodes from props data (recomputes when data changes)
  const dataNodes: Node[] = useMemo(() => {
    const prevCache = nodeDataCacheRef.current
    const nextCache = new Map<string, unknown>()
    const stabilize = <T extends object>(id: string, data: T): T => {
      const prior = prevCache.get(id) as T | undefined
      const stable = (prior && shallowEqualObject(prior, data) ? prior : data)
      nextCache.set(id, stable)
      return stable
    }

    const projectNodes: Node[] = projects.map((project) => {
      const id = String(project.id)
      const data: ProjectNodeData = {
        project,
        todos: todosByProject.get(project.id!) ?? [],
        assignedPeopleMap,
        ghostTodoIds,
        onAddTask,
        onInsertTask,
        onDeleteProject,
        onRenameProject,
        onToggleCollapse,
        onOpenDetail,
        onResizeProject,
        onResizeSnap: handleResizeSnap,
        onSetAlignmentLines: setAlignmentLines,
        onSetColor: onSetProjectColor,
        onBringToFront: getBringToFrontFn(id),
      }
      return {
        id,
        type: 'project',
        position: { x: project.positionX, y: project.positionY },
        data: stabilize(id, data),
      }
    })

    const insetNodes: Node[] = (listInsets ?? []).map((inset) => {
      const id = `${INSET_PREFIX}${inset.id}`
      const data: ListInsetNodeData = {
        inset,
        allTodos: allTodos ?? [],
        assignedPeopleMap,
        assignedOrgsMap,
        personOrgMap,
        onDelete: onDeleteInset ?? NOOP,
        onToggleCollapse: onToggleCollapseInset ?? NOOP,
        onOpenDetail,
        onResize: onResizeInset,
        onResizeSnap: handleResizeSnapByNodeId,
        onSetAlignmentLines: setAlignmentLines,
      }
      return {
        id,
        type: 'listInset',
        position: { x: inset.x, y: inset.y },
        data: stabilize(id, data),
      }
    })

    const noteNodes: Node[] = (floatingNotes ?? []).map((note) => {
      const id = `${NOTE_PREFIX}${note.id}`
      const data: FloatingNoteNodeData = {
        note,
        onDelete: onDeleteNote ?? NOOP,
        onResize: onResizeNote,
      }
      return {
        id,
        type: 'floatingNote',
        position: { x: note.x, y: note.y },
        zIndex: 10,
        data: stabilize(id, data),
      }
    })

    const calendarNodes: Node[] = (floatingCalendars ?? []).map((cal) => {
      const id = `${CALENDAR_PREFIX}${cal.id}`
      const data: FloatingCalendarNodeData = {
        calendar: cal,
        onDelete: onDeleteCalendar ?? NOOP,
        onResize: onResizeCalendar,
      }
      return {
        id,
        type: 'floatingCalendar',
        position: { x: cal.x, y: cal.y },
        zIndex: 10,
        data: stabilize(id, data),
      }
    })

    const tbNodes: Node[] = (floatingTaskboards ?? []).map((ft) => {
      const id = `${TASKBOARD_PREFIX}${ft.id}`
      const entries = taskboard?.entries ?? []
      const data: TaskboardNodeData = {
        floatingId: ft.id!,
        entries,
        allTodos: allTodos ?? [],
        assignedPeopleMap,
        ghostTodoIds,
        showCompleted,
        showHiddenStatuses,
        onOpenDetail,
        isCollapsed: ft.collapsed ?? false,
        onToggleCollapse: onToggleTaskboardCollapse ? () => onToggleTaskboardCollapse(ft.id!) : NOOP,
        onClose: onCloseTaskboard ? () => onCloseTaskboard(ft.id!) : NOOP,
        width: ft.width,
        height: ft.height,
        onResize: onResizeTaskboard ? (w, h) => onResizeTaskboard(ft.id!, w, h) : undefined,
      }
      return {
        id,
        type: 'taskboard',
        position: { x: ft.x, y: ft.y },
        data: stabilize(id, data),
      }
    })

    const horizonsNodes: Node[] = (floatingHorizons ?? []).map((fh) => {
      const id = `${HORIZONS_PREFIX}${fh.id}`
      const data: FloatingHorizonsNodeData = {
        horizons: fh,
        onDelete: onCloseHorizons ?? NOOP,
        onResize: onResizeHorizons,
      }
      return {
        id,
        type: 'floatingHorizons',
        position: { x: fh.x, y: fh.y },
        zIndex: 10,
        data: stabilize(id, data),
      }
    })

    const statusNodes: Node[] = (floatingStatus ?? []).map((fs) => {
      const id = `${STATUS_PREFIX}${fs.id}`
      const data: FloatingStatusNodeData = {
        status: fs,
        onDelete: onCloseStatus ?? NOOP,
        onResize: onResizeStatus,
      }
      return {
        id,
        type: 'floatingStatus',
        position: { x: fs.x, y: fs.y },
        zIndex: 10,
        data: stabilize(id, data),
      }
    })

    const scoreboardNodes: Node[] = (floatingScoreboard ?? []).map((sb) => {
      const id = `${SCOREBOARD_PREFIX}${sb.id}`
      const data: FloatingScoreboardNodeData = {
        scoreboard: sb,
        onDelete: onCloseScoreboard ?? NOOP,
        onResize: onResizeScoreboard,
      }
      return {
        id,
        type: 'floatingScoreboard',
        position: { x: sb.x, y: sb.y },
        zIndex: 10,
        data: stabilize(id, data),
      }
    })

    const graveyardNodes: Node[] = (floatingSnoozeGraveyard ?? []).map((sg) => {
      const id = `${SNOOZE_GRAVEYARD_PREFIX}${sg.id}`
      const data: FloatingSnoozeGraveyardNodeData = {
        graveyard: sg,
        onDelete: onCloseSnoozeGraveyard ?? NOOP,
        onResize: onResizeSnoozeGraveyard,
      }
      return {
        id,
        type: 'floatingSnoozeGraveyard',
        position: { x: sg.x, y: sg.y },
        zIndex: 10,
        data: stabilize(id, data),
      }
    })

    nodeDataCacheRef.current = nextCache
    return [...projectNodes, ...insetNodes, ...noteNodes, ...calendarNodes, ...tbNodes, ...horizonsNodes, ...statusNodes, ...scoreboardNodes, ...graveyardNodes]
  }, [
    projects, todosByProject, assignedPeopleMap, assignedOrgsMap, ghostTodoIds,
    onAddTask, onInsertTask, onDeleteProject, onRenameProject, onToggleCollapse, onOpenDetail,
    onResizeProject, onSetProjectColor, handleResizeSnap, getBringToFrontFn,
    listInsets, allTodos, personOrgMap, onDeleteInset, onToggleCollapseInset, onResizeInset, handleResizeSnapByNodeId,
    floatingNotes, onDeleteNote, onResizeNote,
    floatingCalendars, onDeleteCalendar, onResizeCalendar,
    allPeople, allOrgs,
    floatingTaskboards, taskboard, onToggleTaskboardCollapse, onCloseTaskboard, onResizeTaskboard,
    floatingHorizons, onCloseHorizons, onResizeHorizons,
    floatingStatus, onCloseStatus, onResizeStatus,
    floatingScoreboard, onCloseScoreboard, onResizeScoreboard,
    floatingSnoozeGraveyard, onCloseSnoozeGraveyard, onResizeSnoozeGraveyard,
    showCompleted, showHiddenStatuses,
  ])

  // Local node state — React Flow controlled mode.
  // This preserves drag positions across re-renders caused by dnd-kit or other state changes.
  const [nodes, setNodes] = useState<Node[]>(dataNodes)

  useLayoutEffect(() => {
    bringToFrontRef.current = (nodeId: string) => {
      setNodes(nds => nds.map(n => ({
        ...n,
        zIndex: n.id === nodeId ? 1000 : 0
      })))
    }
  })

  // Sync data changes from props into local state, preserving positions, selection, and z-order of nodes mid-drag
  useEffect(() => {
    setNodes(current => {
      // Build map of local state to preserve (drag positions, selection, z-index)
      const preserve = new Map<string, { position?: { x: number; y: number }; selected?: boolean; zIndex?: number }>()
      const DROPPED_POSITION_TTL_MS = 2000
      const now = performance.now()
      for (const node of current) {
        const entry: { position?: { x: number; y: number }; selected?: boolean; zIndex?: number } = {}
        if (draggingIds.current.has(node.id)) entry.position = node.position
        // Preserve just-dropped positions until the store catches up
        const dropped = droppedPositions.current.get(node.id)
        if (dropped) {
          const dataNode = dataNodes.find(n => n.id === node.id)
          const isStale = now - dropped.setAt > DROPPED_POSITION_TTL_MS
          if (dataNode && Math.abs(dataNode.position.x - dropped.x) < 1 && Math.abs(dataNode.position.y - dropped.y) < 1) {
            // Store has caught up — stop preserving
            droppedPositions.current.delete(node.id)
          } else if (isStale) {
            // Override has been held past TTL — rounding or an upstream overwrite prevented
            // convergence, so release it rather than wedge the node at the stale coords.
            droppedPositions.current.delete(node.id)
          } else {
            entry.position = { x: dropped.x, y: dropped.y }
          }
        }
        if (node.selected) entry.selected = true
        if (node.zIndex) entry.zIndex = node.zIndex
        if (entry.position || entry.selected || entry.zIndex) preserve.set(node.id, entry)
      }
      if (preserve.size === 0) return dataNodes
      return dataNodes.map(node => {
        const p = preserve.get(node.id)
        if (!p) return node
        return { ...node, ...(p.position ? { position: p.position } : {}), ...(p.selected ? { selected: true } : {}), ...(p.zIndex ? { zIndex: p.zIndex } : {}) }
      })
    })
  }, [dataNodes])

  // Keep resize snap ref current so ProjectNode always gets latest node positions
  resizeSnapRef.current = (nodeId: string, newWidth: number) => {
    const allNodes = nodes
    const dragNode = allNodes.find(n => n.id === nodeId)
    if (!dragNode) return { width: newWidth, lines: [] as AlignmentLine[] }

    const dragRect = getNodeAbsoluteRect(dragNode, allNodes, false)
    if (!dragRect) return { width: newWidth, lines: [] as AlignmentLine[] }

    const otherRects: ScopedRect[] = []
    for (const n of allNodes) {
      if (n.id === nodeId) continue
      const rect = getNodeAbsoluteRect(n, allNodes, false)
      if (rect) otherRects.push(rect)
    }

    return findResizeSnap(dragRect, newWidth, otherRects)
  }

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Step 1: drag lifecycle side effects (drag-id tracking, float-dock
      // hit-test, position-persist callbacks, ui-store publish, pointer
      // listener attach/detach). Returns `hasActiveDrag` for the cascade
      // step's branching.
      const { hasActiveDrag } = processFloatDragBatch(changes)

      // Step 2: dimension-change detection for cascade shifting. Reads BEFORE
      // updating the prevHeights cache, then updates the cache. Returns the
      // delta list for the setNodes pass.
      const dimChanges = detectAndCacheDimChanges(changes, draggingIds.current.size)

      // Step 3: setNodes — applies the React Flow change batch, then either
      // snap-aligns a single-node drag or emits cascade shifts when idle.
      // The cascade hook returns alignment lines + cascade persist payload
      // so the post-setNodes calls below stay pure-side-effect free.
      let newAlignmentLines: AlignmentLine[] | null = null
      let cascadePersist: Array<{ nodeId: string; x: number; y: number }> = []
      setNodes((nds) => {
        const updated = applyNodeChanges(changes, nds)
        const result = processSetNodesUpdate(
          nds,
          updated,
          hasActiveDrag,
          draggingIds.current,
          dimChanges,
          getNodeAbsoluteRect,
          rfInstanceRef,
        )
        newAlignmentLines = result.alignmentLines
        cascadePersist = result.cascadePersist
        return result.nextNodes
      })

      // Step 4: post-setNodes (kept out of the updater per React purity).
      if (newAlignmentLines !== null) setAlignmentLines(newAlignmentLines)
      persistCascadeShifts(cascadePersist, droppedPositions, onCascadeShift)
    },
    [processFloatDragBatch, detectAndCacheDimChanges, processSetNodesUpdate, persistCascadeShifts, draggingIds, droppedPositions, getNodeAbsoluteRect, onCascadeShift],
  )

  const handleInit = useCallback((instance: ReactFlowInstance) => {
    rfInstanceRef.current = instance
    onReactFlowInit?.(instance)
  }, [onReactFlowInit])



  const savedViewport = useSettingsStore((s) => s.canvasViewport)
  const handleViewportChange = useCallback((vp: CanvasViewport) => {
    useSettingsStore.getState().setCanvasViewport(vp)
  }, [])

  const handleContextMenu = useCallback((e: ReactMouseEvent) => {
    // Only handle right-click on the canvas background (not on nodes)
    const target = e.target as HTMLElement
    if (target.closest(`.${REACT_FLOW_NODE_CLASS}`) || target.closest('.react-flow__controls')) return
    if (!target.closest('.react-flow')) return
    e.preventDefault()

    const items: ContextMenuItem[] = []
    const pos = rfInstanceRef.current?.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    if (onAddProject && pos) {
      items.push({ label: 'New Project', action: () => onAddProject(pos.x, pos.y) })
    }
    if (onRequestAddWidget && pos) {
      items.push({ separator: true, label: '', action: () => {} })
      items.push({ label: 'Add widget…', action: () => onRequestAddWidget(e.clientX, e.clientY, pos.x, pos.y) })
    }
    if (items.length > 0) {
      setContextMenu({ x: e.clientX, y: e.clientY, items })
    }
  }, [onAddProject, onRequestAddWidget])

  return (
    <div
      ref={wrapperRef}
      className={styles.canvasWrapper}
      onContextMenu={handleContextMenu}
      data-canvas-drop-active={canvasDropActive ? 'true' : undefined}
    >
      <div
        ref={canvasDroppable.setNodeRef}
        className={styles.canvasDropZone}
        data-rails-drop-id={canvasDropId}
        aria-hidden="true"
      />
      {popOutOverlayStyle && (
        <div
          className={styles.popOutIndicator}
          style={popOutOverlayStyle}
          aria-hidden="true"
        />
      )}
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onInit={handleInit}
        fitView={false}
        defaultViewport={savedViewport ?? { x: 50, y: 50, zoom: 1 }}
        onViewportChange={handleViewportChange}
        minZoom={minZoom}
        maxZoom={2}
        nodeExtent={nodeExtent}

        panOnDrag={[1]}
        panOnScroll
        panOnScrollSpeed={1}
        selectionOnDrag
        zoomOnDoubleClick={false}
        onPaneClick={() => useUIStore.getState().clearSelection()}
        proOptions={{ hideAttribution: true }}
        autoPanOnNodeDrag={!isFloatDragging}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.5}
          color={canvasDotColor}
        />
        <BoundsOverlay maxExtent={canvasMaxExtent} />
        <AlignmentGuides lines={alignmentLines} />
      </ReactFlow>

      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      <CanvasToolbar />
    </div>
  )
}
