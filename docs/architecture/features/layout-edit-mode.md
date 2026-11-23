# Layout edit mode

The layout edit mode is where a layout's grid changes: cells, rows and columns are split, merged, inserted, closed and moved on a draft that is written only on **Done**. It is desktop only: the phone has no way in, and narrowing the window to a phone's closes it.

Its session is `workspace-store.editing`. Its bar is `LayoutEditBar` (`components/layout/`); its other components are under `components/workspace/`, over the pure rules in `utils/layout-rulers`, `utils/layout-edit-cards`, `utils/structure-preview` and `utils/workspace-drop`.

See also:

- [Workspace layout](workspace-layout.md): the table model, the dividers and autosave;
- [Layout ops](layout-ops.md): what each split, insert, merge, remove and close does to the table;
- [Widget chrome](widget-chrome.md): tabs, faces, the cell menus outside the mode and Open larger;
- [Move / Copy to layout](cross-layout-moves.md): widgets carried to another layout, which opens in the mode with them in hand.

## Opening the mode

There is no button for it in the top bar. It opens from:

- **Edit layout…** in the open layout's tab menu and in the picker;
- the palette's **Edit Layout**;
- the editable `edit-layout` shortcut (no keys by default);
- **Edit layout** at the end of a cell's ⋯ / right-click menu, with that cell selected (`selectedCellId`: an accent ring).

Each calls `workspace-store.enterEdit({ cellId? })`, which:

1. asks an open editor holding changes first (`editor-leave.leaveOpenEditors`);
2. lets the layout's writes land. A failed one is retried; when it fails again the mode doesn't open;
3. closes every editor (`closeOpenEditors`), the widget popup, the filtered-tasks panel and the snackbar;
4. registers the mode as a layout-wide editor in `editor-leave`.

## The draft

While the mode is on, `working` is a **draft** and `saved` the layout as stored. Nothing is written.

The session is `editing: LayoutEditSession | null`: its `layoutId`, its `selectedCellId`, the mode's own `undo` / `redo` stacks of layout bodies, `createdLists` (the lists made in the session) and `showContent` ([Blueprints](#blueprints)).

- Every structural edit changes only the draft and is a step of **the mode's own undo**: a card's menu, toolbar, keys, corner and drags (cards, tabs, a strip's Numbers, tray chips — with the ghost), a slot's kinds, the edge tabs, the merge buttons, the headers' menus, the dividers, a tab's ×. The store's `edit()` puts the draft's body from before the edit on the mode's undo stack instead of committing. Steps under one merge key merge there too.
- Resizes and view state change only the draft, through `editView`: every resize (`setTrackSizes`, `copyTrackSizes`, `clearTrackFitPx`, `endResize`), an active tab, a collapse, a tab's view state.
- Ctrl+Z / Ctrl+Y and the palette's Undo / Redo step the mode's stack (`undoEdit` / `redoEdit`, which keep the view state of the moment: `withViewStateOf`). With it empty they do nothing (never a task step behind it).
- `layoutEditChanged` says whether the draft differs from the layout as stored, view state included (`layoutBodyEqual`).

Refused meanwhile:

- a layout undo or redo step: `UndoRefused`, `Finish editing the layout to undo: …`;
- a rename / hue / icon (`rename`) and the layouts' order (`reorderLayouts` / `moveLayout`): `Finish editing the layout first.`;
- Retry (`retryWrite`), which says nothing.

The workspace is tinted under a faint dot grid with an accent outline (`--edit-*` tokens). Each cell's content stays mounted but dims and takes no presses: each cell is a [card](#cards), its surface under the content, its ⋯ and corner over it. The table steps in for [room](#the-room-and-the-headers).

## The mode's bar

The top bar's contents give way to the mode's bar (`LayoutEditBar`): `Editing “X”`, the layouts' tabs disabled, the widget [tray](#the-tray) (`LayoutEditTray`), the **Content** toggle ([Blueprints](#blueprints)), **Undo**, **Redo**, **Cancel**, **Done**.

The focus goes to **Done** as the mode opens, and back where it was on leaving. With widgets in hand from another layout ([Move / Copy to layout](cross-layout-moves.md#placing-the-widgets)) **Done** is off, so **At the bottom** takes it.

## Done, Cancel and leaving the layout

**Done** (`finishEdit`) first deletes the lists the session made that the draft doesn't show. Then:

- A draft whose structure changed is committed as one write and one undo step: `commitEdit(saved, draft, 'Edited layout “X”')`. Its Undo brings back the lists the edit dropped, as any layout edit's Undo does (autosave, in [Workspace layout](workspace-layout.md)).
- A draft that differs only in view state is written as view state, with no undo step.
- With no change it just leaves.

**Cancel** (`cancelEdit`) asks nothing: `saved`, the stored layout, comes back. With changes, the snackbar offers `Layout changes discarded · Restore`: the session, the draft and its undo steps back, the mode open again. Restore works while the layout is still open and structurally as it was.

- The lists made in the session (`createListAndTab` records them through `noteEditList`) are deleted only once that offer is gone without Restore: timed out, dismissed or replaced (the `undo-store` notice's `onEnd`).
- Till then `discardedLists` holds them, and no list chooser offers them (Copy from…, a Number's Follow a list) — nor, in the mode, a list it made and then undid, which the draft doesn't show. Both are `workspace-store.listsHeldByEdit(state)`, read through `hooks/use-held-lists`.

**Leaving the layout.** The mode is a layout-wide editor in `editor-leave`, asked only by `leaveLayout` ([Popovers and editors](popovers-and-editors.md)), so a cell's split, merge or close inside the mode never questions it. `load`, `createLayout`, `duplicateLayout` and `delete` go through `editor-leave.leaveLayout`.

- With changes, leaving asks **Save** / **Discard** / **Keep editing**: a layout switch (tabs, picker, palette, shortcut), Settings, an in-app route change, New / Duplicate / delete layout, Esc. The question is `askLeaveEdit`, over `ui-store.askChoice`, one question at a time. Its Discard is `discardEdit`, which deletes the session's lists at once.
- With none it just leaves (`leaveEdit`), its lists deleted the same way.

**Closed from outside.**

- Where nothing can ask (the workspace page gone, the window narrowed to a phone's), `dropEdit` closes it and, when it held changes, says `Edit layout closed: its changes weren’t saved.`
- A data replace closes it with the same notice (`endEditForReplace`, called by `services/refresh-all`). It drops a pending Restore without deleting the lists: their ids may name other lists in the new data.
- A reload or a closed tab drops the draft silently; the next launch's `init()` prune deletes the lists it made. A second browser tab's prune may delete one sooner.

## The room and the headers

While the mode is on the table makes room for its controls, so the cards get a little smaller:

- a **frame** round it — its padding: 26px top and left for the headers (`--edit-frame-start`), 14px right and bottom (`--edit-frame-end`); the workspace's own top and bottom padding move into it;
- **16px gaps** (`--edit-gutter`, which the table's `--workspace-gutter` takes inside it; `workspace-table.EDIT_GUTTER_PX` sizes its tracks' minimums). The dividers stay in the gaps and resize as outside the mode, their line drawn in the gap's middle.

Everything that reads the table's geometry measures it — the dividers, `measureWorkspace` (the drop zones and the ghost), a corner's stretch, the ruler names — so nothing holds a second copy of the frame or the gap.

`LayoutRulers` draws the **headers** in the frame, over its rules in `utils/layout-rulers`: A, B, C… over the columns, 1, 2, 3… beside the rows. They are grid items of the table drawn into its padding, so they scroll with it and no track makes room for them.

- A column's share shows on its header's hover (a percent of the weighted columns, a fixed one's px). A row is marked `fit` / `folded`.
- The selected card's columns and rows are lit (`data-lit`).
- Each is a button (`Column B options`) opening its menu.
- A row header takes no part in sizing its row (`contain: size`), so a fit row keeps its height.

### Header menus

- A column: **Insert column left** / **right** · **Even all widths**, then **Remove column**.
- A row: **Insert row above** / **below** · **Collapse row** / **Expand row** (off while no filled cell lies only in it) · **Even all heights**, then **Remove row**.
- Under **Remove column** / **Remove row**, a line names what goes where: `Status joins Tasks for… as a tab.`, `Notes moves into the row above.`, `The Numbers strip (Open and Overdue) joins Tasks: its Numbers become tabs.`

### Slivers

Only **major** tracks are lettered and numbered. A **sliver** is a track drawn under 24px (`SLIVER_PX`, the table's computed tracks) with no cell lying only in it, as a part line moved a few px leaves.

- It gets an unlabeled tick in the header band, on the sliver's start, whose menu offers **Merge into A** / **B** (`mergeTrackInto`).
- A sliver and its two lines act as one line for an insert (`layout-rulers.sliverRun`): an edge tab, or a header's Insert above / below beside a sliver, merges the sliver away and inserts on the line left (`insertTrackAt`'s `through`). So a part line moved a few px doesn't turn a full row into half a one.

### Keys

- Headers are Tab stops, first in the table: columns, then rows.
- Enter / Space opens a menu; Esc closes it with the focus back on its header.
- Every track action goes through `edit()`: a mode undo step on the draft. Even all is a size change: view state, as a divider's.

## The selection

Nothing is drawn on the cards until one is selected. Then `EditSelection` draws its controls in the table, placed by the table's own coordinates (it is positioned in the mode), from the table as the draft draws it. They are frozen while a preview reflows it, so the one under the pointer stays put while the others fade. The table puts them right after the selected card, so they follow it in the Tab order. They are gone while something is dragged.

### Edge tabs

Four worded tabs sit in the seams at the middle of the selection's edges: `+ Row above`, `+ Row below`, `+ Column left`, `+ Column right` (a column's runs down; named `Insert row above` …). A slot selected has them too.

- Each is a full row / column on that edge's line, as a header's Insert makes (`insertTrackAt`, a sliver run counted), sized from the selection's own track.
- Hovered, it previews (below). Clicked, it inserts and selects and focuses the first new cell.
- With widgets in hand from another layout, the new track holds them ([Move / Copy to layout](cross-layout-moves.md#placing-the-widgets)).

### Previews of an edit

While an edge tab, a toolbar's Split, a merge button or a Merge ▾ entry is hovered, the table draws the layout the edit would leave.

- The preview is `workspace-store.structurePreview`, transient: never saved, never an undo step. It is a `StructurePreview`: the probe's body, its new cell ids, the filled cells it grows, the words on their outline and its `hint`. `utils/structure-preview.structureProbe` runs the op on probe ids (`insert-preview`: `insertPreview`, `splitPreview`, `mergePreview`).
- `setStructurePreview(preview | null)` sets it only while the mode is on. Every structural edit, the mode's undo / redo, Cancel and the mode's end clear it.
- The new track's empty cells are solid accent slots (`data-preview-new`); the cards that grow across it are outlined in the follow-up color with `stretches` (`data-preview-grew`); no dividers meanwhile.
- A merge draws the merged cell outlined, its tabs the selection's then the neighbor's; the neighbor stays mounted, hidden under it (`absorbedCellIds`).
- The mode bar says it in the tray's place: `Row between 1 and 2 · Notes stretches across it · click to insert` (`layout-edit-preview-hint`).
- A preview starts on a pointer move with no button held, never on an enter: a control appearing under a resting pointer previews nothing. Leaving it puts the table back.

### Merge buttons

Each neighbor that makes a rectangle with the selected card (`layout-edit-cards.mergeChoices`: it shares a whole edge, `mergeNeighbour`) carries a button, centered under its name. It is worded from the selection's side, with an arrow from the selection towards it (`mergeButtonWords`); the name is the neighbor's active widget's title:

- `↑ Merge as tabs with Tasks for…`;
- `Merge with Overdue` when both cells hold only Numbers: they stay one strip;
- `Stretch over this slot` on an empty slot.

A neighbor under 230px shows `Merge as tabs` / `Merge` / `Stretch here`, the whole words its tooltip and description. Hovered it previews; its hint is `Merge Calendar with Tasks for… · one cell, 5 tabs · click to merge`. Clicked it runs `mergeCells(selected, neighbor)`, one mode undo step; the merged cell keeps the selection and the focus. No button where no rectangle can be made.

## Cards

In the mode every cell is a card (`components/workspace/EditCard` + `edit-card-actions`).

### The surface

The card's **surface** (`data-edit-surface`, a Tab stop) lies under the card's dimmed content, which takes no presses (`data-edit-layer`), so a press anywhere on the card lands on it.

- A drag (past dnd-kit's 5px) moves the whole card through the [drop model](#drops-in-the-mode).
- A short click selects it (`selectEditCell`, the accent ring, `data-edit-selected`) and **arms a move**.

With a move armed, the mode bar's tray gives way to `Click a slot to move “X” there, a card to swap, or its tab bar to join it · Esc cancels`. The next click:

- on a slot moves the card there;
- on another card's middle swaps the two;
- on its tab area (its strip, a one-widget card's top band) joins them as tabs;
- near its edge selects that card instead;
- on the armed card again disarms.

These are the zones a drop reads: `workspace-store.tapEdit` over `utils/layout-edit-cards.tapOutcome`, WCAG 2.5.7's single-pointer way.

A card's tabs (its strip's `role=tab`s, which still take presses) and a Numbers strip's Numbers (each slot a tab's drag, their insides inert) drag on their own to another card or slot. A Number dropped in a strip's middle joins it.

### Blueprints

A card is a blueprint: its body stays mounted but hidden, and `EditBlueprint` names it — its active widget's icon, name and kind, centered (on one line in a short card).

- A card of tabs keeps its live tab strip over it: its tabs drag, a drop there joins.
- A Numbers strip keeps its Numbers, each dragging on its own; it has no blueprint.
- The mode bar's **Content** toggle (an eye; `setEditContent(on)` sets `editing.showContent`, the session's only) shows the dimmed widgets instead.

### Label, ⋯ and corner

The card's chrome sits over the content, in the card's own corners.

- Its **label**:
  - a one-widget card: the widget's icon and name, shown on the card's hover, focus or selection — only with **Content** on (a blueprint names the card itself);
  - a Numbers strip: `N Numbers`, on the same hover, focus or selection;
  - a card of tabs: none over its strip — unless the strip is squeezed to its active tab with the title cut away, in a narrow card: then that tab's name, under the strip (`data-strip-squeezed`).
- Its **⋯**, named **Cell layout** — the toolbar's while the card is selected.
- Its **corner** (`data-edit-corner`).

The ⋯ and the corner show on the card's hover, focus or selection (always on touch). The label gives way to the toolbar.

### The selected card's toolbar

`EditCardToolbar` sits inside the selected card, at its top-left — under its tab strip when it has one, so the strip stays free to drag. It never leaves the card: it wraps in a narrow one and rises in a short one. It is absent while something is dragged, and fades while a preview shows unless it is under the pointer. Each action is a step of the mode's undo.

- **Split →** and **Split ↓**: each hovered, the table draws the split (`splitPreview`).
- **Merge ▾**: the same neighbors as the merge buttons — `As tabs with Tasks for… (above)`, `With Overdue (below)`, `Over the empty slot (right)` (`mergeMenuWords`) —, each previewing while hovered; off with none.
- **Remove**: the active widget (**Remove widget** / **Remove tab**).
- **⋯**: the card menu, standing in for the card's corner ⋯.

In a card under 330px its buttons are icons with their names as tooltips, decided while no preview reflows the card. A slot selected has no toolbar: its click opens the widget kinds.

### The card menu

It opens from the ⋯, a right-click anywhere on the card, or Enter on it (`cell-menu.editCardMenuEntries`, `EditCardMenu`).

- **Move to ▸**: every slot by its header name (`B4`) — `layout-edit-cards.cellRulerName` over the headers' `trackNames`, lent by the table through `layout-edit-view`.
- **Swap with ▸**: every other card by name, its place beside it (`swapCells`).
- **Join as tabs ▸**: the same cards. This card's tabs join the picked one — the keys' way to a drop on its tab area.
- **Insert ▸**: **Row above** / **Row below** / **Column left** / **Column right**, a full track on the card's edge line (`workspace-store.insertTrackBeside`), its first new cell selected — the keys' way to the edge tabs. Then **Split this cell**'s **New cell above** / **left** / **right** / **below**.
- **Merge with ▸**: off, saying why, unless the two make a rectangle.
- **Stretch right** / **Stretch down**: one track, over empty slots only.
- **Move cell to layout ›** / **Copy cell to layout ›**: see [Move / Copy to layout](cross-layout-moves.md).
- **Remove widget**: the card's active tab, its cell left a slot (**Remove tab** on a card of tabs).
- **Close cell**: the absorb rule ([Layout ops](layout-ops.md)); `(N tabs)` on a card of tabs.

### Stretch

The corner dragged grows the card from its top-left over empty slots, track by track; shrinking leaves slots.

- A track counts once the pointer passes its middle (`trackReached` / `cornerArea`).
- The table draws where it lands while it runs (`ws-stretch-ghost`, labeled `Stretch · A2–B2`).
- Esc puts it back; the release stores it with `setCellArea` (`workspace-layout-ops`).
- `setCellArea` is valid only over the cell's own places and empty cells, which it absorbs or cuts into rectangles. The places it leaves become empty cells, cut the same way.

### Keys on a card

| Key | What it does |
|---|---|
| Arrows | Move the selection (and the focus) to the card or slot beside it — `spatialNeighbour`: the one sharing the most of that edge |
| Shift+arrow | Stretches the card one track from its bottom-right corner: right / down grow, left / up give one back (`stretchedArea`) |
| Alt+arrow | Moves it onto the slot beside it, or swaps it with the card there (`altMove`) |
| Enter / Shift+F10 / the Menu key | Open its menu |
| Space | A tap |
| Delete / Backspace | Runs **Remove widget** on its active tab (the card's accessible name says so) |

The focus stays on what moved (`edit-focus.focusEditItem`, by `data-edit-focus`).

## Slots

An empty cell is a slot (`EditSlot`): dashed, named by the headers (`Empty slot B4`), its close × kept.

- It is a Tab stop: the arrows as a card's, Delete closes it.
- A click opens the widget kinds (`AddWidgetFlow`, Tasks / Insights), the new widget filling it — a List with its list through `createListAndTab`, whose ids the session records.
- With a card armed, a click moves that card there instead.

## The tray

`LayoutEditTray` sits in the mode bar's `data-layout-edit-tray`.

- It shows the common kinds as chips (List, Calendar, Notes, Number, Breakdown) and **More ›** with the rest.
- A chip dragged onto the workspace is a new widget's drag: `workspace-drag.beginNewWidgetDrag` → the page's drag state, source `{ type: 'new', kind }`. Its own pointer-up drops it and Esc cancels it; the drop model decides and the ghost labels it.
- A click adds the kind to the selected slot or card (`widget-hooks.addWidgetKindAt`, a Breakdown a Custom one).
- It scrolls sideways when the bar is narrow, so the bar never overflows.

Outside the mode none of this is drawn.

## Drops in the mode

Drops act on the draft. `utils/workspace-drop` works on the geometry `measureWorkspace` takes when a tab or cell drag starts — again while the table scrolls under it.

### Drop zones

| Where the pointer is | What the drop does |
|---|---|
| The layout's left / right edge: its frame and 18px past it (over a narrow edge cell's body: no further than half of its own side split zone) | Inserts a column |
| The layout's top / bottom edge: its frame and 18px past it, reaching 16px outside | Inserts a row |
| A cell's strip | Takes a tab at an index |
| A one-widget card's **tab area** | Joins as a tab after its widget |
| A cell body's outer 20 % (at most 120px) on each of its four sides | Splits on that side |
| A cell body's middle | A tab or a tray chip's widget joins as a tab; **a whole card swaps** with it |
| An empty cell (a slot) | A tab or a tray chip's new widget fills it; a whole card moves into it |

- The frame is where the cells start in from the workspace's edge (`measure.measureFrame`): 6px outside the mode, the headers' band and margin in it.
- A cell with one widget has no strip: its whole card is its body. But in the mode its top band is its tab area (`workspace-drop.tabBand`): a header's height, at most 35 % of the card, where its label sits; measured only in the mode (`measure.cardTabArea`). The split-above zone lies below it.
- A swap is `{ kind: 'swap' }`: the two cells trade places whole, every tab with them.
- A whole card moved into a slot swaps places with it (`movePanel` onto an empty cell is `swapCells`), so its old place is a slot and a move never grows a card over where it was.

### The ghost

One ghost (`dropGhost`, drawn by `DragOverlayLayer`) shows the result: the move run on a probe copy of the layout, and the cell that ends up holding what is dragged placed from the drag-start geometry.

A fit row of the result is drawn at the height the browser will draw it (`fitRowHeights`), so the ghost is the landed cell also when a drop changes which rows fit:

- one that was a fit row: its drawn height;
- a new one, or one the drop leaves holding only Numbers: the fit row its cells came from, else the lowest fit row drawn, else a Number's 58px.

| Drop | The ghost's label |
|---|---|
| A split | `Split Late · above` |
| A row inserted | `Insert row · full width` |
| A column inserted | `Insert column · full height` |
| A join | `Add as tab` (`Add N tabs`) |
| Into a Numbers strip | `Add to strip` |
| A swap | `Swap with “Tasks, Notes + 1”` (the other card by its name) |
| Onto a slot | `Move here` (a card) or `Add here` |

The ghost fades in at each new spot (reduced motion: at once).
