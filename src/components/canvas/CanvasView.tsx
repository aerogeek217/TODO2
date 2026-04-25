import { memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  ReactFlow,
  Background,
  applyNodeChanges,
  useViewport,
  type Node,
  type NodeChange,
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
import { DragInsertContext } from './DragInsertContext'
import { findAlignmentsScoped, findResizeSnap, type AlignmentLine, type ScopedRect } from './alignment'
import { computeCascadeShifts, CASCADE_GAP_THRESHOLD, type HeightDelta } from './cascade-shift'
import type { Project, PersistedTodoItem, Person, Org, ListInset, FloatingCalendar, FloatingNote, FloatingTaskboard, FloatingHorizons, Taskboard } from '../../models'
import { useUIStore, type CanvasViewport, type FloatDragKind } from '../../stores/ui-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useCanvasRailsStore } from '../../stores/canvas-rails-store'
import { encodeRailsDropId, RAILS_DRAG_TYPE, resolveFloatDockTarget, type FloatDockTarget, type RailsDragData } from '../../utils/rail-dnd'
import { floatKindForNodeId, isFloatNodeId } from '../../utils/float-kind-registry'
import type { RailSide } from '../../models/canvas-rails'
import { CanvasContextMenu, type ContextMenuItem } from '../overlays/CanvasContextMenu'
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

// React Flow node id prefixes for the five floating widget kinds live in
// `utils/float-kind-registry.ts`. Adding a sixth widget kind: append an entry
// there + define the matching floating-* store + dispatch handler.
const INSET_PREFIX = 'inset-'
const NOTE_PREFIX = 'note-'
const CALENDAR_PREFIX = 'calendar-'
const TASKBOARD_PREFIX = 'taskboard-'
const HORIZONS_PREFIX = 'horizons-'

/** Stable no-op used as a fallback for optional callback props so that omitted
 *  handlers don't produce a fresh function reference each render. */
const NOOP = () => {}

/**
 * Shallow-equal two objects. Returns true iff they have the same keys with
 * reference-equal values. Used to stabilize node `data` references so that
 * React.memo on canvas nodes short-circuits when nothing relevant changed.
 */
function shallowEqualObject(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (a === b) return true
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false
    if (a[key] !== b[key]) return false
  }
  return true
}

const nodeTypes: NodeTypes = {
  project: ProjectNode as unknown as NodeTypes[string],
  listInset: ListInsetNode as unknown as NodeTypes[string],
  floatingNote: FloatingNoteNode as unknown as NodeTypes[string],
  floatingCalendar: FloatingCalendarNode as unknown as NodeTypes[string],
  taskboard: TaskboardNode as unknown as NodeTypes[string],
  floatingHorizons: FloatingHorizonsNode as unknown as NodeTypes[string],
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

  const draggingIds = useRef(new Set<string>())
  // Preserve final positions of just-dropped nodes until the store catches up.
  // `setAt` is a monotonic timestamp; the sync effect drops stale overrides after
  // DROPPED_POSITION_TTL_MS so rounding-induced near-misses can't wedge forever.
  const droppedPositions = useRef(new Map<string, { x: number; y: number; setAt: number }>())
  // Track measured heights for cascade shift detection
  const prevHeightsRef = useRef(new Map<string, number>())
  const cascadingRef = useRef(false)
  // Debounce cascade persistence to avoid store-update re-renders during InsertTrigger transitions
  const cascadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (cascadeTimerRef.current) clearTimeout(cascadeTimerRef.current) }, [])
  const pendingCascadeRef = useRef<Array<{ projectId: number; x: number; y: number }> | null>(null)
  // Ref for bring-to-front callback (assigned after setNodes is available)
  const bringToFrontRef = useRef<(nodeId: string) => void>(() => {})
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null)
  // Phase 2 float-dock: window-level pointer capture while a float is being
  // dragged, so `onNodesChange`'s release branch can hit-test rail drop zones.
  // `pointerRef` holds the last pointermove coords; `pointerCleanupRef` holds
  // the detach fn so we can tear down when the float drag ends (or the
  // component unmounts mid-drag).
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const pointerCleanupRef = useRef<(() => void) | null>(null)
  // Phase 4: session-scoped multi-drag tracker. Any frame with ≥2 concurrent
  // drags marks the session as multi so multi-select releases (which can
  // batch into a single `handleNodesChange` call) stay position-only — even
  // for the last release, whose post-delete `draggingIds.size` would be 1.
  // Reset once `draggingIds` empties at the end of a batch.
  const wasMultiDragRef = useRef(false)
  useEffect(() => () => {
    if (pointerCleanupRef.current) {
      pointerCleanupRef.current()
      pointerCleanupRef.current = null
    }
    // Clear any stale ui-store state an unmount-mid-drag would otherwise
    // leave stuck — DockOverlay reads `floatDrag` to decide visibility.
    useUIStore.getState().setFloatDrag(null)
    wasMultiDragRef.current = false
  }, [])
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
  useDndMonitor({
    onDragStart: ({ active }) => {
      const data = active.data.current as RailsDragData | undefined
      setTabDragActive(data?.type === RAILS_DRAG_TYPE && data.kind === 'tab')
    },
    onDragEnd: () => setTabDragActive(false),
    onDragCancel: () => setTabDragActive(false),
  })
  const canvasDropActive = tabDragActive && canvasDroppable.isOver

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
  const nodeDataCacheRef = useRef(new Map<string, Record<string, unknown>>())

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
    const nextCache = new Map<string, Record<string, unknown>>()
    const stabilize = <T extends Record<string, unknown>>(id: string, data: T): T => {
      const prior = prevCache.get(id)
      const stable = (prior && shallowEqualObject(prior, data) ? (prior as T) : data)
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
        data: stabilize(id, data as unknown as Record<string, unknown>),
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
        data: stabilize(id, data as unknown as Record<string, unknown>),
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
        data: stabilize(id, data as unknown as Record<string, unknown>),
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
        data: stabilize(id, data as unknown as Record<string, unknown>),
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
        data: stabilize(id, data as unknown as Record<string, unknown>),
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
        data: stabilize(id, data as unknown as Record<string, unknown>),
      }
    })

    nodeDataCacheRef.current = nextCache
    return [...projectNodes, ...insetNodes, ...noteNodes, ...calendarNodes, ...tbNodes, ...horizonsNodes]
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
      let hasActiveDrag = false
      // Phase 4 a11y: flip `true` when any release in this batch dispatches
      // the dock callback, so the normal detach branch below knows to leave
      // the freshly-set "Dropped in {zone}" announcement alone.
      let floatDockFired = false

      // Was any float being dragged before this batch of changes? Used to
      // decide whether to attach the Phase 2 float-dock pointer listener at
      // the leading edge of the drag, or detach at its trailing edge.
      let floatWasDragging = false
      for (const dragId of draggingIds.current) {
        if (floatKindForNodeId(dragId)) { floatWasDragging = true; break }
      }

      // Resolve rail orientation for a slot on release — walks current rails
      // state. Read `getState()` fresh per drop so changes during the drag
      // (e.g. another user of the store) stay consistent.
      const getSlotOrientation = (slotId: string): 'vertical' | 'horizontal' | null => {
        const rails = useCanvasRailsStore.getState().rails
        for (const side of ['left', 'right', 'top', 'bottom'] as RailSide[]) {
          const rail = rails[side]
          if (!rail) continue
          if (rail.slots.some((s) => s.id === slotId)) return rail.orientation
        }
        return null
      }

      // Track dragging state and persist on drag end
      for (const change of changes) {
        if (change.type === 'position') {
          if (change.dragging) {
            draggingIds.current.add(change.id)
            // If any frame ever has >1 concurrent drags, flag the session as
            // multi so no release in this batch (or the final one whose
            // post-delete `draggingIds.size === 0`) slips past the hit-test
            // gate.
            if (draggingIds.current.size > 1) wasMultiDragRef.current = true
            hasActiveDrag = true
          } else {
            draggingIds.current.delete(change.id)
            if (change.position) {
              const id = change.id
              const floatKind = floatKindForNodeId(id)

              // Phase 2/4 float-dock hit-test: when a float is released and
              // the pointer is over a rail drop zone, dispatch the dock
              // action and suppress the usual position persist (the float is
              // about to be replaced by a tab). Multi-drag stays
              // position-only via `wasMultiDragRef`; `draggingIds.size === 0`
              // keeps mid-batch releases from docking while sibling drags
              // are still in flight.
              if (
                floatKind &&
                onFloatDock &&
                pointerRef.current &&
                draggingIds.current.size === 0 &&
                !wasMultiDragRef.current
              ) {
                const target = resolveFloatDockTarget(pointerRef.current, { getSlotOrientation })
                if (target) {
                  onFloatDock({ kind: floatKind.kind, floatId: floatKind.floatId }, target)
                  // Release dispatched → CanvasPage's handler has already
                  // replaced the drag-start announcer with the dock-success
                  // string; flag it so detach doesn't wipe that. Clear
                  // `wasMultiDragRef` immediately so the next session starts
                  // clean even if subsequent batches don't reach the size-0
                  // reset block below.
                  floatDockFired = true
                  wasMultiDragRef.current = false
                  continue
                }
              }

              // Remember final position so the sync effect preserves it until the store updates
              droppedPositions.current.set(change.id, { ...change.position, setAt: performance.now() })
              if (floatKind) {
                const { x, y } = change.position
                switch (floatKind.kind) {
                  case 'taskboard': onTaskboardDragStop?.(floatKind.floatId, x, y); break
                  case 'lens':      onInsetDragStop?.(floatKind.floatId, x, y); break
                  case 'note':      onNoteDragStop?.(floatKind.floatId, x, y); break
                  case 'calendar':  onCalendarDragStop?.(floatKind.floatId, x, y); break
                  case 'horizons':  onHorizonsDragStop?.(floatKind.floatId, x, y); break
                }
              } else {
                onNodeDragStop(Number(id), change.position.x, change.position.y)
              }
            }
          }
        }
      }

      // Phase 1 float-dock: publish the currently-dragging float (if any) to
      // `ui-store` so the rail `DockOverlay` can render drop zones while a
      // float is in flight. `setFloatDrag` is idempotent on identical
      // kind+id so repeated position frames don't re-render downstream.
      const setFloatDrag = useUIStore.getState().setFloatDrag
      let floatDragNext: ReturnType<typeof floatKindForNodeId> = null
      for (const dragId of draggingIds.current) {
        const kinded = floatKindForNodeId(dragId)
        if (kinded) { floatDragNext = kinded; break }
      }
      setFloatDrag(floatDragNext ? { kind: floatDragNext.kind, id: floatDragNext.floatId } : null)

      // Phase 2 float-dock: toggle the window-level pointer listener around
      // the leading/trailing edges of a float drag. The listener stashes
      // client coords so `resolveFloatDockTarget` has a point to hit-test on
      // release. Rail/tab drags use dnd-kit's own pointer capture so this
      // listener is scoped strictly to React-Flow-driven float drags.
      const floatIsDragging = floatDragNext !== null
      if (!floatWasDragging && floatIsDragging && !pointerCleanupRef.current) {
        const onMove = (e: PointerEvent) => {
          pointerRef.current = { x: e.clientX, y: e.clientY }
        }
        // Phase 4 cancel-safety: if React Flow ever swallows the release
        // event (e.g., the dragged node unmounts, window blurs, pointer
        // cancel), our drag-end branch never runs. A microtask-deferred
        // cleanup riding on global pointerup/cancel/blur gives React Flow
        // the first chance to emit dragging:false normally; if it did,
        // `pointerCleanupRef.current` is already null by the time the
        // microtask fires and the forced cleanup is a no-op.
        let cleaned = false
        const detach = () => {
          if (cleaned) return
          cleaned = true
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUpOrCancel)
          window.removeEventListener('pointercancel', onUpOrCancel)
          window.removeEventListener('blur', onUpOrCancel)
          pointerRef.current = null
        }
        const onUpOrCancel = () => {
          queueMicrotask(() => {
            if (pointerCleanupRef.current !== detach) return
            detach()
            pointerCleanupRef.current = null
            useUIStore.getState().setFloatDrag(null)
            useUIStore.getState().setFloatAnnouncement('')
            wasMultiDragRef.current = false
          })
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUpOrCancel)
        window.addEventListener('pointercancel', onUpOrCancel)
        window.addEventListener('blur', onUpOrCancel)
        pointerCleanupRef.current = detach
        // Phase 4: reuse the rails-monitor announcer pattern for a11y.
        useUIStore.getState().setFloatAnnouncement(`Dragging ${floatDragNext!.entry.label}`)
      } else if (floatWasDragging && !floatIsDragging && pointerCleanupRef.current) {
        pointerCleanupRef.current()
        pointerCleanupRef.current = null
        // Non-dock drop → clear the stale "Dragging {kind}" announcement.
        // Dock drops leave CanvasPage's "Dropped in …" string in place.
        if (!floatDockFired) useUIStore.getState().setFloatAnnouncement('')
      }

      // Phase 4 multi-drag reset: clear the session flag once every drag has
      // ended. Placed after the listener teardown so any release in this
      // batch already saw the correct (pre-reset) value.
      if (draggingIds.current.size === 0) {
        wasMultiDragRef.current = false
      }

      // Detect project height changes for cascade shifting (read BEFORE updating prevHeightsRef)
      const dimChanges: HeightDelta[] = []
      if (!cascadingRef.current && draggingIds.current.size === 0) {
        for (const change of changes) {
          if (change.type === 'dimensions' && !change.resizing && change.dimensions) {
            const id = change.id
            if (isFloatNodeId(id)) continue
            const prevH = prevHeightsRef.current.get(id)
            const newH = change.dimensions.height
            if (prevH != null && Math.abs(newH - prevH) > 1) {
              dimChanges.push({ nodeId: id, previousHeight: prevH, currentHeight: newH })
            }
          }
        }
      }
      // Always update prevHeightsRef for all dimension changes
      for (const change of changes) {
        if (change.type === 'dimensions' && change.dimensions) {
          prevHeightsRef.current.set(change.id, change.dimensions.height)
        }
      }

      // Captured from the updater (runs synchronously for React 18 setState calls
      // outside transitions); applied after setNodes returns so the updater stays
      // side-effect free (React purity contract).
      // null = don't change alignment lines (preserves multi-drag behavior).
      let newAlignmentLines: AlignmentLine[] | null = null
      let cascadePersist: Array<{ nodeId: string; x: number; y: number }> = []

      // Apply snapping during drag, cascade shifts when idle
      setNodes(nds => {
        const updated = applyNodeChanges(changes, nds)

        if (!hasActiveDrag || draggingIds.current.size > 1) {
          if (draggingIds.current.size === 0) {
            newAlignmentLines = []

            // Cascade shift: when no drag is active and project heights changed
            if (dimChanges.length > 0) {
              const allRects: ScopedRect[] = []
              const projectIds = new Set<string>()
              for (const n of updated) {
                const internal = rfInstanceRef.current?.getInternalNode(n.id)
                allRects.push({
                  nodeId: n.id,
                  x: n.position.x,
                  y: n.position.y,
                  width: internal?.measured?.width ?? 280,
                  height: internal?.measured?.height ?? 200,
                })
                if (!isFloatNodeId(n.id)) {
                  projectIds.add(n.id)
                }
              }

              const shifts = computeCascadeShifts(dimChanges, allRects, CASCADE_GAP_THRESHOLD, projectIds)
              if (shifts.length > 0) {
                cascadingRef.current = true
                const shiftMap = new Map(shifts.map(s => [s.nodeId, s.newY]))

                cascadePersist = shifts.map(s => {
                  const node = updated.find(n => n.id === s.nodeId)
                  return node
                    ? { nodeId: s.nodeId, x: node.position.x, y: s.newY }
                    : { nodeId: s.nodeId, x: 0, y: s.newY }
                }).filter(s => {
                  const node = updated.find(n => n.id === s.nodeId)
                  return node != null
                })

                return updated.map(n => {
                  const newY = shiftMap.get(n.id)
                  return newY != null ? { ...n, position: { ...n.position, y: newY } } : n
                })
              }
            }
          }
          return updated
        }

        // Find the node being dragged and compute snap (single-node only)
        const dragId = [...draggingIds.current][0]
        const dragNode = updated.find(n => n.id === dragId)
        if (!dragNode) return updated

        const dragRect = getNodeAbsoluteRect(dragNode, updated, true)
        if (!dragRect) return updated

        // Collect rects of all other non-dragging nodes (same coordinate space: absolute)
        const otherRects: ScopedRect[] = []
        for (const n of updated) {
          if (draggingIds.current.has(n.id)) continue
          const rect = getNodeAbsoluteRect(n, updated, false)
          if (rect) otherRects.push(rect)
        }

        const snap = findAlignmentsScoped(dragRect, otherRects)
        newAlignmentLines = snap.lines

        // Apply snapped position
        if (snap.x !== dragRect.x || snap.y !== dragRect.y) {
          return updated.map(n =>
            n.id === dragId ? { ...n, position: { x: snap.x, y: snap.y } } : n
          )
        }

        return updated
      })

      // Apply alignment lines after setNodes — keeps the updater pure (no
      // setState calls from inside a state updater).
      if (newAlignmentLines !== null) {
        setAlignmentLines(newAlignmentLines)
      }

      // Persist cascade shifts: apply droppedPositions immediately (visual),
      // but debounce the store update to avoid re-render chains that steal input focus.
      if (cascadePersist.length > 0) {
        for (const { nodeId, x, y } of cascadePersist) {
          droppedPositions.current.set(nodeId, { x, y, setAt: performance.now() })
        }
        // Debounce store persistence — if another cascade fires within 300ms
        // (e.g. InsertTrigger opening then closing), only the final positions are written.
        pendingCascadeRef.current = cascadePersist.map(s => ({
          projectId: Number(s.nodeId), x: s.x, y: s.y,
        }))
        if (cascadeTimerRef.current) clearTimeout(cascadeTimerRef.current)
        cascadeTimerRef.current = setTimeout(() => {
          const pending = pendingCascadeRef.current
          if (pending && pending.length > 0) {
            onCascadeShift?.(pending)
          }
          pendingCascadeRef.current = null
          cascadeTimerRef.current = null
          // Release cascade guard only after the debounced persistence runs — keeps
          // dimension-change cascade detection suppressed for the whole 300ms window
          // so in-flight height changes don't trigger a second cascade mid-debounce.
          queueMicrotask(() => { cascadingRef.current = false })
        }, 300)
      }
    },
    [onNodeDragStop, onTaskboardDragStop, onInsetDragStop, onNoteDragStop, onCalendarDragStop, getNodeAbsoluteRect, onCascadeShift, onFloatDock]
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
    if (target.closest('.react-flow__node') || target.closest('.react-flow__controls')) return
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
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onInit={handleInit}
        fitView={false}
        defaultViewport={savedViewport ?? { x: 50, y: 50, zoom: 1 }}
        onViewportChange={handleViewportChange}
        minZoom={0.2}
        maxZoom={2}

        panOnDrag={[1]}
        panOnScroll
        panOnScrollSpeed={1}
        selectionOnDrag
        zoomOnDoubleClick={false}
        onPaneClick={() => useUIStore.getState().clearSelection()}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.5}
          color={canvasDotColor}
        />
        <AlignmentGuides lines={alignmentLines} />
      </ReactFlow>

      {contextMenu && createPortal(
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />,
        document.body,
      )}

    </div>
  )
}
