# Move / Copy to layout

Moving or copying widgets to another layout: the menu entries, placing the widgets in the [layout edit mode](layout-edit-mode.md), and what goes with a tab.

## Move / Copy to layout

Desktop only. A widget or a whole cell is carried to another layout, which opens in the layout edit mode with the widgets in hand (`utils/layout-transfer`).

### The menu entries

- A widget's ⋯ / right-click has **Move to layout ›** and **Copy to layout ›** (that widget: a tab, a strip's Number).
- A card's menu in the mode has **Move cell to layout ›** / **Copy cell to layout ›** (the whole cell, its active tab kept).
- Each lists the layouts (the open one off, `this layout`) and **New layout…**, which asks its name (`ui-store.requestLayout({ kind: 'new', transfer })`); the mode's **Cancel** deletes that layout again.

### Placing the widgets

A pick leaves the layout as any switch does (an open editor's question; in the mode, its draft's **Save** / **Discard** / **Keep editing**) and opens the target **in the layout edit mode with the widgets in hand** (`workspace-store.transferTo`, `LayoutEditSession.incoming`).

- The tray gives way to `Place “Errands” from “Main”: click a slot, a card to join it, or a +` (`a copy of “Errands”` for a copy).
- **At the bottom** joins the bar, and **Done** is off until they are placed.

Where they go (`placeIncoming` → `workspace-layout-ops.placeIncomingTabs`, a step of the mode's undo):

- a slot takes them;
- a card, anywhere on it, joins them as its last tabs;
- a "+" inserts a track holding them;
- **At the bottom** makes a full-width row.

The draft may show the source's lists meanwhile (`edit()` lets `incomingListIds` through `foreignListRefs`).

### Done and Cancel

**Done** writes both layouts in one transaction (`layoutRepository.transfer`): the target's draft, and for a move the source without the widgets (`removeTabsKeepCell`: a lone widget's cell stays, empty).

- A carried list is **handed over** (the same list, re-owned) on a move whose source no longer names it, else **copied** with its manual order — always on a copy (`transferListPlan`).
- It is one undo step, `Moved “Errands” to “Second”` / `Copied …`, that undoes and redoes from either layout.
- `undoTransfer` / `redoTransfer` run over `layoutRepository.untransfer`: copies deleted, kept for the redo; lists handed back; what the writes pruned restored. Both are refused in the mode.

**Cancel** goes back to the source, and so does Esc while the widgets are still in hand; nothing is written.

### What goes with a tab

- Notes carry nothing (one global note).
- A Review widget's temporary filter stays behind.
- Every other config and view state goes with the tab; a tab id the target already uses is renewed.
