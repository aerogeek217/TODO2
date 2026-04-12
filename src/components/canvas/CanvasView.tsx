import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import {
  ReactFlow,
  Background,
  Panel,
  MiniMap,
  applyNodeChanges,
  useViewport,
  type Node,
  type NodeChange,
  type NodeTypes,
  type ReactFlowInstance,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ProjectNode, type ProjectNodeData } from './ProjectNode'
import { ListInsetNode, type ListInsetNodeData } from './ListInsetNode'
import { StickyNoteNode, type StickyNoteNodeData } from './StickyNoteNode'
import { findAlignmentsScoped, findResizeSnap, type AlignmentLine, type ScopedRect } from './alignment'
import type { Project, PersistedTodoItem, Person, Tag, Org, ListInset, StickyNote } from '../../models'
import { useUIStore, type CanvasViewport } from '../../stores/ui-store'
import { useSettingsStore } from '../../stores/settings-store'
import { CanvasContextMenu, type ContextMenuItem } from '../overlays/CanvasContextMenu'
import styles from './CanvasView.module.css'
import './drag-preview.css'

function AlignmentGuides({ lines }: { lines: AlignmentLine[] }) {
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
}

const INSET_PREFIX = 'inset-'
const NOTE_PREFIX = 'note-'

const nodeTypes: NodeTypes = {
  project: ProjectNode as unknown as NodeTypes[string],
  listInset: ListInsetNode as unknown as NodeTypes[string],
  stickyNote: StickyNoteNode as unknown as NodeTypes[string],
}

export interface ProjectHandlers {
  onAddTask: (projectId: number, title: string) => void
  onInsertTask?: (title: string, projectId: number, beforeTodoId: number | null, parentId: number | undefined) => Promise<number>
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
  onAddListInset?: (preset: string, x: number, y: number) => void
  onResizeInset?: (id: number, width: number, height: number) => void
}

export interface StickyHandlers {
  onAddStickyNote?: (x: number, y: number) => void
  onDeleteNote?: (id: number) => void
  onUpdateNoteText?: (id: number, text: string) => void
  onUpdateNoteTitle?: (id: number, title: string) => void
  onUpdateNoteColor?: (id: number, color: string | undefined) => void
  onNoteDragStop?: (id: number, x: number, y: number) => void
  onResizeNote?: (id: number, width: number, height: number) => void
  onConvertNoteLines?: (lines: string[]) => Promise<void>
}

interface CanvasViewProps {
  projects: Project[]
  todosByProject: Map<number, PersistedTodoItem[]>
  assignedPeopleMap: Map<number, Person[]>
  assignedTagsMap?: Map<number, Tag[]>
  assignedOrgsMap?: Map<number, Org[]>
  ghostTodoIds?: Set<number>
  onNodeDragStop: (projectId: number, x: number, y: number) => void
  onReactFlowInit?: (instance: ReactFlowInstance) => void
  onOpenDetail?: (todoId: number) => void
  projectHandlers: ProjectHandlers
  listInsets?: ListInset[]
  allTodos?: PersistedTodoItem[]
  insetHandlers: InsetHandlers
  stickyNotes?: StickyNote[]
  stickyHandlers: StickyHandlers
  allPeople?: Person[]
  allTags?: Tag[]
}

export function CanvasView({
  projects,
  todosByProject,
  assignedPeopleMap,
  assignedTagsMap,
  assignedOrgsMap,
  ghostTodoIds,
  onNodeDragStop,
  onReactFlowInit,
  onOpenDetail,
  projectHandlers,
  listInsets,
  allTodos,
  insetHandlers,
  stickyNotes,
  stickyHandlers,
  allPeople,
  allTags,
}: CanvasViewProps) {
  const { onAddTask, onInsertTask, onDeleteProject, onRenameProject, onToggleCollapse, onResizeProject, onSetProjectColor, onAddProject } = projectHandlers
  const { onDeleteInset, onToggleCollapseInset, onInsetDragStop, onAddListInset, onResizeInset } = insetHandlers
  const { onAddStickyNote, onDeleteNote, onUpdateNoteText, onUpdateNoteTitle, onUpdateNoteColor, onNoteDragStop, onResizeNote, onConvertNoteLines } = stickyHandlers
  const isNavOpen = useUIStore((s) => s.isProjectNavigatorOpen)
  const isMinimapOpen = useUIStore((s) => s.isMinimapOpen)
  // Track which nodes are currently being dragged by React Flow
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
  // Preserve final positions of just-dropped nodes until the store catches up
  const droppedPositions = useRef(new Map<string, { x: number; y: number }>())
  // Ref for bring-to-front callback (assigned after setNodes is available)
  const bringToFrontRef = useRef<(nodeId: string) => void>(() => {})
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null)
  const [alignmentLines, setAlignmentLines] = useState<AlignmentLine[]>([])
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

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

  const resizeSnapRef = useRef<(projectId: number, newWidth: number) => { width: number; lines: AlignmentLine[] }>(() => ({ width: 0, lines: [] }))

  const handleResizeSnap = useCallback((projectId: number, newWidth: number) => {
    return resizeSnapRef.current(projectId, newWidth)
  }, [])

  // Build nodes from props data (recomputes when data changes)
  const dataNodes: Node[] = useMemo(() => {
    const projectNodes: Node[] = projects.map((project) => {
      const node: Node = {
        id: String(project.id),
        type: 'project',
        position: { x: project.positionX, y: project.positionY },
        data: {
          project,
          todos: todosByProject.get(project.id!) ?? [],
          assignedPeopleMap,
          assignedTagsMap,
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
          onBringToFront: () => bringToFrontRef.current(String(project.id)),
        } satisfies ProjectNodeData,
      }
      return node
    })

    const insetNodes: Node[] = (listInsets ?? []).map((inset) => ({
      id: `${INSET_PREFIX}${inset.id}`,
      type: 'listInset',
      position: { x: inset.x, y: inset.y },
      data: {
        inset,
        allTodos: allTodos ?? [],
        assignedPeopleMap,
        assignedTagsMap,
        assignedOrgsMap,
        onDelete: onDeleteInset ?? (() => {}),
        onToggleCollapse: onToggleCollapseInset ?? (() => {}),
        onOpenDetail,
        onResize: onResizeInset,
      } satisfies ListInsetNodeData,
    }))

    const noteNodes: Node[] = (stickyNotes ?? []).map((note) => ({
      id: `${NOTE_PREFIX}${note.id}`,
      type: 'stickyNote',
      position: { x: note.x, y: note.y },
      zIndex: 10,
      data: {
        note,
        onDelete: onDeleteNote ?? (() => {}),
        onUpdateText: onUpdateNoteText ?? (() => {}),
        onUpdateTitle: onUpdateNoteTitle ?? (() => {}),
        onUpdateColor: onUpdateNoteColor ?? (() => {}),
        onResize: onResizeNote,
        onConvertLines: onConvertNoteLines,
        people: allPeople,
        tags: allTags,
        projects,
      } satisfies StickyNoteNodeData,
    }))

    return [...projectNodes, ...insetNodes, ...noteNodes]
  }, [
    projects, todosByProject, assignedPeopleMap, assignedTagsMap, assignedOrgsMap, ghostTodoIds,
    onAddTask, onInsertTask, onDeleteProject, onRenameProject, onToggleCollapse, onOpenDetail,
    onResizeProject, onSetProjectColor, handleResizeSnap,
    listInsets, allTodos, onDeleteInset, onToggleCollapseInset, onResizeInset,
    stickyNotes, onDeleteNote, onUpdateNoteText, onUpdateNoteTitle, onUpdateNoteColor, onResizeNote, onConvertNoteLines,
    allPeople, allTags,
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
      for (const node of current) {
        const entry: { position?: { x: number; y: number }; selected?: boolean; zIndex?: number } = {}
        if (draggingIds.current.has(node.id)) entry.position = node.position
        // Preserve just-dropped positions until the store catches up
        const dropped = droppedPositions.current.get(node.id)
        if (dropped) {
          const dataNode = dataNodes.find(n => n.id === node.id)
          if (dataNode && Math.abs(dataNode.position.x - dropped.x) < 1 && Math.abs(dataNode.position.y - dropped.y) < 1) {
            // Store has caught up — stop preserving
            droppedPositions.current.delete(node.id)
          } else {
            entry.position = dropped
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
  resizeSnapRef.current = (projectId: number, newWidth: number) => {
    const allNodes = nodes
    const dragNodeId = String(projectId)
    const dragNode = allNodes.find(n => n.id === dragNodeId)
    if (!dragNode) return { width: newWidth, lines: [] as AlignmentLine[] }

    const dragRect = getNodeAbsoluteRect(dragNode, allNodes, false)
    if (!dragRect) return { width: newWidth, lines: [] as AlignmentLine[] }

    const otherRects: ScopedRect[] = []
    for (const n of allNodes) {
      if (n.id === dragNodeId) continue
      const rect = getNodeAbsoluteRect(n, allNodes, false)
      if (rect) otherRects.push(rect)
    }

    return findResizeSnap(dragRect, newWidth, otherRects)
  }

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      let hasActiveDrag = false

      // Track dragging state and persist on drag end
      for (const change of changes) {
        if (change.type === 'position') {
          if (change.dragging) {
            draggingIds.current.add(change.id)
            hasActiveDrag = true
          } else {
            draggingIds.current.delete(change.id)
            if (change.position) {
              // Remember final position so the sync effect preserves it until the store updates
              droppedPositions.current.set(change.id, { ...change.position })
              const id = change.id
              if (id.startsWith(INSET_PREFIX)) {
                onInsetDragStop?.(Number(id.slice(INSET_PREFIX.length)), change.position.x, change.position.y)
              } else if (id.startsWith(NOTE_PREFIX)) {
                onNoteDragStop?.(Number(id.slice(NOTE_PREFIX.length)), change.position.x, change.position.y)
              } else {
                onNodeDragStop(Number(id), change.position.x, change.position.y)
              }
            }
          }
        }
      }

      // Apply snapping during drag
      setNodes(nds => {
        const updated = applyNodeChanges(changes, nds)

        if (!hasActiveDrag || draggingIds.current.size > 1) {
          if (draggingIds.current.size === 0) setAlignmentLines([])
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
        setAlignmentLines(snap.lines)

        // Apply snapped position
        if (snap.x !== dragRect.x || snap.y !== dragRect.y) {
          return updated.map(n =>
            n.id === dragId ? { ...n, position: { x: snap.x, y: snap.y } } : n
          )
        }

        return updated
      })
    },
    [onNodeDragStop, getNodeAbsoluteRect]
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
    if (onAddProject && rfInstanceRef.current) {
      const pos = rfInstanceRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      items.push({ label: 'New Project', action: () => onAddProject(pos.x, pos.y) })
    }
    if (onAddStickyNote && rfInstanceRef.current) {
      const pos = rfInstanceRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      items.push({ label: 'New Sticky Note', action: () => onAddStickyNote(pos.x, pos.y) })
    }
    if (onAddListInset && rfInstanceRef.current) {
      const pos = rfInstanceRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      items.push({ separator: true, label: '', action: () => {} })
      items.push({ label: 'List: Due This Week', action: () => onAddListInset('due-this-week', pos.x, pos.y) })
      items.push({ label: 'List: Follow Up', action: () => onAddListInset('starred', pos.x, pos.y) })
      items.push({ label: 'List: High Priority', action: () => onAddListInset('high-priority', pos.x, pos.y) })
    }
    if (items.length > 0) {
      setContextMenu({ x: e.clientX, y: e.clientY, items })
    }
  }, [onAddProject, onAddStickyNote, onAddListInset])

  return (
    <div className={styles.canvasWrapper} onContextMenu={handleContextMenu}>
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
        <Panel position="bottom-left" className={styles.mapPanel}>
          <div className={styles.mapToolbar}>
            <button
              className={styles.mapToolbarButton}
              onClick={() => rfInstanceRef.current?.zoomIn({ duration: 200 })}
              title="Zoom in"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="8" y1="3" x2="8" y2="13" />
                <line x1="3" y1="8" x2="13" y2="8" />
              </svg>
            </button>
            <button
              className={styles.mapToolbarButton}
              onClick={() => rfInstanceRef.current?.zoomOut({ duration: 200 })}
              title="Zoom out"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="8" x2="13" y2="8" />
              </svg>
            </button>
            <button
              className={styles.mapToolbarButton}
              onClick={() => rfInstanceRef.current?.fitView({ padding: 0.15, duration: 300 })}
              title="Fit to view (Ctrl+0)"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2,6 2,2 6,2" />
                <polyline points="10,2 14,2 14,6" />
                <polyline points="14,10 14,14 10,14" />
                <polyline points="6,14 2,14 2,10" />
              </svg>
            </button>
            <button
              className={`${styles.mapToolbarButton} ${isNavOpen ? styles.mapToolbarButtonActive : ''}`}
              onClick={() => useUIStore.getState().toggleProjectNavigator()}
              title="Project navigator (P)"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="3" y1="4" x2="13" y2="4" />
                <line x1="3" y1="8" x2="13" y2="8" />
                <line x1="3" y1="12" x2="13" y2="12" />
              </svg>
            </button>
            <button
              className={styles.mapToolbarButton}
              onClick={() => useUIStore.getState().toggleMinimap()}
              title={isMinimapOpen ? 'Hide minimap' : 'Show minimap'}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                {isMinimapOpen ? (
                  <polyline points="4,6 8,10 12,6" />
                ) : (
                  <polyline points="4,10 8,6 12,10" />
                )}
              </svg>
            </button>
          </div>
          {isMinimapOpen && (
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) => {
                if (node.type === 'stickyNote') return (node.data as { note?: { color?: string } })?.note?.color || 'var(--color-surface-bright, #2a2a2a)'
                if (node.type === 'project') return (node.data as { project?: { color?: string } })?.project?.color || 'var(--color-surface-bright, #2a2a2a)'
                return 'var(--color-accent-bg-subtle, #1a3a3a)'
              }}
            />
          )}
        </Panel>
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

    </div>
  )
}
