import type { IconValue } from '../models/icon'
import { ownerLayoutId, type PersistedListDefinition } from '../models/list-definition'
import { tabTopLineIcon, type LayoutBody, type PersistedWorkspaceLayout, type ShortcutsTabConfig } from '../models/workspace-layout'
import { bySortOrder } from './sort-order'
import { layoutTabs } from './workspace-layout-queries'

/**
 * Shortcuts (2026-11-23): a tile per picked list, from any layout — the
 * list ids in its config, in order (`ShortcutsTabConfig.lists`), and what
 * the widget reads about each list: its layout, its tab's icon, the lists
 * it could add.
 */

/** Shortcuts' list ids, in order (none picked: empty). */
export function shortcutLists(config: ShortcutsTabConfig): readonly number[] {
  return config.lists ?? []
}

/** `lists` with `id` added at the end (unchanged when it is there already). */
export function withShortcutAdded(lists: readonly number[], id: number): number[] {
  return lists.includes(id) ? [...lists] : [...lists, id]
}

/** `lists` without `id`. */
export function withShortcutRemoved(lists: readonly number[], id: number): number[] {
  return lists.filter((l) => l !== id)
}

/** `lists` with the id at `from` moved to `to` (out of range: unchanged). */
export function withShortcutMoved(lists: readonly number[], from: number, to: number): number[] {
  const next = [...lists]
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next
  const [id] = next.splice(from, 1)
  if (id !== undefined) next.splice(to, 0, id)
  return next
}

/** The layouts as the widget reads them: the open one as edited (`working`), the others as stored. */
function layoutsAsShown(layouts: readonly PersistedWorkspaceLayout[], working: PersistedWorkspaceLayout | null): PersistedWorkspaceLayout[] {
  return layouts.map((l) => (working && l.id === working.id ? working : l))
}

/** The picked icon of the first list tab in `layout` showing list `id` (`tabTopLineIcon`), else none. */
function iconIn(layout: LayoutBody, id: number): IconValue | undefined {
  for (const tab of layoutTabs(layout)) {
    if (tab.kind === 'lens' && tab.config.listDefinitionId === id) return tabTopLineIcon(tab)
  }
  return undefined
}

/**
 * A list's icon on its tile: the picked icon of the list tab showing it —
 * its own layout's first, then any layout's (the open one as edited); none
 * when no tab shows it or that tab has none picked.
 */
export function shortcutListIcon(
  def: Pick<PersistedListDefinition, 'id' | 'owner'>,
  layouts: readonly PersistedWorkspaceLayout[],
  working: PersistedWorkspaceLayout | null,
): IconValue | undefined {
  const shown = layoutsAsShown(layouts, working)
  const ownerId = ownerLayoutId(def)
  const owner = shown.find((l) => l.id === ownerId)
  const hasTab = (l: LayoutBody) => layoutTabs(l).some((t) => t.kind === 'lens' && t.config.listDefinitionId === def.id)
  if (owner && hasTab(owner)) return iconIn(owner, def.id)
  const other = shown.find(hasTab)
  return other ? iconIn(other, def.id) : undefined
}

/** The name of the layout list `def` belongs to (the open one's as edited); empty without one. */
export function shortcutLayoutName(
  def: Pick<PersistedListDefinition, 'owner'>,
  layouts: readonly PersistedWorkspaceLayout[],
  working: PersistedWorkspaceLayout | null,
): string {
  const ownerId = ownerLayoutId(def)
  if (ownerId == null) return ''
  if (working?.id === ownerId) return working.name
  return layouts.find((l) => l.id === ownerId)?.name ?? ''
}

/** One layout's lists Add a list offers. */
export interface ShortcutChoiceGroup {
  layoutId: number
  layoutName: string
  lists: PersistedListDefinition[]
}

/**
 * What **Add a list ›** offers: every list not added yet (nor `held` — a
 * list the layout edit mode waits to delete), under its layout's name, the
 * open layout first, then the others in their order; each layout's lists
 * in their order. A list of no stored layout is not offered.
 */
export function shortcutChoices(
  defs: readonly PersistedListDefinition[],
  layouts: readonly PersistedWorkspaceLayout[],
  working: PersistedWorkspaceLayout | null,
  added: readonly number[],
  held: ReadonlySet<number> = new Set(),
): ShortcutChoiceGroup[] {
  const shown = layoutsAsShown(layouts, working)
  const open = shown.filter((l) => l.id === working?.id)
  const ordered = [...open, ...shown.filter((l) => l.id !== working?.id)]
  const skip = new Set(added)
  const sorted = [...defs].sort(bySortOrder)
  const groups: ShortcutChoiceGroup[] = []
  for (const layout of ordered) {
    const lists = sorted.filter((d) => ownerLayoutId(d) === layout.id && !skip.has(d.id) && !held.has(d.id))
    if (lists.length > 0) groups.push({ layoutId: layout.id, layoutName: layout.name, lists })
  }
  return groups
}

/** A compact tile's least width, px, and the gap between tiles (`ShortcutsWidget.module.css`). */
const SHORTCUT_COMPACT_TILE_MIN_PX = 150
const SHORTCUT_TILE_GAP_PX = 8

/**
 * How a compact face's one line of tiles fits `count` lists in `width`:
 * `columns` tiles across; `shown` of them lists, and `more` lists folded
 * into a last `+N` tile when they don't all fit. Unmeasured: every list.
 */
export function compactShortcutTiles(count: number, width: number): { columns: number; shown: number; more: number } {
  if (width <= 0) return { columns: Math.max(1, count), shown: count, more: 0 }
  const columns = Math.max(1, Math.floor((width + SHORTCUT_TILE_GAP_PX) / (SHORTCUT_COMPACT_TILE_MIN_PX + SHORTCUT_TILE_GAP_PX)))
  if (count <= columns) return { columns, shown: count, more: 0 }
  const shown = Math.max(0, columns - 1)
  return { columns, shown, more: count - shown }
}

/** A tile's peek line height, px (`ShortcutsWidget.module.css` `.peekLine`), and the most lines it shows. */
const SHORTCUT_PEEK_LINE_PX = 16
export const SHORTCUT_PEEK_MAX_LINES = 3

/** How many whole peek lines an area `height` px tall holds (0 – `SHORTCUT_PEEK_MAX_LINES`). Unmeasured: all. */
export function shortcutPeekLines(height: number): number {
  if (height <= 0) return SHORTCUT_PEEK_MAX_LINES
  return Math.max(0, Math.min(SHORTCUT_PEEK_MAX_LINES, Math.floor(height / SHORTCUT_PEEK_LINE_PX)))
}
