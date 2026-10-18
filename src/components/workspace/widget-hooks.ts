import { useMemo } from 'react'
import { getActiveTab, widgetKindLabel, type LayoutTab, type WidgetKind } from '../../models/workspace-layout'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListDraftStore } from '../../stores/list-draft-store'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { panelOfTab, type LayoutDropTarget } from '../../utils/workspace-layout-ops'

/**
 * A tab's title: a list tab shows its list's name (`listName`, looked up by
 * the caller; `(Deleted list)` when its list is gone), other tabs their
 * kind's name.
 */
export function tabTitle(tab: LayoutTab, listName: string | undefined): string {
  if (tab.kind === 'lens') return tab.config.listDefinitionId == null ? widgetKindLabel('lens') : (listName ?? '(Deleted list)')
  return widgetKindLabel(tab.kind)
}

/**
 * A tab's title (`tabTitle`), kept current. A list tab shows the name as
 * edited (the list's unsaved draft), else the saved name.
 */
export function useTabTitle(tab: LayoutTab | undefined): string {
  const listId = tab?.kind === 'lens' ? tab.config.listDefinitionId : undefined
  const savedName = useListDefinitionStore((s) => (listId != null ? s.listDefinitions.find((d) => d.id === listId)?.name : undefined))
  const draftName = useListDraftStore((s) => (listId != null ? s.drafts[listId]?.name.trim() : undefined))
  const listName = savedName != null ? (draftName || savedName) : undefined
  return tab ? tabTitle(tab, listName) : ''
}

/** `useTabTitle` for every tab of a strip, in order. */
export function useTabTitles(tabs: readonly LayoutTab[]): string[] {
  const defs = useListDefinitionStore((s) => s.listDefinitions)
  const drafts = useListDraftStore((s) => s.drafts)
  return useMemo(() => tabs.map((tab) => {
    const listId = tab.kind === 'lens' ? tab.config.listDefinitionId : undefined
    const savedName = listId != null ? defs.find((d) => d.id === listId)?.name : undefined
    const draftName = listId != null ? drafts[listId]?.name.trim() : undefined
    return tabTitle(tab, savedName != null ? (draftName || savedName) : undefined)
  }), [tabs, defs, drafts])
}

/**
 * Opens Edit list for a list tab: the tab is made its panel's active one and
 * the panel expanded (so the list it previews is on screen), then the
 * surface opens beside it.
 */
export function openEditList(tabId: string, listDefinitionId: number): void {
  const ws = useWorkspaceStore.getState()
  const working = ws.working
  const cell = working ? panelOfTab(working, tabId) : undefined
  if (cell) {
    if (getActiveTab(cell)?.id !== tabId) void ws.setActiveTab(tabId)
    if (cell.collapsed) void ws.setCellCollapsed(cell.id, false)
  }
  useUIStore.getState().openListEditor(listDefinitionId, tabId)
}

/** A list name not used by any saved list: "New list", "New list 2", … */
function freshListName(): string {
  const taken = new Set(useListDefinitionStore.getState().listDefinitions.map((d) => d.name.toLowerCase()))
  let name = 'New list'
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `New list ${n}`
  return name
}

/**
 * "Create new list…" in a list picker: saves a blank list, hands its id to
 * `show` (which puts it in a tab and returns that tab's id), then opens Edit
 * list beside that tab.
 */
export function createListThenEdit(show: (listDefinitionId: number) => string | null): void {
  void useListDefinitionStore.getState().add({ name: freshListName() }).then((id) => {
    const tabId = show(id)
    if (tabId != null) openEditList(tabId, id)
  })
}

/** Adds a widget tab of `kind` at `target` (a list tab with its list). Returns the new tab's id. */
export function useAddWidget() {
  const addWidget = useWorkspaceStore((s) => s.addWidget)
  return (kind: WidgetKind, target: LayoutDropTarget, listDefinitionId?: number) =>
    addWidget(kind, target, listDefinitionId != null ? { listDefinitionId } : undefined)
}
