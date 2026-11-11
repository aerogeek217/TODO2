import { useMemo } from 'react'
import { ownerLayoutId } from '../../models/list-definition'
import { breakdownPreset } from '../../models/chart-widgets'
import { getActiveTab, kindTabTitle, tabListId, WIDGET_KIND_SPECS, type LayoutBody, type LayoutTab, type TabSeed, type WidgetKind } from '../../models/workspace-layout'
import { zoomTargetTab } from '../../services/list-zoom'
import { readingOrder } from '../../utils/workspace-grid'
import { useChartWidgetsStore } from '../../stores/chart-widgets-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListDraftStore } from '../../stores/list-draft-store'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { uniqueListName } from '../../utils/list-copy'
import { registerModuleReset } from '../../utils/module-reset'
import { panelOfTab } from '../../utils/workspace-layout-queries'
import { cellRowTracks } from '../../utils/workspace-layout-ops'
import { type LayoutDropTarget } from '../../utils/workspace-layout-ops'
import { afterLeavingEditors } from '../../stores/editor-leave'

/** A deleted list's name where its name would show (a tab title). */
export const DELETED_LIST_TITLE = '(Deleted list)'

/**
 * A tab's title: a list tab shows its list's name (`listName`, looked up by
 * the caller; `(Deleted list)` when its list is gone), other tabs their
 * kind's name — an Eisenhower tab reads `Eisenhower`.
 */
export function tabTitle(tab: LayoutTab, listName: string | undefined): string {
  if (tab.kind !== 'lens' || tab.config.listDefinitionId == null) return kindTabTitle(tab)
  return listName ?? DELETED_LIST_TITLE
}

/**
 * The name a tab's list shows, from its saved name and Edit list's draft's:
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
 * Edit list has it (its draft, while open on it), else as saved.
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
 * Opens Edit list for a list tab: the tab is made its cell's active one and
 * the row tracks it covers expanded (so the list it previews is on screen), then the
 * surface opens beside it, in place of another list's open Edit list —
 * which, holding changes, asks first: Save or Discard, then this one opens;
 * Keep editing, nothing changes (`openBeside`).
 */
export function openEditList(tabId: string, listDefinitionId: number): void {
  const open = useUIStore.getState().listEditor
  if (open?.listDefinitionId === listDefinitionId && open.tabId === tabId) return
  openBeside(tabId, () => useUIStore.getState().openListEditor(listDefinitionId, tabId))
}

/**
 * Shows tab `tabId` (`showTab`) and opens an editor beside it (`open`) —
 * once an open editor holding changes was saved or discarded (its question
 * asked first, `editor-leave`), never on Keep editing: showing the tab
 * could take that editor's subject off the screen.
 */
function openBeside(tabId: string, open: () => void): void {
  afterLeavingEditors(() => {
    showTab(tabId)
    open()
  })
}

/** Makes `tabId` its cell's active tab and expands the row tracks the cell covers, so the widget is on screen. */
export function showTab(tabId: string): void {
  const ws = useWorkspaceStore.getState()
  const working = ws.working
  const cell = working ? panelOfTab(working, tabId) : undefined
  if (working && cell) {
    if (getActiveTab(cell)?.id !== tabId) void ws.setActiveTab(tabId)
    const collapsed = cellRowTracks(working, cell.id).filter((t) => t.collapsed === true)
    if (collapsed.length > 0) void ws.setTrackCollapsed(collapsed.map((t) => t.id), false)
  }
}

/**
 * Opens a Number's editor (Edit number…, D26 P5): the tab shown as Edit list
 * shows its list's (`showTab`), then the popover beside the Number.
 */
export function openNumberEditor(tabId: string): void {
  if (useUIStore.getState().numberEditorTabId === tabId) return
  openBeside(tabId, () => useUIStore.getState().openNumberEditor(tabId))
}

/** `base` as a list name layout `layoutId` doesn't use yet: `base`, `base 2`, … */
function freshListName(base: string, layoutId: number): string {
  const taken = useListDefinitionStore.getState().listDefinitions
    .filter((d) => ownerLayoutId(d) === layoutId)
    .map((d) => d.name)
  return uniqueListName(base, taken)
}

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
 * The open layout as a list chooser's owner: its id (the lists it owns are
 * offered, and a new list is made for it) — `undefined` only before the
 * workspace has opened a layout (every layout is stored at once).
 */
export function useListOwnerLayoutId(): number | undefined {
  return useWorkspaceStore((s) => s.saved?.id)
}

/**
 * Adds a widget tab of `kind` at `target` (a list tab with its list).
 * Returns the new tab's id. A new Number opens its editor at once: its empty
 * filter counts every open task until one is set. So does a new chart
 * (D26 P8; `seed` its preset's config).
 */
export function useAddWidget() {
  return addWidgetAt
}

/**
 * Adds a widget of `kind` at `target` with `add` (`addWidgetAt`): a list
 * widget gets a new blank list of layout `layoutId` and opens its Edit list
 * (`createListThenEdit`); without a stored layout (`layoutId` undefined) no
 * list is added — it can't own one yet.
 */
export function addKindAt(kind: WidgetKind, target: LayoutDropTarget, add: typeof addWidgetAt, layoutId: number | undefined): void {
  if (!WIDGET_KIND_SPECS[kind].showsList) {
    add(kind, target)
    return
  }
  if (layoutId != null) void createListThenEdit((id) => add('lens', target, id), layoutId)
}

/**
 * The cell an Add widget from the palette goes to: the one holding the
 * focus as the command runs (the palette gives it back first — what had it
 * when the palette opened), else the list tab's the zoom and review
 * commands act on (`zoomTargetTab`), else the layout's first in reading
 * order; null in an empty layout.
 */
function paletteTargetCell(layout: LayoutBody, focused: Element | null): string | null {
  const ids = new Set(layout.cells.map((c) => c.id))
  const own = focused?.closest('[data-ws-cell]')?.getAttribute('data-ws-cell')
  if (own && ids.has(own)) return own
  const tab = zoomTargetTab()
  const tabCell = tab ? panelOfTab(layout, tab.id)?.id : undefined
  if (tabCell) return tabCell
  return readingOrder(layout).at(0)?.id ?? null
}

/** How far below a cell's top the palette's Where picker opens: the cell's top line (name, tabs) stays in view. */
const CELL_TOP_LINE_PX = 32

/**
 * The palette's Add Widget › `kind` (J18): the Where picker of the cell last
 * used, the kind chosen (`ui-store.requestAddWidget`, drawn by
 * `AddWidgetRequestHost` under the cell's top line); in an empty layout the
 * widget is added as its tiles add it (a Breakdown a Custom one).
 */
export function addWidgetFromPalette(kind: WidgetKind): void {
  const { working, saved } = useWorkspaceStore.getState()
  if (!working) return
  const cellId = paletteTargetCell(working, document.activeElement)
  if (cellId == null) {
    if (kind === 'breakdown') addWidgetAt('breakdown', { kind: 'layout' }, undefined, { breakdown: breakdownPreset('custom') })
    else addKindAt(kind, { kind: 'layout' }, addWidgetAt, saved?.id)
    return
  }
  const rect = document.querySelector(`[data-ws-cell="${CSS.escape(cellId)}"]`)?.getBoundingClientRect()
  const anchor = rect ? { x: rect.left + 8, y: rect.top + CELL_TOP_LINE_PX } : { x: 16, y: 64 }
  useUIStore.getState().requestAddWidget({ cellId, kind, anchor })
}

/** `useAddWidget`'s add, outside a component (the palette's Add Widget ›). */
export function addWidgetAt(kind: WidgetKind, target: LayoutDropTarget, listDefinitionId?: number, seed?: TabSeed): string | null {
  const tabId = useWorkspaceStore.getState().addWidget(kind, target, listDefinitionId != null ? { ...seed, listDefinitionId } : seed)
  if (tabId != null && kind === 'number') openNumberEditor(tabId)
  // D26 P8: a chart opens its editor too.
  if (tabId != null && (kind === 'breakdown' || kind === 'pivot')) {
    const chartTab = tabId
    openBeside(chartTab, () => useChartWidgetsStore.getState().openEditor(chartTab))
  }
  return tabId
}
