# Dismissing popovers and leaving editors

A change a popover shows either sticks or the user is warned. A popover saves what was typed when it is dismissed. An editor that holds a copy until its Save asks before it is left with changes: one rule, in `stores/editor-leave`, which each editor joins through `hooks/use-editor-leave`.

## Popovers

- Esc or a click off saves what was typed: `FollowupPopover`, `SubtaskChecklist` in every host, `TaskNotePopover`.
- So do, in the task editor, the Status updates add line and the **+ Add subtask** line: Esc leaves them, and the editor's close adds what they hold.
- Each writes it in an unmount cleanup, so every way of closing is covered. Only a Cancel button drops it.
- Esc inside an inline edit (a subtask rename, a status entry) cancels that edit and leaves the popover or editor open.
- Text that can't be stored holds the close once, saying so; closing again drops it. A filter expression that doesn't read does so too, on the first press outside its field (`ExpressionField`).
- Filter and picker popovers ([Filters](filters.md)) write on every change. A date panel's pending Is not, which no clause can hold yet, is kept per filter (`filters/date-pending-not`).

## Editors that hold a copy

- Edit list ([Lists](lists.md)) and the widget editors, a Number's, a chart's and Created vs completed's ([Glance widgets](glance-widgets.md)), hold a copy until their Save. Save writes it for good as one undo step.
- Layouts and lists themselves have no Save: every other edit is stored at once.
- Closing an editor with changes asks **Save** / **Discard** / **Keep editing**, and the press that asked goes no further. Closing one with none just closes.
- The [layout edit mode](layout-edit-mode.md) holds its draft the same way, as a layout-wide editor. Only leaving the layout asks it (Save / Discard / Keep editing), never what is done inside it. Its Cancel asks nothing and offers Restore instead.

## The leave rule

**Nothing leaves an editor with changes without that question.** It is one rule, `stores/editor-leave`. Each editor registers through `hooks/use-editor-leave` while mounted. Whatever would close it, or take its subject off the screen from outside, asks first and then carries on:

- Save or Discard: it then does what was asked.
- Keep editing: nothing changes.

Inside a layout the askers go through `afterLeavingEditors` / `leaveOpenEditors`. Leaving the layout goes through `leaveLayout`, which asks the layout edit mode too.

### What asks

- **Opening Settings**: the gear, `G S`, the palette, the storage pill (`ui-store.openSettings`).
- **Opening another editor**: `openListEditor` / `openNumberEditor` / a chart's or Created vs completed's.
  - Another list's Edit list opens once this one was saved or discarded. `widget-hooks.openEditList` asks before it shows the tab.
  - There is one editor at a time, whatever its kind: `editor-leave.openOneEditor` closes any other.
  - `closeOpenEditors` is the one roster Settings, the widget popup and a data replace close them through.
- **Adding a widget** (`widget-hooks.addTabToCell` / `AddWidgetFlow`): a ⋯'s **Add widget as tab ›**, an empty cell's kinds, the strip's `+`, the palette's **Add Widget ›**.
- **Opening the layout edit mode** (`workspace-store.enterEdit`, which then closes every editor).
- **Whatever in a cell can take a widget off the screen** (`FilledCell`, `cell-menu`, the phone's cell):
  - a tab switched (a click, Enter, the arrow keys, the `+N` menu) or closed;
  - Collapse / Expand row;
  - the menu's Remove widget and Change widget.

  These ask from the keys or a menu; a press elsewhere has asked already.
- **Opening an editor on a tab out of sight** (`widget-hooks.openBeside`, every editor's way in).
- **Closing the widget popup** over an editor opened from it: its ×, its scrim, Esc (`WidgetPopup`).
- **A Review jump** that would close the widget popup, or hide another tab of the Review widget's cell (`services/review-jump.jumpToReview`; see [Review](review.md)).
- **A layout switch** from the tabs, the picker, the palette or a shortcut (`workspace-store.load`).
- **New / Duplicate layout** (`createLayout` / `duplicateLayout`).
- **Deleting the open layout** (`delete`).
- **An in-app route change**: the phone's tab bar, the browser's back / forward (`WorkspacePage`'s `useBlocker`).

### The press that carries on

The one press that carries on is a tab's. Held by the question, it is made again once the answer is Save or Discard (`use-editor-leave.carryOnAfterLeave`). So a click switches tabs as the keys do, with one question. After it the focus is on the new tab.

### What opens over an editor

- The task editor, Quick Add and the palette itself open over an editor without closing it.
- The widget popup ([Open larger](widget-chrome.md), the popup review) covers the workspace and asks first, as Settings does.

### What asks nothing

- A closed browser tab or a reload asks nothing, and nothing is kept.
- An editor closed anyway, its subject gone where nothing could ask, says so (`Edit list closed: its changes to “X” weren’t saved.`). The cases:
  - a data replace. The draft may name a list the new data lacks, so it is dropped;
  - an undo;
  - a hash typed in. The router can't hold a navigation it didn't make;
  - a cell resized too small to draw its widget whole (a divider, the window).

## Things not stored yet

Nothing exists yet behind Quick Add, the new-task editor and the convert preview's edited drafts, so they ask instead: Create task / Discard / Keep editing, or Discard / Keep editing with no title.

- They ask on Esc, a press on the backdrop and the new-task editor's ×.
- They ask only when the form differs from how it opened.
- The editor's Cancel button discards without asking.
