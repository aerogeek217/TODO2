import type { IconValue } from '../models/icon'
import { ownerLayoutId, type PersistedListDefinition } from '../models/list-definition'
import { getActiveTab, KIND_LINE_ICON, tabStripIcon, type LayoutBody, type ListTab, type PersistedWorkspaceLayout, type ShortcutsSource, type ShortcutsTabConfig } from '../models/workspace-layout'
import { bySortOrder } from './sort-order'
import { readingOrder } from './workspace-grid'
import { layoutTabs } from './workspace-layout-queries'
import { LIST_BOARD_MIN_HEIGHT_PX } from './workspace-rows'

/**
 * The List board (widget kind `shortcuts`): a tile per list — the lists
 * picked, of any layout (`ShortcutsTabConfig.lists`, in order), or every list
 * tab of the open layout — and what the widget reads about each list: its
 * layout, its tab's icon, the lists it could add, the room a tile has.
 */

/** Which lists a List board shows (absent: the lists picked). */
export function shortcutsSource(config: ShortcutsTabConfig): ShortcutsSource {
  return config.source ?? 'picked'
}

/** A List board's picked list ids, in order (none picked: empty). */
export function shortcutLists(config: ShortcutsTabConfig): readonly number[] {
  return config.lists ?? []
}

/**
 * The list tabs a List board of the layout's lists shows: every list tab of
 * `layout` whose list `exists`, in reading order (by cell, then strip
 * order) — a tab per list tab, so a list two tabs show is there twice.
 */
export function layoutListTabs(layout: LayoutBody, exists: (listId: number) => boolean): ListTab[] {
  const out: ListTab[] = []
  for (const cell of readingOrder(layout)) {
    for (const tab of cell.tabs) {
      const id = tab.kind === 'lens' ? tab.config.listDefinitionId : undefined
      if (tab.kind === 'lens' && id != null && exists(id)) out.push(tab)
    }
  }
  return out
}

/** Whether `layout`'s cell holding tab `tabId` shows it (its active tab). */
export function tabIsShowing(layout: LayoutBody, tabId: string): boolean {
  return layout.cells.some((c) => getActiveTab(c)?.id === tabId)
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

/** The icon the strip shows for the first list tab in `layout` showing list `id` (`tabStripIcon`): none for No icon. */
function iconIn(layout: LayoutBody, id: number): IconValue | undefined {
  for (const tab of layoutTabs(layout)) {
    if (tab.kind === 'lens' && tab.config.listDefinitionId === id) {
      const icon = tabStripIcon(tab)
      return icon.kind === 'none' ? undefined : icon
    }
  }
  return undefined
}

/** A list's icon where no tab shows it: the list glyph. */
const LIST_GLYPH: IconValue = { kind: 'line', key: KIND_LINE_ICON.lens }

/**
 * A list's icon on its tile: the icon the strip shows for the list tab
 * showing it — its own layout's first, then any layout's (the open one as
 * edited) — a picked one, else the list glyph; none for a tab given No
 * icon. No tab shows it: the list glyph.
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
  return other ? iconIn(other, def.id) : LIST_GLYPH
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

/** A tile's title line height, px (`ShortcutsWidget.module.css` `.peekLine`), and the most titles it shows. */
const SHORTCUT_PEEK_LINE_PX = 16
export const SHORTCUT_PEEK_MAX_LINES = 3

/** A tile's square side and the gap between squares, px; the gap between its squares and its titles (`ShortcutsWidget.module.css`). */
const BOARD_SQUARE_PX = 10
const BOARD_SQUARE_GAP_PX = 2
const BOARD_ROOM_GAP_PX = 6
/** The most rows of squares a tile draws: past them its last three give way to `+N`. */
const BOARD_SQUARE_ROWS_MAX = 4
/** A tile's squares across before it is measured (a 136px tile's room). */
const BOARD_COLUMNS_UNMEASURED = 9

/** What a tile's room under its head holds: its squares `columns` across and `rows` down, then `lines` task titles. */
interface BoardTileRoom {
  columns: number
  rows: number
  lines: number
}

/**
 * How a tile's room (`width` × `height` px, under its head) holds `squares`
 * squares and `titles` task titles (up to `SHORTCUT_PEEK_MAX_LINES`; none
 * when `withTitles` is false): the squares first, as many whole rows as
 * the room gives (`BOARD_SQUARE_ROWS_MAX` at most), then the titles in the
 * room left — so as the tile shrinks the titles go first, then the rows of
 * squares. `want` is the height the room asks for to show it all.
 * Unmeasured (0): 9 across, every row and every title.
 */
export function boardTileRoom(squares: number, titles: number, size: { width: number; height: number }, withTitles = true): BoardTileRoom & { want: number } {
  const step = BOARD_SQUARE_PX + BOARD_SQUARE_GAP_PX
  const columns = size.width > 0 ? Math.max(1, Math.floor((size.width + BOARD_SQUARE_GAP_PX) / step)) : BOARD_COLUMNS_UNMEASURED
  const needed = squares > 0 ? Math.min(BOARD_SQUARE_ROWS_MAX, Math.ceil(squares / columns)) : 0
  const titleLines = withTitles ? Math.min(SHORTCUT_PEEK_MAX_LINES, titles) : 0
  const blockOf = (rows: number) => (rows > 0 ? rows * step - BOARD_SQUARE_GAP_PX : 0)
  const want = blockOf(needed) + (needed > 0 && titleLines > 0 ? BOARD_ROOM_GAP_PX : 0) + titleLines * SHORTCUT_PEEK_LINE_PX
  if (size.height <= 0) return { columns, rows: needed, lines: titleLines, want }
  const rows = Math.min(needed, Math.max(0, Math.floor((size.height + BOARD_SQUARE_GAP_PX) / step)))
  const left = size.height - blockOf(rows) - (rows > 0 ? BOARD_ROOM_GAP_PX : 0)
  const lines = Math.max(0, Math.min(titleLines, Math.floor(left / SHORTCUT_PEEK_LINE_PX)))
  return { columns, rows, lines, want }
}

/** The gap between tiles (px) and a tile's least height — its padding, its head, the gap and its room's least 1px (`ShortcutsWidget.module.css`). */
const BOARD_TILE_GAP_PX = 8
const BOARD_TILE_HEAD_PX = 45
/** A tile's least width (px), and the most a head on one line may raise every tile's width to. */
const BOARD_TILE_MIN_PX = 120
const BOARD_TILE_MIN_CAP_PX = 280

/**
 * Every tile's width at least (px): wide enough for the widest tile's head
 * on one line (`heads`: each tile's icon, name, capsule or count and
 * padding), never under `BOARD_TILE_MIN_PX` nor over `BOARD_TILE_MIN_CAP_PX`
 * (past that a long name shortens). The grid gives every tile one width.
 */
export function boardTileMinWidth(heads: Iterable<number>): number {
  let widest = BOARD_TILE_MIN_PX
  for (const w of heads) if (w > widest) widest = w
  return Math.min(BOARD_TILE_MIN_CAP_PX, Math.ceil(widest))
}

/** How many lines `count` tiles at least `tileMin` wide wrap onto in `width` (the grid's `auto-fit`). */
export function boardLines(count: number, width: number, tileMin: number): number {
  if (count <= 0) return 1
  const columns = Math.max(1, Math.floor((width + BOARD_TILE_GAP_PX) / (tileMin + BOARD_TILE_GAP_PX)))
  return Math.ceil(count / columns)
}

/**
 * The least height (px) of a lone List board's cell: its lines of tiles,
 * each line only the tiles' heads (`LIST_BOARD_MIN_HEIGHT_PX` holds one) —
 * the row's minimum, so no card is ever cut off.
 */
export function boardMinHeight(lines: number): number {
  return LIST_BOARD_MIN_HEIGHT_PX + Math.max(0, lines - 1) * (BOARD_TILE_HEAD_PX + BOARD_TILE_GAP_PX)
}

/** Whether `icon` is the list glyph every list tab shows unless given its own: a tile shows no icon then. */
export function isListGlyph(icon: IconValue): boolean {
  return icon.kind === 'line' && icon.key === KIND_LINE_ICON.lens
}
