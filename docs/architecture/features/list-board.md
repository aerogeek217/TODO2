# List board

The List board (kind `shortcuts`, `components/workspace/shortcuts/`) is a whole widget in the **Tasks** group, after Notes. It shows a tile per list, so many lists can be seen at once and opened from one place. Its stored kind is `shortcuts`, as the List widget's is `lens`; every word the user reads says List board.

Its **Which lists** setting picks the lists:

- **Lists I pick**: lists of any layout, in the order the user puts them. A click opens the list in the widget popup over the open layout, whatever layout it belongs to.
- **This layout's lists**: every list tab of the open layout. A click opens that tab larger.

## Config

- `ShortcutsTabConfig = { source?: 'picked' | 'layout', lists?: number[] }`. Absent `source` is `picked`. `lists` are the picked list ids, in order, kept while the board shows the layout's lists. It is layout config, saved with the layout. It has no view state.
- The key is never `listDefinitionId`. `layout-repository.storedListRefs` counts that key anywhere in a layout and would hand the list over to it. The ids stay out of `namedListId` / `layoutListRefs` too, so the layout's own lists are never these.
- The layout repair (`data/layout-shape`) keeps a known `source` and drops any other, a fix. It keeps positive whole numbers in `lists`, each once, in order, up to `SHORTCUTS_LISTS_MAX` (200). Anything else is dropped, a fix.
- A deleted list is skipped when drawn (`useShortcutListIds`). Its id stays in the config.

## Which lists

**Which lists ›** is the first of the widget's entries in its ⋯ (its settings entries, as the Neglect map's), radio choices **Lists I pick** and **This layout's lists**. A switch is `patchTabConfig(tab.id, 'shortcuts', { source })`, one undo step (`Changed “List board”`). Switching keeps the picks.

This layout's lists are `utils/shortcuts.layoutListTabs`: every list tab of the open layout as edited whose list exists, in reading order (by cell, then strip order). A list two tabs show has two tiles.

## A tile

Its data is `hooks/use-shortcuts.useShortcutTile`: the list as it shows on opening, built with `useBuiltList` — the list as edited, its prompt pick and the screen filter. A picked list takes the pick made in its popup (a tab id of its own, `shortcutListTabId`); a tab of the layout takes that tab's own pick.

- **The head.** The icon, then the name, 13px semibold. The icon and the name stay together, 4px apart, the tile's sides 9px; a long name shortens with an ellipsis.
  - **The tab badge's capsule** (`BadgeCapsule`, the list's own ranges, `useTabBadges`) is a corner badge on a tile's top border, 10px from its right edge, so it adds nothing to the tile's width. A row keeps it in its line.
  - **A tile shows no count**: the count is in its tooltip and its squares. Only a list waiting on its prompt shows `—`, the one sign it is waiting. A row keeps its count.
  - A tab of the layout shows that tab's icon, as its strip does. A picked list shows the icon stored on its list tab (`shortcutListIcon`): the tab of the list's own layout first, then any layout's, the open one as edited. A tab without one, or a list no tab shows, has none. The list glyph shows as any icon does.
- **The squares.** A 10px square per open task it shows, 2px apart, the trouble first: overdue, due soon, follow-up late, on track, stale (`utils/list-wall`, a Lines box's `rowTone`). The state is the fill. The task's priority is a ring, with Focus's glow, as on the task's checkbox (`PriorityRing`, the square's 2px corner). A square's tooltip names its task, its state and its priority (`On track · Priority: Focus`), and a click opens the task.
- **The titles.** The first task titles as built, 0–3, 16px lines, secondary to muted, each a little dimmer.
- **The room.** Under the head the squares come first: as many whole rows as the tile has room for, four at most. When they are cut, the last three give way to `+N`. The titles take what is left (`boardTileRoom`). As a tile shrinks, the titles go first, then the rows of squares. The room takes no part in the row's least height (`contain: size`).
- **The tooltip.** Its name, for a picked list followed by its layout (`Errands · Home`); then its count and its open tasks by state (`7 tasks · 2 overdue · 5 on track`); then the legend of the squares' colors.
- A list waiting on its prompt has no capsule, no squares and no titles, and its count is `—`. A pick made where it is built counts.

The tile is `--color-surface-high` with a 1px `--color-border-muted` edge and radius 8. Its press is a button laid over the whole tile, under the head, squares and titles; the pointer passes through them to it, except on a square, which is a button of its own.

## Faces

`utils/widget-face.shortcutsFaceFor` picks the face and `shortcutsShape` what it draws:

| Shape | Cell body |
|-------|-----------|
| small | the small face of every widget: its icon, its name and the number of lists. A click opens it larger |
| rows | narrower than 360px: a row per list — icon, name, capsule, count — over a 6px bar of its open tasks, a segment per state as long as its share (dashed while it waits on its prompt) |
| compact | at most 160px tall — and, 360px wide or more, down to 63px, where other widgets show their small face: the tiles' heads, squares where a row fits, no titles. It never scrolls |
| large | the tiles with their titles; with lists picked, then a dashed **Add a list** tile |

- Compact and large are one grid (`auto-fit`): every tile as wide as the widest head asks on one line (`boardTileFit`, measured from each tile's icon and name, and never narrower than its corner badge needs — 64px to 280px), as many across as fit, stretched to share each line, the rest wrapping onto more lines. No tile is folded away.
- **The icons give way.** Every tile's icon is hidden at once when the heads without them put the tiles on fewer lines (`boardTileFit`); otherwise they show. A hidden icon keeps its last measured width, so hiding it never changes the choice. The **Add a list** tile shows only its plus when it is under 96px wide.
- **The row fits the cards.** Alone in its cell, the board tells `stores/cell-room-store` the height of its lines of heads (`boardLines`, `boardMinHeight`: 63px for one line, 53px for each more, the name line's 28px when it shows), and outside the layout edit mode the table holds its row at least that tall (`workspace-table.trackTemplate`'s `measured`) and a divider's drag stops there (`divider-drag.minPxIn`). Taller, the squares and titles show.
- The name line (`WidgetNameLine`) shows List board with Settings › Show widget names. Off, there is none and the cell's controls float over its corner.
- The large grid's rows run from a tile's head to what the tallest tile asks for (its head, its squares and three titles, `--board-content-max`), sharing the cell's height. Past that they scroll.
- Empty: `No lists added.` and an **Add a list** button; showing this layout's lists, `No list tabs in this layout.`

## Lists I pick

`components/workspace/shortcuts/shortcuts-menu` holds the menu and the writes. Each write is `patchTabConfig(tab.id, 'shortcuts', { lists }, step)`, one undo step.

- **Add a list ›** follows Which lists in the widget's ⋯ and opens from the dashed tile and the empty state. It lists every list not added yet under its layout's name, the open layout first, each layout's lists in their order (`shortcutChoices`). A list the layout edit mode waits to delete is left out. A pick adds the list at the end: `Added “Errands” to List board`.
- A tile's right-click, Shift+F10 or its ⋯ (bottom right, while the pointer is over the tile) offers **Open** and **Remove from List board**: `Removed “Errands” from List board`. The list itself stays.
- The tiles have their own `DndContext`, never the workspace's: `rectSortingStrategy` for tiles, vertical for rows, activation after `DRAG_ACTIVATION_DISTANCE_PX`. A drop moves the list to where it was dropped: `Moved “Errands”`. A press that ended a drag opens nothing. There is no drag on touch.

## This layout's lists

- There is no Add a list, no drag and no Remove: the tiles follow the layout's tabs.
- A click opens the tab in the widget popup (`openWidgetLarger(tabId)`).
- A tile's right-click, Shift+F10 or its ⋯ offers **Open** and **Show in its cell** (`services/workspace-tabs.showTab`: the tab comes to the front of its cell, the cell's collapsed rows open).

## Opening a picked list

`services/widget-popup.openShortcutList` shows `{ kind: 'shortcut', listDefinitionId }` (`ui-store.WidgetPopupTarget`).

- `WidgetPopupHost` resolves it from `useListDefinitionStore`, as the list a Number follows: a list tab of its own id, `shortcutListTabId(id)` (`shortcut-list-<id>`), in no layout — tab ids repeat across duplicated layouts. It carries the list tab's icon.
- Its zoom and details width are held by the host, in memory (`ListTabViewContext`).
- Its prompt picks are under that id. `list-widget-store` keeps that id among the live tabs while the popup shows it, so a pick lasts until it closes.
- The list deleted closes it.
- Edit list works from it: Edit list sees the list on screen while the popup shows it, and Save writes the list where it is, its layout unchanged.
