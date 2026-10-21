import { useMemo } from 'react'
import { ownerLayoutId } from '../../models/list-definition'
import { getActiveTab, tabListId, widgetKindLabel, type LayoutTab, type WidgetKind } from '../../models/workspace-layout'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListDraftStore } from '../../stores/list-draft-store'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { uniqueListName } from '../../utils/list-copy'
import { registerModuleReset } from '../../utils/module-reset'
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
 * surface opens beside it, in place of another list's open Edit list (that
 * list keeps its draft).
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

/** `base` as a list name layout `layoutId` doesn't use yet: `base`, `base 2`, … */
function freshListName(base: string, layoutId: number): string {
  const taken = useListDefinitionStore.getState().listDefinitions
    .filter((d) => ownerLayoutId(d) === layoutId)
    .map((d) => d.name)
  return uniqueListName(base, taken)
}

/** Why a list widget can't be added to (or a tab switched to List in) a layout that isn't stored yet. */
export const NO_LIST_LAYOUT_REASON = 'Save the layout first to add lists.'

/** The new list widget being made, while its list is being saved (`createListThenEdit`). */
let creatingList: Promise<void> | null = null
registerModuleReset(() => { creatingList = null })

/**
 * A new list widget (adding one, a tab switched to List): saves a blank
 * list of layout `layoutId` (`New list`, `New list 2`, …; no filter;
 * Settings' new-list sort and grouping), hands its id to `show` (which puts
 * it in a tab and returns that tab's id), then opens Edit list beside that
 * tab. One at a time: a call while one is still saving its list (a
 * double-click on a List button or menu item) does nothing.
 */
export function createListThenEdit(show: (listDefinitionId: number) => string | null, layoutId: number): Promise<void> {
  if (creatingList) return creatingList
  const run = useListDefinitionStore.getState().add({ name: freshListName('New list', layoutId), owner: { layoutId } }).then((id) => {
    const tabId = show(id)
    if (tabId != null) openEditList(tabId, id)
  })
  creatingList = run.finally(() => { creatingList = null })
  return creatingList
}

/**
 * The open layout as a list chooser's owner: its id once it is stored (the
 * lists it owns are offered, and a new list is made for it), `undefined`
 * while it is a new layout an older build kept unsaved (New layout stores
 * the layout at once) — no list is offered or made for that one.
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
