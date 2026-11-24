import type { LayoutBody, LayoutTab } from '../models/workspace-layout'
import { layoutListRefs } from './workspace-layout-lists'
import { findTab, layoutIds } from './workspace-layout-queries'
import { numberViews } from './number-views'
import type { IdGen } from './workspace-layout-ops'

/**
 * Move / Copy to layout (2026-11-18, `features/cross-layout-moves-2026-11-18`):
 * a widget (one tab) or a whole cell carried from the open layout to another
 * one, which opens in the layout edit mode with it **in hand** to be placed;
 * Done writes both layouts as one undo step. These are the pure parts: what
 * is carried, whether it is placed, and which of its lists go with it.
 */

/** What Move / Copy to layout carries from the open layout: one widget (a tab, a strip's Number) or a whole cell with its tabs. */
export type TransferWhat = { kind: 'tab'; tabId: string } | { kind: 'cell'; cellId: string }

/** The widgets in hand in the target layout's edit mode (`LayoutEditSession.incoming`). */
export interface IncomingTransfer {
  /** A copy (the source keeps them) or a move. */
  copy: boolean
  sourceLayoutId: number
  sourceName: string
  /** The source's tab ids it carries: removed from the source on Done (a move). */
  sourceTabIds: readonly string[]
  /** The tabs as they land: the source's, each given an id new to the target where its own is taken there. */
  tabs: readonly LayoutTab[]
  /** A whole cell's active tab, among `tabs`. */
  activeTabId?: string
  /** Its name in the mode bar and the undo step (`Moved “Inbox” to “Planning”`). */
  name: string
  /** The target was made for it (New layout…): Cancel deletes it again. */
  madeLayout?: boolean
}

/**
 * The tabs `what` names in `source` (a tab; a cell's, in order, with its
 * active tab), with ids `target` doesn't use (`genId`, the target's
 * generator, for each one taken) — a Numbers widget's items' ids too; one
 * id is renamed the same wherever it stands — `null` when it isn't there or
 * has no tabs.
 */
export function carriedTabs(
  source: LayoutBody,
  what: TransferWhat,
  target: LayoutBody,
  genId: IdGen,
): { sourceTabIds: string[]; tabs: LayoutTab[]; activeTabId?: string } | null {
  let picked: LayoutTab[]
  let active: string | undefined
  if (what.kind === 'tab') {
    const loc = findTab(source, what.tabId)
    const tab = loc ? source.cells[loc.cellIdx]?.tabs[loc.tabIdx] : undefined
    if (!tab) return null
    picked = [tab]
  } else {
    const cell = source.cells.find((c) => c.id === what.cellId)
    if (!cell || cell.tabs.length === 0) return null
    picked = cell.tabs
    active = cell.tabs.some((t) => t.id === cell.activeTabId) ? cell.activeTabId : undefined
  }
  const taken = layoutIds(target)
  const given = new Map<string, string>()
  /** The id `old` lands as: its own while the target doesn't use it, else a new one — the same for every use of `old`. */
  const idFor = (old: string): string => {
    const known = given.get(old)
    if (known != null) return known
    const id = taken.has(old) ? genId() : old
    taken.add(id)
    given.set(old, id)
    return id
  }
  const tabs = picked.map((tab): LayoutTab => {
    const id = idFor(tab.id)
    if (tab.kind !== 'numbers') return id === tab.id ? tab : { ...tab, id }
    const items = tab.config.items.map((item) => {
      const itemId = idFor(item.id)
      return itemId === item.id ? item : { ...item, id: itemId }
    })
    const same = id === tab.id && items.every((item, i) => item === tab.config.items[i])
    return same ? tab : { ...tab, id, config: { ...tab.config, items } }
  })
  const activeTabId = active != null ? given.get(active) ?? active : undefined
  return { sourceTabIds: picked.map((t) => t.id), tabs, ...(activeTabId != null ? { activeTabId } : {}) }
}

/** Whether every widget in hand is in `draft` (placed: Done may write the move). */
export function incomingPlaced(draft: LayoutBody | null, incoming: IncomingTransfer | null | undefined): boolean {
  if (!draft || !incoming) return false
  // TEMPORARY (`number-views`): a Number in hand is its view, found in the draft's view.
  const view = numberViews(draft)
  return incoming.tabs.every((t) => findTab(view, t.id) != null)
}

/** The lists the widgets in hand name (their list tabs', their Numbers' that follow one): the target's edits may show them. */
export function incomingListIds(incoming: IncomingTransfer | null | undefined): Set<number> {
  if (!incoming) return new Set()
  return layoutListRefs({ grid: { columns: [], rows: [] }, cells: [{ id: '', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [...incoming.tabs] }] })
}

/**
 * Which of the carried lists the target gets as they are and which as
 * copies (Done): a copy copies every one; a move hands a list over unless
 * the source still names it (`sourceAfter`: another tab, a Number following
 * it), which then keeps it and the target gets a copy. Only the lists the
 * target `draft` still shows count.
 */
export function transferListPlan(
  incoming: IncomingTransfer,
  draft: LayoutBody,
  sourceAfter: LayoutBody | null,
): { reown: number[]; copy: number[] } {
  const shown = layoutListRefs(draft)
  const carried = [...incomingListIds(incoming)].filter((id) => shown.has(id))
  if (incoming.copy || !sourceAfter) return { reown: [], copy: carried }
  const kept = layoutListRefs(sourceAfter)
  return { reown: carried.filter((id) => !kept.has(id)), copy: carried.filter((id) => kept.has(id)) }
}
