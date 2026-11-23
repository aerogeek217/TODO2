# Shortcuts

Shortcuts (kind `shortcuts`, `components/workspace/shortcuts/`) is a whole widget in the **Tasks** group, after Notes. It shows a tile per list the user picked, from any layout, so those lists stay in reach. A click opens the list in the widget popup over the open layout, whatever layout it belongs to.

## Config

- `ShortcutsTabConfig = { lists?: number[] }`: the list ids, in order. It is layout config, saved with the layout. It has no view state.
- The key is never `listDefinitionId`. `layout-repository.storedListRefs` counts that key anywhere in a layout and would hand the list over to it. The ids stay out of `namedListId` / `layoutListRefs` too, so the layout's own lists are never these.
- The layout repair (`data/layout-shape`) keeps positive whole numbers, each once, in order, up to `SHORTCUTS_LISTS_MAX` (200). Anything else is dropped, a fix.
- A deleted list is skipped when drawn (`useShortcutListIds`). Its id stays in the config.

## A tile

Its data is `hooks/use-shortcuts.useShortcutTile`: the list as it shows on opening, built with `useBuiltList` — the list as edited, the prompt pick made in its popup and the screen filter.

- The list tab's picked icon (`utils/shortcuts.shortcutListIcon`): the tab of the list's own layout first, then any layout's, the open one as edited. None when no tab shows the list or its tab has none picked.
- The name, 13px semibold; the tab badge's capsule (`BadgeCapsule`, the list's own ranges, `useTabBadges` over a list tab of the popup's id); the count of tasks it shows.
- The first task titles as built, 0–3: as many whole 16px lines as the tile's height leaves (`shortcutPeekLines`), secondary to muted, each a little dimmer.
- The list's layout name with the layout glyph at its foot.
- A list waiting on its prompt has no capsule and no titles, and its count is `—`. A pick made in its popup counts while the popup shows it.

The tile is `--color-surface-high` with a 1px `--color-border-muted` edge, radius 8 and 10 / 12px padding.

## Faces

`utils/widget-face.shortcutsFaceFor` picks the face and `shortcutsShape` what it draws:

| Shape | Cell body |
|-------|-----------|
| small | the small face of every widget: its icon, its name and the number of lists. A click opens it larger |
| rows | narrower than 360px: a 32px row per list — icon, name, capsule, count |
| compact | at most 160px tall: one line of tiles at least 150px wide, without titles. The ones that don't fit end in a `+N` tile that opens it larger (`compactShortcutTiles`) |
| large | a grid of tiles (`auto-fill`, 200px at least), then a dashed **Add a list** tile |

- The large grid's rows run from 64px (the first line and the layout line) to 124px (three titles too), sharing the room. As the cell shrinks the titles go first, then the tiles go to one line, then to rows.
- With one row of tiles a large tile always has room for three titles. The titles drop only where there are two rows or more.
- Empty: `No lists added.` and an **Add a list** button.

## Adding and removing

`components/workspace/shortcuts/shortcuts-menu` holds the menu and the writes. Each write is `patchTabConfig(tab.id, 'shortcuts', { lists }, step)`, one undo step.

- **Add a list ›** is in the widget's ⋯ (its settings entries, as the Neglect map's and the Planner's) and opens from the dashed tile and the empty state. It lists every list not added yet under its layout's name, the open layout first, each layout's lists in their order (`shortcutChoices`). A list the layout edit mode waits to delete is left out. A pick adds the list at the end: `Added “Errands” to Shortcuts`.
- A tile's right-click, Shift+F10 or its ⋯ (bottom right, while the pointer is over the tile) offers **Open** and **Remove from Shortcuts**: `Removed “Errands” from Shortcuts`. The list itself stays.

## Drag to reorder

The tiles have their own `DndContext`, never the workspace's: `rectSortingStrategy` for tiles, vertical for rows, activation after `DRAG_ACTIVATION_DISTANCE_PX`. A drop moves the list to where it was dropped: `Moved “Errands”`. A press that ended a drag opens nothing. There is no drag on touch.

## Opening a list

`services/widget-popup.openShortcutList` shows `{ kind: 'shortcut', listDefinitionId }` (`ui-store.WidgetPopupTarget`).

- `WidgetPopupHost` resolves it from `useListDefinitionStore`, as the list a Number follows: a list tab of its own id, `shortcutListTabId(id)` (`shortcut-list-<id>`), in no layout — tab ids repeat across duplicated layouts. It carries the list tab's icon.
- Its zoom and details width are held by the host, in memory (`ListTabViewContext`).
- Its prompt picks are under that id. `list-widget-store` keeps that id among the live tabs while the popup shows it, so a pick lasts until it closes.
- The list deleted closes it.
- Edit list works from it: Edit list sees the list on screen while the popup shows it, and Save writes the list where it is, its layout unchanged.
