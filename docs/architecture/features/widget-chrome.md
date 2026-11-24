# Widget chrome: tabs, faces and Open larger

Widget chrome is what surrounds a widget inside a cell: the cell's menu, the tab strip or the widget's own top line, the controls slot, the widget's face, and the widget popup (**Open larger**). The cell is `FilledCell` in `components/workspace/`, beside `cell-menu`, `WidgetTopLine`, `CellTabStrip`, `NumberStrip`, `TabNameIconPopover` and `WidgetPopup`. Faces are picked in `utils/widget-face` and `hooks/use-widget-face`; the popup opens through `services/widget-popup`.

See also [Workspace layout](workspace-layout.md) (the table the cells sit in, dividers, autosave) and [Layout edit mode](layout-edit-mode.md) (there a cell is a card with chrome and a menu of its own).

## The cell's menu

`cell-menu` builds a cell's menus by [the rule](workspace-layout.md#the-rule): edit mode changes the grid; what's inside a cell changes in place.

Outside the mode the cell has one menu, named **Cell options**. It opens from the ⋯, from a right-click on a tab or a lone widget's top line, and from Shift+F10 / the Menu key there. Its entries, in order:

1. The widget's own entries, under its kind's name: **Edit list…**, **Review these N tasks**, Zoom, Copy, a Number's or a chart's **Edit …**, its settings, **Open larger**, **Name and icon…**, and last **Change widget ›** (the current kind beside it; a submenu of every kind under Tasks and Insights).
2. **Move to layout ›** / **Copy to layout ›** ([Move / Copy to layout](cross-layout-moves.md)).
3. **Add widget as tab ›**: every kind under Tasks and Insights, a Breakdown's presets. The new widget is a tab of this cell, made its active one; a List gets a new blank list (`widget-hooks.addTabToCell`).
4. **Remove widget**: that tab.
5. **Collapse row** / **Expand row**, then **Collapse column** / **Expand column**: every row (column) track the cell covers. Expand column shows while any column it covers is collapsed.
6. **Edit layout**, last: the mode, this cell selected.

- In a cell showing a tab strip, the two read **Add tab ›** and **Remove tab** (`cell-menu.showsTabStrip`). A Numbers strip keeps the widget words.
- **A lone widget's cell stays, empty**: `workspace-store.removeWidget` / `workspace-layout-ops.removeTabKeepCell`, one undo step `Removed “X”`.
- Only the mode's **Close cell** gives a cell's space away, by [the absorb rule](layout-ops.md#cells).

## Name and icon…

**Name and icon…** is in the widget part of the ⋯ / right-click menu, before **Change widget ›**; desktop only. It opens a popover under the tab, or under its top line:

- **Name**:
  - a list's is its list's, written as Edit list writes it;
  - a Number's, a chart's and Created vs completed's is their `config.name`;
  - any other kind's is the tab's optional `name`; blank means the kind's label.
- **Icon**: the shared `IconPicker`.

Each change is one layout write and one undo step: `Renamed tab to “Inbox”`, `Changed icon of “Inbox”`.

### A tab's icon

- A tab's optional `icon` is layout config (`models/icon`: none, a line icon, an emoji muted or in color).
- It shows on the strip, the `+N` menu, the drag ghost, the widget popup's header and the phone.
- A tab never given one shows its kind's glyph there. Alone in its cell, a picked icon leads its top line.
- A muted emoji is one color like a line icon: gray at rest, the accent on a cell's active tab. A color emoji keeps its colors.

### The picker elsewhere

- A layout's icon is picked the same way ([Hue and icon](workspace-layout.md#hue-and-icon)).
- Statuses take an emoji the same way: the status editor's picker, whose Icons tab holds the status glyphs. `Status.emoji` / `emojiShow` sit beside the glyph's `icon`, drawn by `shared/StatusMark` wherever a status is.
- The picker's Recent is every emoji on tabs, layouts and statuses (`hooks/use-recent-emoji`).

## Tabs on demand

A cell holding one widget has no tab strip; a cell of two or more shows one. The phone follows the same rule ([On a phone](workspace-layout.md#on-a-phone)).

### One widget: its top line

The widget's own top line (`WidgetTopLine`) names it and stands for its tab (`data-ws-tab`):

- a list: its name and badge capsule (`list/ListTopLine`), then its filter line (the filter in words, the count while narrowed, group · sort);
- the calendar: its month header;
- a Number: its label;
- a chart: its title;
- Notes, the Neglect map, Work clusters, the Planner and the List board: a name line (`WidgetNameLine`), its name shown only with Settings › **Show widget names** on (off by default). Off, the line keeps only its other content (the Planner's range, Work clusters' count, which takes the legend's tooltip); with none it isn't drawn.

It ends with the cell's controls slot (`CellControls`, lent through `CellControlsContext`):

- **Open larger**, where the widget offers it ([Open larger](#open-larger)), and the ⋯.
- They show on the cell's hover and focus-within and always on touch, with no fade.
- Floating over a face and hidden, they take no press: a tap or a press at a Number's or a small face's corner reaches the face.
- While collapsed, the slot has an **Expand row** button that always shows.
- A face with no top line (a small face, a Number whose label is inside its button, a hidden name line) gets the slot floating over the cell's top-right corner, above the face (the body frame isolates the widget's own layers). The body is then `data-controls-floating` and sets `--cell-controls-reserve` (60px), what a face keeps clear of in that corner: the Neglect map's Slipping word.

### Two or more widgets: the tab strip

The cell's header shows, in order:

- the tab strip (`CellTabStrip`);
- its empty space, which is only room (in the mode a press there reaches the card's surface);
- **Open larger**, where the active widget offers it;
- **Collapse row**;
- the same ⋯.

In the mode the card's ⋯ stands for these.

- On a device that hovers, the active tab's × and the add-tab `+` show only on the cell's hover or focus-within. They hide by opacity, so the strip's fit doesn't change. They are never hidden on touch.
- A drop joining a one-widget cell previews the strip it will have.

## A strip of Numbers

A cell of Numbers widgets holding two or more Numbers draws no tab strip (`workspace-rows.isNumberStripCell`); each Number is drawn as a tab of its own (`utils/number-views`). `NumberStrip` draws its Numbers side by side, evenly divided.

- The grid is `repeat(auto-fit, minmax(72px, 1fr))`: the Numbers wrap onto another line when each can't keep 72px, and the fit row grows with it.
- Each Number is a slot of its own (`[data-number-slot]`) with:
  - its own face;
  - its own ⋯ and **Open larger**, its controls shown on its own hover (`data-slot-hot`);
  - its ×;
  - a tab's drag: it reorders in the strip. Dragged out, and in from another card, only in the mode.
- The strip's right edge is a gutter for the `+` that adds a Number, clear of every Number.
- Each Number's ⋯ has **Remove widget** (that Number alone).
- A drop in the strip's middle lands between its slots (`measure` reads the slots as its tabs; the ghost says `Add to strip`). In the mode the outer quarter of each end slot splits (`hitTestWorkspace`); outside it nothing splits, so the whole strip takes the drop, its ends included (`numberStripHitAt`).
- On a phone its Numbers are two-up items among the others.

## Fit rows

A row track fits its content when the cells lying only in it each hold only Numbers (one, or a strip).

- Its size is `auto`: 58px for a Number of any shape, as measured.
- It is derived, never stored (`workspace-rows.isFitTrack`).
- A cell spanning through the row doesn't count.
- Collapsed, the row's cells keep their small face.

The exception is a row whose divider gave it a height, the track's `fitPx` ([A fit row's divider](workspace-layout.md#a-fit-rows-divider)):

- `fitPx` is view state, saved at once.
- It never replaces the track's weight or px, and a split's halves don't inherit it.
- While the row isn't Numbers-only it is ignored, and the track is weighted by its own weight.
- A double-click on the divider clears it.
- A Number taller than its small face shows its medium face.

## Faces

A widget draws its small, medium or large face by its cell body's measured size (`utils/widget-face` + `hooks/use-widget-face`). The face is never stored and never a setting.

| Face | Cell body |
|------|-----------|
| small | at most 90px tall or 180px wide |
| medium | at most 160px tall |
| large | anything else |

- These have faces: the List, the Calendar, the Neglect map and every glance widget; and by thresholds of their own, Review ([Review](review.md)), the Planner ([Planner](planner.md)), the List board ([List board](list-board.md)) and Work clusters ([Task maps](task-maps.md)).
- Notes is always whole.
- A fit row's cell is at its small face.
- A click on a small face, or its focus-only `Open …` button, opens the widget larger.

## Open larger

The widget popup draws one widget at a time at its large face over the workspace. `components/workspace/WidgetPopup` is hosted once on the workspace page, and it is opened through `services/widget-popup`.

Its state is `ui-store.widgetPopup`: what the popup shows (`WidgetPopupTarget`), or `null`. `setWidgetPopup` sets it and `closeWidgetPopup` clears it.

- `{ kind: 'tab', tabId }`: a tab of the layout.
- `{ kind: 'list', tabId }`: the list a Number follows ([Numbers](#numbers)).
- `{ kind: 'shortcut', listDefinitionId }`: a list of any layout, from a List board's tile ([List board](list-board.md#opening-a-picked-list)).
- `{ kind: 'review' }`: the popup review ([Review](review.md)).

### Size, header and layers

- `min(1400px, 100vw − 48px)` × `100vh − 48px`, centered, on the dialogs' overlay tier (`DialogFrame`).
- On a phone it is the full screen, where the popup review ([Review](review.md)) shows the Review widget's medium face.
- Its header: the tab's icon, its title (the popup's accessible name), its own ⋯ and ×.
- The ⋯ is named `Widget options` and holds the widget's entries only: no cell layout entries, no **Open larger**, no **Name and icon…**, no **Change widget ›**.
- What opens from inside is a layer above it: menus, the editors (anchored in the popup while it shows their tab, `utils/dom-contract.widgetElement`), the task editor, the task dialog.

### One live widget per tab

- The popup shows the same tab as the cell's, not a copy: its filter, sort, zoom and edits are the cell's.
- **A tab has one live widget at a time.** Two live copies would share their drag ids in the page's one `DndContext`.
- While the popup shows a tab, its cell (desktop and phone) draws a quiet placeholder in the widget's place (`OpenLargerPlaceholder`): `“X” is open larger`, muted, under a name line when alone in its cell. It keeps the body's height where its content sets it.
- The cell mounts the widget again when the popup closes.

### Ways in

- The **Open larger** button:
  - in a one-widget cell's controls slot, before the ⋯;
  - in a tab strip's header, for the active tab's widget, shown with the header's other buttons. A header under 340px wide has none: the strip needs that room for its tabs.
- **Open larger** in the ⋯ menu's widget section, before **Name and icon…**.
- The palette's **Open Widget Larger**: the cell last used, as **Add Widget ›** picks it.
- A small face's click, and a face's `+N more`.

### Opening and closing

- An open editor with changes asks first, as it does when Settings opens; an unchanged one closes ([Popovers and editors](popovers-and-editors.md)).
- Opening another replaces it.
- Esc, × or a press on the scrim close it, the focus back on what opened it (the tab's cell when that is gone).
- It closes when its tab goes (a layout switch, the tab closed) and on a data replace.

### Numbers

**Numbers** ([Glance widgets](glance-widgets.md)) offer Open larger only where their large face draws more than the face their cell shows (`utils/widget-face.tabOpensLarger`):

- A count with a breakdown: only the large face draws the breakdown.
- Share of…, Oldest, Against a goal and a group, from their small face. That face leaves out the ring and `N of M`, the caption, title and foot, the state and bar, and the item names.
- A plain count never: its click opens its tasks.
- A Number that follows a list never: its click opens that list in the popup (`openNumberList`).
  - The popup then holds a list widget under the Number's tab id, so its drag ids differ from the list's own tab's.
  - Its zoom and details width are the popup's own: kept while the workspace is open, never saved.
