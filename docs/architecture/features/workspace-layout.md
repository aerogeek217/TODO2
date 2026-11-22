# Workspace layout

A layout is one table: grid tracks across and down, and cells that each cover a rectangle of tracks and hold a strip of widget tabs. This file covers the table, the ops that change it, how it is drawn and resized, and how a layout is saved. The model is `models/workspace-layout`; the pure code is `utils/workspace-grid`, `utils/workspace-layout-ops` and `utils/workspace-table`; `WorkspaceView` draws the table and `workspace-store` writes it.

See also [Layout edit mode](layout-edit-mode.md) (rulers, cards, slots, the tray, drops, Move / Copy to layout) and [Widget chrome](widget-chrome.md) (a cell's menu, tabs, faces, Open larger).

## The table

- `grid.columns` and `grid.rows` are lists of `GridTrack`s, `{ id, weight?, px?, collapsed? }`: a weighted track (its share of the axis) or a fixed `px` track.
- `cells`: each covers a rectangle of tracks, `area { col, row, colSpan, rowSpan }` (track indices), and holds a strip of widget tabs.
- A full-height column is a cell spanning every row track; a strip is a cell spanning every column track. Nothing nests.
- The cells tile the grid exactly (no gap, no overlap), and every grid line is the edge of some cell.
- A cell with no tabs is an **empty cell**: a split's new cell, a close with no taker, or a lone widget removed.

`utils/workspace-grid` holds:

- the queries: neighbors along an edge, whether two cells merge into a rectangle, reading order, edge stretches;
- `normalizeGrid`, which merges the two tracks beside a line no cell's edge lies on and expands a collapsed row nothing can expand ([Collapse row](layout-ops.md#collapse-row));
- `validateTiling`.

## The rule

**Edit mode changes the grid; what's inside a cell changes in place.**

- Cells, rows and columns change only in the [layout edit mode](layout-edit-mode.md): split, merge, insert, close, a cell or a tab moved to another cell.
- These change in place: a cell's tabs, a Numbers strip's Numbers, a widget's kind and settings, the row's collapse, the dividers.
- One grid change is made outside the mode: a divider's Alt-drag, which breaks part of a line off into a new one. It is an undo step like any other.
- In the UI, an empty cell's **Edit layout** link has the tooltip `Change the grid: rows, columns and cells`.

The operations that change the table are in [layout-ops](layout-ops.md).

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

A layout has no Save.

### Edits

Outside the layout edit mode every edit to a layout is written at once (`workspace-store` → `layoutRepository.putAndPrune`) and is **one undo step** with the snackbar, named plainly. An edit is anything that changes:

- a track's id or a cell's area (a divider's Alt-drag);
- a tab's place;
- a tab's config (an editor's Save, a ⋯ menu's setting);
- a tab's kind.

The steps:

- `Removed “This week”`: a widget removed by the ⋯'s **Remove widget**, a tab's × or a strip Number's ×. A lone widget's cell stays, empty.
- `Edited number “Open”`.
- `Edited layout “Default”`: the mode's **Done**, one step for the whole session.
- The arrow keys stepping one divider are one step (`UndoEntry.mergeKey`).
- A divider's move, `Moved divider`, is a step with no snackbar: the table shows it.

### Lists follow the edit

- The lists the layout owns that it no longer shows are deleted in the same write. `layoutListRefs` says what it shows: list tabs, and Numbers that follow a list. A Review widget's filter is temporary and names none.
- Undo brings back those lists first, then the table as it was, carrying the view state of the moment (`utils/workspace-layout-view.withViewStateOf`: sizes, collapse, active tabs, tabs' view state). Redo removes them again.
- Either runs only while that layout is open. Else it says `Open layout “X” to undo: …` and the step stays on the stack.
- The step is dropped once the layout is gone.
- Undo doesn't survive a reload.

### View state and order

- View state saves at once too, with no undo step (`layoutRepository.updateView`): track sizes from the dividers (a weighted track's weight, a fixed one's px), collapsed row tracks, each cell's active tab, calendar view, row details width.
- A divider drag's frames are written once, at its end.
- Writes run in the order made, so a view change made right after an edit lands on top of it.
- The layouts' order saves at once too; a reorder is one undo step (`workspace-store.reorderLayouts`).

### A failed write

- A write that fails keeps what is on screen and says so: `Couldn't save · Retry` beside the layout tabs (`writeFailed`).
- The next write of the layout (any edit, or **Retry**) writes all of it.
- Leaving the layout tries once more first, and stays put when that fails too.

### Nothing is unsaved

Outside the mode nothing about a layout or a list is ever unsaved, so nothing asks on a layout switch, on leaving the route or on closing the tab. Only an open editor with changes asks when it is left: Edit list, a widget editor, the mode's draft ([Popovers and editors](popovers-and-editors.md)).

## Hue and icon

- A layout's optional **hue** colors its tab, its cells' top lines and headers, and the focus ring inside it.
- It is set with the name in **Name, icon and hue…** (the layout tab's menu and the picker; the dialog of that name) and saved at once.
- So is its optional **icon** (`WorkspaceLayout.icon`, an `IconValue`), in the dialog's Icon row between Name and Hue (the shared icon picker):
  - absent, the layout glyph; **No icon**, none;
  - drawn before the name on its tab, in the picker and on the phone;
  - a line icon and a muted emoji are gray at rest and in the hue on the open tab; a color emoji keeps its own colors.

## Reading a stored layout

Stored layouts are read through the layout repair (`data/layout-shape`; see [Models and data](../models-and-data.md)):

- A part this build can't use is dropped.
- A tiling that doesn't hold is rebuilt as the cells in their reading order, stacked in one column.
- The repair stays in memory, with a notice, until the layout's first edit writes it. View state isn't written before that.

## Duplicate layout

**Duplicate layout…** (the open layout's tab menu and the picker) stores a copy as a new layout, its lists copied with their manual order.

## On a phone

`MobileWorkspaceView`:

- Every cell shows in reading order (by its top track, then its left) in one vertical scroll.
- A run of Number cells is two up while each gets 140px.
- The same [tabs-on-demand](widget-chrome.md#tabs-on-demand) rule: with one widget there is no tab row and its top line holds the ⋯. A face with no top line has none; collapsed, such a cell (a Number's) has its own **Expand row** button.
- No layout editing: no pencil and no **Edit layout** in any menu. An empty cell reads `Empty cell` and `To create or edit layouts, use a wider screen.`
- The mode closes if the window narrows to a phone's.
