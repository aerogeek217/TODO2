# Layout edit mode

The layout edit mode is where a layout's grid changes: cells, rows and columns are split, merged, inserted, closed and moved on a draft that is written only on **Done**. It is desktop only: the phone has no way in, and narrowing the window to a phone's closes it.

Its session is `workspace-store.editing`. Its bar is `LayoutEditBar` (`components/layout/`); its other components are under `components/workspace/`, over the pure rules in `utils/layout-rulers`, `utils/layout-edit-cards`, `utils/structure-preview`, `utils/workspace-drop` and `utils/layout-transfer`.

The table model, the layout ops, the dividers and autosave are in [Workspace layout](workspace-layout.md); tabs, faces, the cell menus outside the mode and Open larger in [Widget chrome](widget-chrome.md).

## Opening the mode

There is no button for it in the top bar. It opens from:

- **Edit layout…** in the open layout's tab menu and in the picker;
- the palette's **Edit Layout**;
- the editable `edit-layout` shortcut (no keys by default);
- **Edit layout** at the end of a cell's ⋯ / right-click menu, with that cell selected (`selectedCellId`: an accent ring).

Opening asks an open editor holding changes first, then closes every editor, the widget popup, the filtered-tasks panel and the snackbar.

## The draft

While the mode is on, `working` is a **draft** and `saved` the layout as stored. Nothing is written.

- Every structural edit changes only the draft and is a step of **the mode's own undo**: a card's menu, keys, corner and drags (cards, tabs, a strip's Numbers, tray chips — with the ghost), a slot's kinds, the rulers, the dividers, a tab's ×.
- Resizes and view state change only the draft.
- Ctrl+Z / Ctrl+Y and the palette's Undo / Redo step the mode's stack and, with it empty, do nothing (never a task step behind it).
- Layout undo steps refuse meanwhile (`Finish editing the layout to undo: …`), as do a rename / hue / icon, Retry and the layouts' order.

The workspace is tinted under a faint dot grid with an accent outline (`--edit-*` tokens). Each cell's content stays mounted but dims and takes no presses: each cell is a [card](#cards), its surface under the content, its ⋯ and corner over it. Nothing moves.

## The mode's bar

The top bar's contents give way to the mode's bar (`LayoutEditBar`): `Editing “X”`, the layouts' tabs disabled, the widget [tray](#the-tray) (`LayoutEditTray`), the **Content** toggle ([Blueprints](#blueprints)), **Undo**, **Redo**, **Cancel**, **Done**.

The focus goes to **Done** as the mode opens, and back where it was on leaving. With widgets in hand from another layout **Done** is off, so **At the bottom** takes it.

## Done, Cancel and leaving the layout

**Done** commits the draft as one write and one undo step, `Edited layout “X”`.

- Its Undo brings back the lists the edit dropped, as any layout edit's Undo does (autosave, in [Workspace layout](workspace-layout.md)).
- A draft that differs only in view state is written as view state, with no undo step.
- With no change it just leaves.

**Cancel** asks nothing: the stored layout comes back. With changes, the snackbar offers `Layout changes discarded · Restore`: the draft and its undo steps back, the mode open again.

- The lists made in the session (`createListAndTab` records them) are deleted only once that offer is gone without Restore.
- Till then no list chooser offers them (Copy from…, a Number's Follow a list) — nor, in the mode, a list it made and then undid (`workspace-store.listsHeldByEdit`, `hooks/use-held-lists`).

**Leaving the layout.** The mode is a layout-wide editor in `editor-leave`, asked only by `leaveLayout` ([Popovers and editors](popovers-and-editors.md)), so a cell's split, merge or close inside the mode never questions it.

- With changes, leaving asks **Save** / **Discard** / **Keep editing**: a layout switch (tabs, picker, palette, shortcut), Settings, an in-app route change, New / Duplicate / delete layout, Esc.
- With none it just leaves.
- A data replace closes it: `Edit layout closed: its changes weren’t saved.`
- A reload or a closed tab drops the draft silently; the next launch's prune deletes the lists it made.

## The rulers

`LayoutRulers` is mounted first in the table while the mode is on; its rules are in `utils/layout-rulers`. The rulers are grid items of the table itself, overlaid on the gutters and the cells' outer edges, so no cell moves.

- The strips are 16px; the card's ⋯ sits 16px down to clear the "+"s.
- A row ruler takes no part in sizing its row (`contain: size`), so a fit row keeps its height.
- The workspace's top and bottom padding move into the table's scroller while the mode is on.

A ruler runs along the top of each column (A, B, C…) and down the left of each row (1, 2, 3…).

- A column's tooltip gives its share: a percent of the weighted columns, a fixed one's px.
- A row is marked `fit` / `folded`.
- Each is a button (`Column B options`) opening its menu.

### Ruler menus

- A column: **Insert column left** / **right** · **Even all widths**, then **Remove column**.
- A row: **Insert row above** / **below** · **Collapse row** / **Expand row** (off while no filled cell lies only in it) · **Even all heights**, then **Remove row**.
- Under **Remove column** / **Remove row**, a line names what goes where: `Status joins Tasks for… as a tab.`, `Notes moves into the row above.`, `The Numbers strip (Open and Overdue) joins Tasks: its Numbers become tabs.`

### Slivers

Only **major** tracks are lettered and numbered. A **sliver** is a track drawn under 24px (`SLIVER_PX`, the table's computed tracks) with no cell lying only in it, as a part line moved a few px leaves.

- It gets an unlabeled tick — a pill in the ruler's strip on the sliver's start — whose menu offers **Merge into A** / **B** (`mergeTrackInto`).
- A sliver and its two lines act as one line (`layout-rulers.sliverRun`): one "+", just before the sliver, named by the majors around it (`Insert row between 1 and 2`).
- That "+" — and a ruler's Insert above / below beside a sliver — merges the sliver away and inserts on the line left (`insertTrackAt`'s `through`). So a part line moved a few px doesn't turn a full row into half a one.

### The "+" insert points

A "+" sits on every line between rulers and at both ends (`Insert row here`).

- It is a 20px disc in a 24px target: a larger one would cover the first tab of a strip along the strips.
- The first row line's is in the corner, the first column line's just right of it.
- A click inserts a full row / column there and selects its first new cell.

### Make-room previews

While a "+" is hovered the table makes room: it draws the layout the insert would leave.

- The preview is `workspace-store.structurePreview`, transient: never saved, never an undo step, cleared by every edit and by leaving the mode. `utils/structure-preview.structureProbe` runs the op on probe ids (`insert-preview.insertPreview`).
- The new track's empty cells are solid accent slots (`data-preview-new`); the cards that grow across it are outlined in the follow-up color with `stretches` (`data-preview-grew`); no dividers meanwhile.
- The mode bar says it in the tray's place: `Row between 1 and 2 · Notes stretches across it · click to insert` (`layout-edit-preview-hint`).
- The "+" itself is pinned where the pointer found it while the table reflows under it (fixed, `data-pinned`), and the table's other "+"s take no pointer meanwhile, so the preview never flickers.
- Leaving the "+" puts the table back.

### The gutter "+"

The dividers are the mode's gutters. Hovering one shows a "+" pill just beside its line (right of a column line, below a row line), so the divider stays free to drag.

- The pill follows the pointer along the line (`GutterPlus`, over `gutter-plus`'s context, which the table lends its dividers).
- It outlives the divider's leave by 250ms: time to move onto it.
- Hovered it previews; clicked it inserts on that line (a sliver's run as the rulers' "+").

### Keys and undo

- Rulers and "+"s are Tab stops in order: columns, then rows.
- Enter / Space opens a menu or inserts; Esc closes the menu with the focus back on its ruler.
- Every track action goes through `edit()`: a mode undo step on the draft. Even all is a size change: view state, as a divider's.

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
- The mode bar's **Content** toggle (an eye; `editing.showContent`, the session's only) shows the dimmed widgets instead.

### Label, ⋯ and corner

The card's chrome sits over the content, all clear of the rulers' strips.

- Its **label**:
  - a one-widget card: the widget's icon and name, shown on the card's hover, focus or selection — only with **Content** on (a blueprint names the card itself);
  - a Numbers strip: `N Numbers`, on the same hover, focus or selection;
  - a card of tabs: none over its strip — unless the strip is squeezed to its active tab with the title cut away, in a narrow card: then that tab's name, under the strip (`data-strip-squeezed`).
- Its **⋯**, named **Cell layout**.
- Its **corner** (`data-edit-corner`).

The ⋯ and the corner show on the card's hover, focus or selection (always on touch).

### The selected card's toolbar

`EditCardToolbar` is fixed above the selected card (in the top row: inside it, under its header). It is frozen while a preview reflows the table, and absent while something is dragged. Each action is a step of the mode's undo.

- **Split** → and **Split** ↓: each hovered, the table draws the split (`insert-preview.splitPreview`).
- **Swap** ▾: every other card.
- **Merge** ▾: the neighbors it makes a rectangle with; off with none.
- **Remove widget** / **Remove tab**.

### The card menu

It opens from the ⋯, a right-click anywhere on the card, or Enter on it (`cell-menu.editCardMenuEntries`, `EditCardMenu`).

- **Move to ▸**: every slot by its ruler name (`B4`) — `layout-edit-cards.cellRulerName` over the rulers' `trackNames`, lent by the table through `layout-edit-view`.
- **Swap with ▸**: every other card by name, its place beside it (`swapCells`).
- **Join as tabs ▸**: the same cards. This card's tabs join the picked one — the keys' way to a drop on its tab area.
- **Insert ▸**: **Row above** / **Row below** / **Column left** / **Column right**, a full track on the card's edge line as the rulers insert (`workspace-store.insertTrackBeside`), its first new cell selected — a card is where one looks for it. Then **Split this cell**'s **New cell above** / **left** / **right** / **below**.
- **Merge with ▸**: off, saying why, unless the two make a rectangle.
- **Stretch right** / **Stretch down**: one track, over empty slots only.
- **Move cell to layout ›** / **Copy cell to layout ›**: see [Move / Copy to layout](cross-layout-moves.md#move--copy-to-layout).
- **Remove widget**: the card's active tab, its cell left a slot (**Remove tab** on a card of tabs).
- **Close cell**: the absorb rule ([Workspace layout](workspace-layout.md)); `(N tabs)` on a card of tabs.

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

An empty cell is a slot (`EditSlot`): dashed, named by the rulers (`Empty slot B4`), its close × kept.

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
| The layout's left / right edge, 24px inside (over a narrow edge cell's body: no further than half of its own side split zone) | Inserts a column |
| The layout's top / bottom edge, 24px inside, reaching 16px past | Inserts a row |
| A cell's strip | Takes a tab at an index |
| A one-widget card's **tab area** | Joins as a tab after its widget |
| A cell body's outer 20 % (at most 120px) on each of its four sides | Splits on that side |
| A cell body's middle | A tab or a tray chip's widget joins as a tab; **a whole card swaps** with it |
| An empty cell (a slot) | A tab or a tray chip's new widget fills it; a whole card moves into it |

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

Moving or copying widgets to another layout is in [cross-layout-moves](cross-layout-moves.md).
