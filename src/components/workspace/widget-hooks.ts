import { useMemo } from 'react'
import { getActiveTab, tabListId, widgetKindLabel, type LayoutTab, type WidgetKind } from '../../models/workspace-layout'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListDraftStore } from '../../stores/list-draft-store'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { panelOfTab, type LayoutDropTarget } from '../../utils/workspace-layout-ops'

/** A deleted list's name in a tab title. */
export const DELETED_LIST_TITLE = '(Deleted list)'

/**
 * A tab's title: a tab on a list (a list tab, an Eisenhower tab on a list)
 * shows its list's name (`listName`, looked up by the caller; `(Deleted
 * list)` when its list is gone), other tabs their kind's name.
 */
export function tabTitle(tab: LayoutTab, listName: string | undefined): string {
  if (tabListId(tab) == null) return widgetKindLabel(tab.kind)
  return listName ?? DELETED_LIST_TITLE
}

/**
 * A tab's tooltip: its title, with the kind first on an Eisenhower tab on a
 * list (`Eisenhower · <list>`) — its title alone reads like a list tab.
 */
export function tabTooltip(tab: LayoutTab, listName: string | undefined): string {
  const title = tabTitle(tab, listName)
  return tab.kind === 'eisenhower' && tabListId(tab) != null ? `${widgetKindLabel(tab.kind)} · ${title}` : title
}

/**
 * The name a tab's list shows, from its saved name and its unsaved draft's:
 * as edited (a blank draft name aside), else saved; `undefined` when the
 * list is gone. The one rule for every tab title — the strip, the `+N`
 * overflow menu, the phone.
 */
function shownName(savedName: string | undefined, draftName: string | undefined): string | undefined {
  if (savedName == null) return undefined
  return draftName?.trim() || savedName
}

/** `shownName` of the list `listId`. */
function shownListName(
  listId: number | undefined,
  defs: readonly { id: number; name: string }[],
  drafts: Readonly<Record<number, { name: string } | undefined>>,
): string | undefined {
  if (listId == null) return undefined
  return shownName(defs.find((d) => d.id === listId)?.name, drafts[listId]?.name)
}

/**
 * A tab's title (`tabTitle`) and tooltip (`tabTooltip`), kept current. A
 * tab on a list shows the name as edited (the list's unsaved draft), else
 * the saved name.
 */
export function useTabLabels(tab: LayoutTab | undefined): { title: string; tooltip: string } {
  const listId = tab ? tabListId(tab) : undefined
  const savedName = useListDefinitionStore((s) => (listId != null ? s.listDefinitions.find((d) => d.id === listId)?.name : undefined))
  const draftName = useListDraftStore((s) => (listId != null ? s.drafts[listId]?.name : undefined))
  const listName = shownName(savedName, draftName)
  return tab ? { title: tabTitle(tab, listName), tooltip: tabTooltip(tab, listName) } : { title: '', tooltip: '' }
}

/** A tab's title (`tabTitle`), kept current (see `useTabLabels`). */
export function useTabTitle(tab: LayoutTab | undefined): string {
  return useTabLabels(tab).title
}

/** `useTabTitle` for every tab of a strip, in order. */
export function useTabTitles(tabs: readonly LayoutTab[]): string[] {
  const defs = useListDefinitionStore((s) => s.listDefinitions)
  const drafts = useListDraftStore((s) => s.drafts)
  return useMemo(() => tabs.map((tab) => tabTitle(tab, shownListName(tabListId(tab), defs, drafts))), [tabs, defs, drafts])
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
