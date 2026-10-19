import { useMemo } from 'react'
import { getActiveTab, tabListId, widgetKindLabel, type LayoutTab, type WidgetKind } from '../../models/workspace-layout'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListDraftStore } from '../../stores/list-draft-store'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { panelOfTab, type LayoutDropTarget } from '../../utils/workspace-layout-ops'
import { DELETED_LIST_TITLE } from '../shared/list-choice-entries'

/**
 * A tab's title: a list tab shows its list's name (`listName`, looked up by
 * the caller; `(Deleted list)` when its list is gone), other tabs their
 * kind's name — an Eisenhower tab reads `Eisenhower`.
 */
export function tabTitle(tab: LayoutTab, listName: string | undefined): string {
  if (tab.kind !== 'lens' || tab.config.listDefinitionId == null) return widgetKindLabel(tab.kind)
  return listName ?? DELETED_LIST_TITLE
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
 * A tab's title (`tabTitle`), kept current: a list tab names its list as
 * edited (its unsaved draft), else as saved.
 */
export function useTabTitle(tab: LayoutTab | undefined): string {
  const listId = tab ? tabListId(tab, null) : undefined
  const savedName = useListDefinitionStore((s) => (listId != null ? s.listDefinitions.find((d) => d.id === listId)?.name : undefined))
  const draftName = useListDraftStore((s) => (listId != null ? s.drafts[listId]?.name : undefined))
  return tab ? tabTitle(tab, shownName(savedName, draftName)) : ''
}

/** `useTabTitle` for every tab of a strip, in order. */
export function useTabTitles(tabs: readonly LayoutTab[]): string[] {
  const defs = useListDefinitionStore((s) => s.listDefinitions)
  const drafts = useListDraftStore((s) => s.drafts)
  return useMemo(() => tabs.map((tab) => tabTitle(tab, shownListName(tabListId(tab, null), defs, drafts))), [tabs, defs, drafts])
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
 * "Create new list…" in a list picker: saves a blank list — a saved list,
 * or one only layout `layoutOnlyFor` shows (This layout only) —, hands its
 * id to `show` (which puts it in a tab and returns that tab's id), then
 * opens Edit list beside that tab.
 */
export function createListThenEdit(show: (listDefinitionId: number) => string | null, layoutOnlyFor?: number): void {
  const owner = layoutOnlyFor != null ? { layoutId: layoutOnlyFor } : undefined
  void useListDefinitionStore.getState().add({ name: freshListName(), owner }).then((id) => {
    const tabId = show(id)
    if (tabId != null) openEditList(tabId, id)
  })
}

/**
 * The open layout as a list chooser's owner: its id once it is saved (its
 * own layout-only lists are offered, and a new list may be made for it
 * alone), `undefined` while it is a new layout not saved yet.
 */
export function useListOwnerLayoutId(): number | undefined {
  return useWorkspaceStore((s) => s.saved?.id)
}

/** Adds a widget tab of `kind` at `target` (a list tab with its list). Returns the new tab's id. */
export function useAddWidget() {
  const addWidget = useWorkspaceStore((s) => s.addWidget)
  return (kind: WidgetKind, target: LayoutDropTarget, listDefinitionId?: number) =>
    addWidget(kind, target, listDefinitionId != null ? { listDefinitionId } : undefined)
}
