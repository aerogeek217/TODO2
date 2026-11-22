# Move / Copy to layout

A widget or a whole cell is carried to another layout, which opens in the [layout edit mode](layout-edit-mode.md) with the widgets **in hand**, to be placed. Nothing is written until the mode's **Done**, which writes both layouts as one undo step. Desktop only.

The store's part is `workspace-store.transferTo` and the session's `incoming`. The pure rules are in `utils/layout-transfer`, and the write is `layoutRepository.transfer`.

## The menu entries

- A widget's ⋯ / right-click has **Move to layout ›** and **Copy to layout ›** (that widget: a tab, a strip's Number). The rest of that menu is in [Widget chrome](widget-chrome.md).
- A card's menu in the mode has **Move cell to layout ›** / **Copy cell to layout ›** (the whole cell, its active tab kept). The rest of that menu is in [The card menu](layout-edit-mode.md#the-card-menu).
- Each lists the layouts (the open one off, `this layout`) and **New layout…**, which asks its name (`ui-store.requestLayout({ kind: 'new', transfer })`); the mode's **Cancel** deletes that layout again.

## Leaving the source

A pick calls `workspace-store.transferTo(to, what, copy)`. `to` is a layout's id, or `{ newName }` for a layout `createLayout` makes.

1. It leaves the open layout as any switch does (`load`): an open editor's question; in the mode, its draft's **Save** / **Discard** / **Keep editing** (`askLeaveEdit`).
2. It reads what it carries from the layout as stored (`utils/layout-transfer.carriedTabs`).
3. It opens the target and begins a session of the mode there **with the widgets in hand**: `LayoutEditSession.incoming`.

`incoming` is an `IncomingTransfer`:

- whether it is a copy or a move;
- the source's id and name, and the ids of its tabs that are carried;
- the tabs as they land, a tab id the target already uses renewed;
- a whole cell's active tab;
- its name;
- `madeLayout`, when the target was made for it.

## Placing the widgets

- The tray gives way to `Place “Errands” from “Main”: click a slot, a card to join it, or a +` (`a copy of “Errands”` for a copy).
- **At the bottom** joins the bar, and **Done** is off until they are placed.

Where they go (`placeIncoming(target)` → `workspace-layout-ops.placeIncomingTabs`):

- a slot takes them;
- a card, anywhere on it, joins them as its last tabs;
- a "+" inserts a track holding them;
- **At the bottom** makes a full-width row.

Placing is an `edit()` step of the mode's undo, and the cell that holds them is selected. While they wait, `tapEdit` places them in the tapped slot or card and answers `{ kind: 'place' }`.

The draft may show the source's lists meanwhile (`edit()` lets `incomingListIds` through `foreignListRefs`).

## Done

With the widgets placed, `finishEdit` runs `finishTransfer`:

1. A move's source is read again from the repository, and the widgets are taken out of it (`removeTabsKeepCell`: a lone widget's cell stays, empty).
2. The lists the session made that the draft doesn't show are deleted.
3. `transferListPlan` sorts the carried lists. A list is **handed over** (the same list, re-owned) on a move whose source no longer names it, else **copied** with its manual order — always on a copy.
4. `layoutRepository.transfer` writes both layouts in one transaction: the target's draft, and for a move the source without the widgets.
5. Both rows go into the store (`takeStored`), and the list stores are read again when lists changed hands.

A write that fails keeps the mode open.

### The write

`layoutRepository.transfer(TransferWrite)` is one read-write transaction over `layouts`, `listDefinitions` and `listOrders`:

- Each `ListCopy` is added as a list the target owns, with its ranks. For a redo, `copyRows` are put back with their ids instead.
- Each `reown` id becomes the target's.
- The source (a move) and the target are written (`put`), the target's tabs repointed at the copies. Each is pruned as `putAndPrune` prunes.

It returns a `TransferWritten`, `{ target, copyIds, removed }`, or `null` when either layout is gone.

### Undo and redo

It is one undo step, `Moved “Errands” to “Second”` / `Copied …`, that undoes and redoes from either layout. The step holds a `TransferRun`: both layouts' bodies, `reown`, `copyIds` and what the writes removed.

- `undoTransfer` / `redoTransfer` write both layouts, each as it is stored at that moment with the view state of that moment.
- Both are refused in the mode (`UndoRefused`), and fail with `UndoGone` once a layout is gone.
- The undo runs over `layoutRepository.untransfer(TransferUndo)`:
  - the copies' rows are read and deleted, and returned for the redo;
  - the `reown` lists are the source's again;
  - the rows of the `restore` removals are put back;
  - both layouts are written as they were.

  It returns `null` when either layout is gone.

## Cancel

**Cancel** goes back to the source, and so does Esc while the widgets are still in hand; nothing is written. `cancelEdit` discards the draft, loads the source again and deletes a layout made for the move.

## What goes with a tab

- Notes carry nothing (one global note).
- A Review widget's temporary filter stays behind.
- Every other config and view state goes with the tab; a tab id the target already uses is renewed.
