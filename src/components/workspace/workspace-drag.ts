import { createContext, useContext } from 'react'
import type { WidgetKind } from '../../models/workspace-layout'
import type { LayoutDropTarget } from '../../utils/workspace-layout-ops'
import type { WorkspaceDragSource, WorkspaceDropHit, WorkspaceGeometry } from '../../utils/workspace-drop'

/** `active.data.current.type` of a dragged workspace tab. */
export const WORKSPACE_TAB_DRAG = 'workspace-tab'
/** `active.data.current.type` of a whole panel (cell or band) dragged by its header. */
export const WORKSPACE_PANEL_DRAG = 'workspace-panel'

/** dnd-kit draggable id of a workspace tab. */
export function workspaceTabDragId(tabId: string): string {
  return `ws-tab:${tabId}`
}

/** dnd-kit draggable id of a panel's header handle. */
export function workspacePanelDragId(panelId: string): string {
  return `ws-panel:${panelId}`
}

/** A tab as a drag shows it (ghost, ghost tabs). */
export interface DraggedTab {
  id: string
  kind: WidgetKind
  title: string
}

export interface WorkspaceTabDragData {
  type: typeof WORKSPACE_TAB_DRAG
  tabId: string
  kind: WidgetKind
  title: string
}

export interface WorkspacePanelDragData {
  type: typeof WORKSPACE_PANEL_DRAG
  panelId: string
  /** The panel's tabs, in strip order. */
  tabs: DraggedTab[]
}

export function isWorkspaceTabDragData(data: unknown): data is WorkspaceTabDragData {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === WORKSPACE_TAB_DRAG
}

export function isWorkspacePanelDragData(data: unknown): data is WorkspacePanelDragData {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === WORKSPACE_PANEL_DRAG
}

/** A tab or panel drag (layout editing), as opposed to a task drag. */
export function isWorkspaceDragType(type: unknown): boolean {
  return type === WORKSPACE_TAB_DRAG || type === WORKSPACE_PANEL_DRAG
}

/** A tab or panel drag in progress: what is under the pointer and whether dropping there changes the layout. */
export interface WorkspaceDragState {
  source: WorkspaceDragSource
  /** What moves, in strip order: the one tab, or every tab of the panel. */
  tabs: readonly DraggedTab[]
  hit: WorkspaceDropHit | null
  /** Tab-strip hits: the insertion line's offset from the left of that panel's header (px). */
  insertLeft: number | null
  target: LayoutDropTarget | null
  /** False for no-op targets (e.g. the dragged panel itself), which stay plain. */
  accepts: boolean
  /** The workspace as measured when the drag started (viewport px). */
  geometry: WorkspaceGeometry
}

export const WorkspaceDragContext = createContext<WorkspaceDragState | null>(null)

export function useWorkspaceDrag(): WorkspaceDragState | null {
  return useContext(WorkspaceDragContext)
}

/** The drop label for `n` dragged tabs of a panel drag ("Merge 2 tabs here"). */
export function tabsCount(n: number): string {
  return `${n} ${n === 1 ? 'tab' : 'tabs'}`
}
