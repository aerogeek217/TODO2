import { kindTabTitle, type LayoutBody } from '../models/workspace-layout'
import { getTab } from '../utils/workspace-layout-queries'
import { useListDefinitionStore } from './list-definition-store'

/** The names a layout edit's undo step gives a tab or a cell (`workspace-store`). */

/** A tab's name in an undo step: a list tab's list (as saved), else its kind's or its own (`kindTabTitle`). */
export function tabName(layout: LayoutBody, tabId: string): string {
  const tab = getTab(layout, tabId)
  if (!tab) return 'widget'
  if (tab.kind === 'lens' && tab.config.listDefinitionId != null) {
    const id = tab.config.listDefinitionId
    return useListDefinitionStore.getState().listDefinitions.find((d) => d.id === id)?.name ?? 'List'
  }
  return kindTabTitle(tab)
}

/** `Closed cell`, `Closed cell “Notes”`, `Closed cell (3 tabs)`. */
export function closeCellDescription(layout: LayoutBody, cellId: string): string {
  const cell = layout.cells.find((c) => c.id === cellId)
  const [first] = cell?.tabs ?? []
  if (!cell || !first) return 'Closed cell'
  return cell.tabs.length === 1 ? `Closed cell “${tabName(layout, first.id)}”` : `Closed cell (${cell.tabs.length} tabs)`
}
