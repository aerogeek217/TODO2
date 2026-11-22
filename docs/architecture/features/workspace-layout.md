# Workspace layout

A layout is one table: grid tracks across and down, and cells that each cover a rectangle of tracks and hold a strip of widget tabs. This file covers the table and its tabs, how it is drawn and resized, and what the normal workspace does with it. The model is `models/workspace-layout`; the pure code is `utils/workspace-grid`, `utils/workspace-layout-ops` and `utils/workspace-table`; `WorkspaceView` draws the table and `workspace-store` writes it.

See also:

- [Layout ops](layout-ops.md): the operations that change the table;
- [Layout autosave](layout-autosave.md): how a layout is written, what is one undo step, and how layouts are opened, created, duplicated and deleted;
- [Layout edit mode](layout-edit-mode.md): rulers, cards, slots, the tray, drops;
- [Move / Copy to layout](cross-layout-moves.md);
- [Widget chrome](widget-chrome.md): a cell's menu, tabs, faces, Open larger.

## The table

A `WorkspaceLayout` is `{ id, name, sortOrder, grid, cells, createdAt, modifiedAt, lastUsedAt?, hue?, icon? }`; a `PersistedWorkspaceLayout` is one with its `id`.

- `sortOrder` is its place in the picker's order, ties by creation. It is written only when a layout is added (after the others) or the layouts are reordered.
- `name` is at most `LAYOUT_NAME_MAX` (200) long. The layout made when there is none is `DEFAULT_LAYOUT_NAME`, `Default`.
- `LayoutBody` is the `grid` and the `cells` alone (`layoutBodyOf` / `withLayoutBody`). An empty layout has no tracks and no cells (`emptyLayoutBody`).

### Tracks

`grid` is a `LayoutGrid`, `{ columns, rows }` (`GridAxis` names one of the two). Each is a list of `GridTrack`s, `{ id, weight?, px?, fitPx?, collapsed? }`, left to right or top to bottom.

- A weighted track has a `weight`: its share of the axis among the weighted ones, any positive number. A new one gets `DEFAULT_WEIGHT`, 1000.
- A fixed track has `px`, header included.
- `collapsed` is for row tracks only ([Collapse row](layout-ops.md#collapse-row)).
- A row track **fits its content** when the cells lying only in it each hold only Numbers (`utils/workspace-rows.isFitTrack`). That is derived, never stored.
- `fitPx` is for row tracks only: the height a divider gave a fit row.
  - It applies only while the row is a fit row and has no `px`. Otherwise it is ignored.
  - It never stands in for the track's weight, and a split's halves don't inherit it.
  - `data/layout-shape` checks it (a positive number on a row) and keeps it.

### Cells

`cells` is a list of `LayoutCell`s, `{ id, area, tabs, activeTabId? }`.

- Each covers a rectangle of tracks, `area: CellArea { col, row, colSpan, rowSpan }` (track indices), and holds its tabs in strip order.
- A full-height column is a cell spanning every row track; a strip is a cell spanning every column track. Nothing nests.
- The cells tile the grid exactly (no gap, no overlap), and every grid line is the edge of some cell.
- A cell with no tabs is an **empty cell**: a split's new cell, a close with no taker, or a lone widget removed.
- Ids are unique across the whole layout: tracks, cells and tabs share one id space.

`utils/workspace-grid` holds:

- the queries: neighbors along an edge, whether two cells merge into a rectangle, reading order, edge stretches;
- `normalizeGrid`, which merges the two tracks beside a line no cell's edge lies on and expands a collapsed row nothing can expand ([Collapse row](layout-ops.md#collapse-row));
- `validateTiling`.

### Structure and view state

- **Structure**: a cell's area, the tracks' ids and their order, the tabs and each tab's `config`.
- **View state**: the track sizes (a weight, a fixed track's px), a row track's `collapsed` and `fitPx`, a cell's `activeTabId`, a tab's `viewState`.

A change of structure is an undo step; view state is written straight onto the stored layout with none ([Layout autosave](layout-autosave.md)).

## Tabs and widget kinds

`LayoutTab` is a union discriminated on `kind`, one of `WIDGET_KINDS`: `lens` (the list widget), `calendar`, `notes`, `review`, `planner`, `neglect`, `clusters`, `listwall`, and the glance kinds `number`, `breakdown`, `pivot` and `trend`.

Each tab has a per-kind `config`, the **layout config** saved with the layout, and an optional `viewState`.

Config:

- A list tab: `listDefinitionId?`, which `createTab`'s seed sets. `tabListId(tab)` gives a list tab's list, which is what counts as a widget showing a list.
- A calendar: `dateTypes { due, followup }`. Both may be off, an empty calendar.
  - `CalendarDateType` is one of its keys: the date a calendar drop sets.
  - `toggleCalendarDateType(types, type)` switches one on or off.
- The glance kinds (`models/glance-widgets`, `models/chart-widgets`): a Number's `NumberConfig`, Created vs completed's `TrendTabConfig`, a Breakdown's `BreakdownConfig`, a Pivot's `PivotConfig`. See [Glance widgets](glance-widgets.md) and [Charts](charts.md).
- A Neglect map: `NeglectTabConfig` ([Task maps](task-maps.md#config)).
- The others: `{}`.

View state:

- A calendar: `view?: 'week' | 'month'`, an `offset?` clamped to ±104 by `clampCalendarOffset`, and `titles?: boolean`, the month's titled bars (absent or false, the heat map).
- A list tab (`ListTabViewState`): its rows' `detailsWidth` and its zoom ([Zoom](lists.md#zoom)).
  - `TaskRowsViewState.detailsWidth` is the task rows' details width in px, set by their divider. Absent, the default split.
  - `pickDetailsWidth` keeps any finite number ≥ 0, rounded and capped at `DETAILS_WIDTH_MAX` (4000): a very wide list's divider can store more.
  - `ListZoom` is `stacked`, `rows` or `lines` (`LIST_ZOOMS`, most detail first; `isListZoom`). Absent, Settings' Default list zoom.
  - Its prompt picks are temporary, in `list-widget-store`.
- A Breakdown (`BreakdownViewState`): its sort per split.

### The table of kinds

`WIDGET_KIND_SPECS` is the one table of kinds, in menu order. For each kind it holds:

- its `label` (`widgetKindLabel`; `UNKNOWN_WIDGET_LABEL` for a kind this build doesn't know);
- `showsList`: a new tab shows a list, made before the tab is added;
- its `group`, the add-widget menus' heading;
- `glance`: a glance widget. A track of them may shrink to 64px, a cell of them to 72px wide;
- `fitHeight`: a row track fits its content when the cells lying only in it hold only such tabs (`utils/workspace-rows`);
- `newTab(id, seed)`, with the default config. A new calendar shows both date types.

These derive from it: `WIDGET_KINDS`, `isWidgetKind`, `createTab(kind, id, seed?)`, the menus, the add-widget buttons, tab titles and the e2e fixture's defaults.

- `isWidgetKind` is the accepted set the layout import check uses: the stored ids, `lens` included. Renaming `lens` would need a migration.
- `layout-shape` and `WidgetBody` switch over every kind, so a new kind doesn't compile without a case.

## The rule

**Edit mode changes the grid; what's inside a cell changes in place.**

- Cells, rows and columns change only in the [layout edit mode](layout-edit-mode.md): split, merge, insert, close, a cell or a tab moved to another cell.
- These change in place: a cell's tabs, a Numbers strip's Numbers, a widget's kind and settings, the row's collapse, the dividers.
- One grid change is made outside the mode: a divider's Alt-drag, which breaks part of a line off into a new one. It is an undo step like any other.
- In the UI, an empty cell's **Edit layout** link has the tooltip `Change the grid: rows, columns and cells`.

## Rendering

`WorkspaceView` draws one CSS grid. `utils/workspace-table` builds `grid-template-*` from the tracks, and each cell is placed by `grid-area`.

| Track | Size |
|-------|------|
| weighted | `minmax(<its cells' minimum>px, <share>fr)` |
| fixed | its px |
| fit row | `auto` |
| collapsed row | a header's 32px |

The table scrolls when the minimums don't fit. The minimums (`utils/workspace-rows`):

- a cell: `CELL_MIN_PX` high and 120px wide;
- a glance cell: 64px high and 72px wide;
- a cell of Numbers (one, or a strip): 58px high, a fit row's height.

## Dividers

`WorkspaceDivider` draws one divider per stretch of grid line between two cells' edges (`edgeStretches`). A line parts at each "+" crossing, where the perpendicular line is an edge on both sides, but runs on at a "T". A row line beside a collapsed row has no divider. Dividers work the same in and out of the layout edit mode (`utils/divider-moves`).

### Plain drag and Alt + drag

- **A plain drag moves the whole grid line** the divider lies on, across its "+" crossings.
  - It is live, reweighting the line's two tracks.
  - View state, saved once at the drag's end; in the mode, the draft.
- **Alt + drag breaks the divider's own piece off** its line. Alt can be pressed or let go mid-drag.
  - The piece goes onto another line (a piece snapped back onto a line re-joins it), or onto a new line and track where it stops. The cells crossing that track gain a span.
  - A structural edit: saved at once, an undo step; in the mode, a step of the draft.
  - It is previewed while the drag runs: the table draws the result, every cell (the same element) at the size and place the release gives it.
  - The preview is `workspace-store.resizePreview`, transient view state: never saved, never an undo step. Esc puts the table back.
- Either drag snaps onto any line of its axis within 8px (`EDGE_SNAP_PX`), also one that only other columns' or rows' cells lie on. A faint accent guide shows along that whole line while it holds (`SnapGuide`).
- Neither takes a cell under its minimum.

### Keys, double-click, light and tooltip

- The arrow keys step the whole line 16px, Alt + arrow the piece. The focus stays on the divider, and a run of key steps is one undo step.
- A double-click evens the whole line's two weighted tracks.
- Alt + double-click moves part of a line midway between its own cells (`evenStretchDelta`), an undo step.
- Its hover (after 120ms), focus and drag light what it moves: the whole line across the table (a sibling line element), or with Alt its piece alone (`data-break`).
- Its tooltip says `Drag to resize · Alt-drag to split the line`, with no Alt part on a line that is one piece. Beside a fit row it says `Drag to resize · Double-click to fit`.
- The keyboard shortcuts list has an `Alt-drag` row.

### A fit row's divider

A Numbers-only (fit) row's line has a divider too ([Fit rows](widget-chrome.md#fit-rows)).

- Its drag gives the row a fixed height, its track's `fitPx`: view state, saved at once. It wins over `auto`.
- A double-click clears it and the row fits again.

### A drag moves only its own line

- Beside a fit or fixed (`px`) track, the weighted track across the line gives or takes the px. It is re-weighted from the sizes measured at the drag's start, so every other weighted track keeps its size (`workspace-layout-ops.weightedTo`).
- Two weighted tracks keep their summed weight.
- A weighted track held at its cells' minimum first has every weight set to its drawn share (`drawnByWeight`).
- A line's place counts the gaps between tracks (`MoveEdgeOptions.gap`), so part of a line moved into or past other tracks stays under the pointer and the other lines stay put.
- So the divider follows the pointer, and a fit row's other edge stays.
- A double-click's clear likewise hands the height back to the row across the clicked line (`withRowDrawnAt`).

## The normal workspace

Outside the mode there are no grips and no crossing handles, and nothing drags a whole cell. A tab only reorders inside its own strip (a cell's tab strip, or a Numbers strip's middle: `workspace-drop.ownStripHit`), with the strip's insert line and no ghost.

## Adding a widget

**Adding a widget opens nothing.** Every kind draws something by default:

- a new list is `New list` (`New list 2`, …) and shows every open task;
- a Number counts every open task;
- a chart splits them.

Its editor is in its ⋯: **Edit list…**, **Edit number…**, **Edit breakdown…** / **Edit pivot…**, **Edit chart…**.

Ways to add one, besides the cell menu's **Add widget as tab ›** ([Widget chrome](widget-chrome.md#the-cells-menu)):

- The strip's add-tab `+` opens the kinds (`AddWidgetFlow`).
- **An empty cell** shows a quiet placeholder: `Add a widget`, the kinds by group (`AddWidgetButtons`, each added as its tab), and an **Edit layout** link (the mode, this cell selected).
- The palette's **Add Widget ›** adds the picked kind as a tab of the cell last used: the focused one, else the cell of the list tab the zoom and review commands act on, else the first in reading order; in an empty layout, its first cell. It has no Where step, and its second step keeps its search.

A list tab is never pointed at another list: **Add widget as tab ›** List makes a new list, and Edit list's **Copy from…** copies another's setup ([Lists](lists.md)).

## Layout autosave

A layout has no Save. The detail is in [Layout autosave](layout-autosave.md):

- Outside the layout edit mode every structural edit is written at once and is one undo step. The lists the layout owns that it no longer shows are deleted in the same write, and Undo brings them back.
- View state saves at once too, with no undo step.
- A write that fails keeps what is on screen and offers `Couldn't save · Retry`.
- Nothing about a layout is ever unsaved, so a layout switch asks nothing.

## Hue and icon

- A layout's optional **hue** colors its tab, its cells' top lines and headers, and the focus ring inside it. Absent, they take the app accent.
- `WorkspaceLayout.hue` is a preset's name (`HUE_NAMES`: teal, violet, blue, green, amber, rose; `isHueName`) or a hex color the user picked (`utils/layout-hue.isLayoutHue`).
- It is set with the name in **Name, icon and hue…** (the layout tab's menu and the picker; the dialog of that name) and saved at once like the name: `layoutRepository.rename(id, name, hue)`.
- So is its optional **icon** (`WorkspaceLayout.icon`, an `IconValue`), in the dialog's Icon row between Name and Hue (the shared icon picker):
  - absent, the layout glyph; **No icon**, none;
  - drawn before the name on its tab, in the picker and on the phone;
  - a line icon and a muted emoji are gray at rest and in the hue on the open tab; a color emoji keeps its own colors.

## Reading a stored layout

Stored layouts are read through the layout repair (`data/layout-shape`; see [Models and data](../models-and-data.md)):

- A part this build can't use is dropped.
- A tiling that doesn't hold is rebuilt as the cells in their reading order, stacked in one column.
- The repair stays in memory, with a notice, until the layout's first edit writes it. View state isn't written before that.

In the code:

- `layoutRepository.getAll` and `get` return `ReadLayout`s, `{ layout, fixes }`. Each row goes through the `layouts` picker (`rowFixes` / `sanitizeRow`, that is `pickLayoutBody`).
- A part this build can't use (an unknown widget kind, a bad id, size or setting) is dropped or reset in memory and named in `fixes`. The stored row is untouched.
- A layout may come out with no cells. It is never dropped.
- A repaired layout (`ReadLayout.fixes` not empty) opens without the bad parts, and its id goes into `workspace-store.repairedIds`. The snackbar says `Repaired layout "<name>" — <fixes>. Your next change to it keeps the repair.`, and the repair is logged too.

Nothing writes the repair back on open:

- Its view-state edits stay in memory: `updateView` skips it.
- `load` writes only `lastUsedAt`, and `rename` only the name, the hue and the icon.
- Its first structural edit writes the whole layout, repair and view state, and drops it from `repairedIds`.
- That edit also removes the lists only the dropped parts named, as part of its step. An undo of that first edit doesn't bring them back: the repaired table doesn't show them either.

## On a phone

`MobileWorkspaceView`:

- Every cell shows in reading order (by its top track, then its left) in one vertical scroll.
- A run of Number cells is two up while each gets 140px.
- The same [tabs-on-demand](widget-chrome.md#tabs-on-demand) rule: with one widget there is no tab row and its top line holds the ⋯. A face with no top line has none; collapsed, such a cell (a Number's) has its own **Expand row** button.
- No layout editing: no pencil and no **Edit layout** in any menu. An empty cell reads `Empty cell` and `To create or edit layouts, use a wider screen.`
- The mode closes if the window narrows to a phone's.
