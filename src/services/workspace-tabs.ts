import { getActiveTab } from '../models/workspace-layout'
import { useWorkspaceStore } from '../stores/workspace-store'
import { cellColumnTracks, cellRowTracks } from '../utils/workspace-layout-ops'
import { panelOfTab } from '../utils/workspace-layout-queries'

/** Makes `tabId` its cell's active tab and expands the row and column tracks the cell covers, so the widget is on screen. */
export function showTab(tabId: string): void {
  const ws = useWorkspaceStore.getState()
  const working = ws.working
  const cell = working ? panelOfTab(working, tabId) : undefined
  if (working && cell) {
    if (getActiveTab(cell)?.id !== tabId) void ws.setActiveTab(tabId)
    const collapsed = [...cellRowTracks(working, cell.id), ...cellColumnTracks(working, cell.id)].filter((t) => t.collapsed === true)
    if (collapsed.length > 0) void ws.setTrackCollapsed(collapsed.map((t) => t.id), false)
  }
}
