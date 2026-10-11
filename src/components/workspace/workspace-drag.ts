import { createContext, useContext } from 'react'
import type { WidgetKind } from '../../models/workspace-layout'
import type { LayoutDropTarget } from '../../utils/workspace-layout-ops'
import type { WorkspaceDropHit, WorkspaceGeometry } from '../../utils/workspace-drop'

/** `active.data.current.type` of a dragged workspace tab. */
export const WORKSPACE_TAB_DRAG = 'workspace-tab'

/** dnd-kit draggable id of a workspace tab. */
export function workspaceTabDragId(tabId: string): string {
  return `ws-tab:${tabId}`
}

export interface WorkspaceTabDragData {
  type: typeof WORKSPACE_TAB_DRAG
  tabId: string
  kind: WidgetKind
  title: string
}

export function isWorkspaceTabDragData(data: unknown): data is WorkspaceTabDragData {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === WORKSPACE_TAB_DRAG
}

/** A tab drag in progress: what is under the pointer and whether dropping there changes the layout. */
export interface TabDragState {
  tabId: string
  kind: WidgetKind
  title: string
  hit: WorkspaceDropHit | null
  /** Tab-strip hits: the insertion line's offset from the left of that cell's header (px). */
  insertLeft: number | null
  target: LayoutDropTarget | null
  /** False for no-op targets (e.g. the tab's own cell), which stay plain. */
  accepts: boolean
  /** The workspace as measured when the drag started (viewport px). */
  geometry: WorkspaceGeometry
}

export const TabDragContext = createContext<TabDragState | null>(null)

export function useTabDrag(): TabDragState | null {
  return useContext(TabDragContext)
}
