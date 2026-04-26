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
import { findResizeSnap, type AlignmentLine, type ScopedRect } from './alignment'
import type { Project, PersistedTodoItem, Person, Org, ListInset, FloatingCalendar, FloatingNote, FloatingTaskboard, FloatingHorizons, Taskboard } from '../../models'
import { useUIStore, type CanvasViewport, type FloatDragKind } from '../../stores/ui-store'
import { useSettingsStore } from '../../stores/settings-store'
import { encodeRailsDropId, RAILS_DRAG_TYPE, type FloatDockTarget, type RailsDragData } from '../../utils/rail-dnd'
import { REACT_FLOW_NODE_CLASS } from '../../utils/react-flow-dom'
import { useFloatDragLifecycle } from '../../hooks/use-float-drag-lifecycle'
import { useCascadeShifts } from '../../hooks/use-cascade-shifts'
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
  // Suppress RF auto-pan while a float widget is being dragged. The float-dock
  // gesture pulls the widget toward a rail (out of the canvas), so RF's
  // `autoPanOnNodeDrag` panning the viewport behind the cursor is anti-pattern
  // here — it accumulates large drifts over the ~700 ms of post-rail-edge
  // dwell. Project-node drags keep auto-pan (this stays true when no float is
  // in flight).
  const isFloatDragging = useUIStore((s) => s.floatDrag !== null)
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
        autoPanOnNodeDrag={!isFloatDragging}
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
