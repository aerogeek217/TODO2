import { createContext, useContext } from 'react'
import { useUndoStore } from '../../stores/undo-store'
import { registerModuleReset } from '../../utils/module-reset'
import type { WidgetKind } from '../../models/workspace-layout'
import type { IconValue } from '../../models/icon'
import type { LayoutDropTarget } from '../../utils/workspace-layout-ops'
import type { DropGhost, WorkspaceDragSource, WorkspaceDropHit, WorkspaceGeometry } from '../../utils/workspace-drop'

/** `active.data.current.type` of a dragged workspace tab. */
export const WORKSPACE_TAB_DRAG = 'workspace-tab'
/** `active.data.current.type` of a whole panel (a cell) dragged by its header. */
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
  /** Its picked icon (items 11, 14); absent = its kind's. */
  icon?: IconValue
}

export interface WorkspaceTabDragData {
  type: typeof WORKSPACE_TAB_DRAG
  tabId: string
  kind: WidgetKind
  title: string
  icon?: IconValue
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
  /** Where the drop lands, at its size, and its words (`workspace-drop.dropGhost`); none for a no-op. */
  ghost: DropGhost | null
  /** The workspace as measured when the drag started (viewport px). */
  geometry: WorkspaceGeometry
}

export const WorkspaceDragContext = createContext<WorkspaceDragState | null>(null)

export function useWorkspaceDrag(): WorkspaceDragState | null {
  return useContext(WorkspaceDragContext)
}

/** `n` dragged tabs ("2 tabs"): a panel ghost's badge. */
export function tabsCount(n: number): string {
  return `${n} ${n === 1 ? 'tab' : 'tabs'}`
}

/** What the snackbar says when a drop's writes fail. */
export const DROP_FAILED_NOTICE = 'Couldn’t finish the drop.'

/**
 * Runs a drop's handler (dnd-kit's `onDragEnd` can't await it): a failure is
 * logged and said in the snackbar instead of rejecting unseen.
 */
export async function runDrop(drop: () => Promise<void>): Promise<void> {
  try {
    await drop()
  } catch (err) {
    console.error('[workspace] the drop failed', err)
    useUndoStore.getState().notify(DROP_FAILED_NOTICE)
  }
}

/**
 * Starts a drag of a new widget of `kind` from the layout edit mode's tray
 * (E3) at the viewport point (`x`, `y`): the workspace page's drag state
 * (`registerNewWidgetDrag`) follows the pointer from there with today's
 * drop model and ghost, and a release adds the widget where the ghost says.
 */
type NewWidgetDragStart = (kind: WidgetKind, title: string, x: number, y: number) => void

/** The workspace page's starter, while it is mounted. */
let newWidgetDrag: NewWidgetDragStart | null = null
registerModuleReset(() => { newWidgetDrag = null })

/** The workspace page registers how a tray drag starts; returns its unregister. */
export function registerNewWidgetDrag(start: NewWidgetDragStart): () => void {
  newWidgetDrag = start
  return () => { if (newWidgetDrag === start) newWidgetDrag = null }
}

/** The tray's chip dragged past the start distance: whether a drag started (the workspace page is there). */
export function beginNewWidgetDrag(kind: WidgetKind, title: string, x: number, y: number): boolean {
  if (!newWidgetDrag) return false
  newWidgetDrag(kind, title, x, y)
  return true
}
