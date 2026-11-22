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

**Nothing leaves an editor with changes without that question.** It is one rule, `stores/editor-leave`. Whatever would close an editor, or take its subject off the screen from outside, asks first and then carries on:

- Save or Discard: it then does what was asked.
- Keep editing: nothing changes.

### How it asks

- Each editor registers `{ changed(), ask() }` while mounted (`registerOpenEditor`, through `hooks/use-editor-leave`).
- `afterLeavingEditors(run)` runs `run` at once when no editor holds changes (`editorsHoldChanges`). Else it asks each in turn (`leaveOpenEditors`) and runs only once all were saved or discarded, never on Keep editing.
- Everything inside a layout asks through these three, at their default scope, `cell`: a tab switch, Add widget, the widget popup.
- The layout edit mode is a **layout-wide editor** (`OpenEditor.layoutWide`). The `cell` scope passes it by, so the mode never questions its own edits. It is asked only when something leaves the layout.
- `leaveLayout()` asks every editor holding changes, the mode too. Then it leaves the layout-wide ones that hold none (`quitLayoutEditors`, their `leave`). `layoutLeaveAsks()` says whether it would ask.
- A layout switch, New / Duplicate / delete layout (`workspace-store`), Settings opening (`ui-store.openSettings`) and an in-app route change (`WorkspacePage`'s blocker) leave the layout. They ask through `leaveLayout` and `layoutLeaveAsks`.

### One editor at a time

`editor-leave` also keeps the one roster of open editors.

- Each store that holds a "which editor is open" field registers how its fields close (`registerEditorFields`): `ui-store` for Edit list and the Number editor, `chart-widgets-store` for a chart's and Created vs completed's.
- `openOneEditor(open)` is how each opens: asked first, then every other one closed. So there is one editor at a time, whatever its kind.
- `closeOpenEditors()` closes them all. Settings opening, the widget popup, the layout edit mode opening and a data replace (`refresh-all`) call it.

### What asks

- **Opening Settings**: the gear, `G S`, the palette, the storage pill (`ui-store.openSettings`).
- **Opening another editor**: `ui-store.openListEditor` / `openNumberEditor`, `chart-widgets-store.openEditor` / `openTrendEditor`.
  - Another list's Edit list opens once this one was saved or discarded. `widget-hooks.openEditList` asks before it shows the tab.
- **Adding a widget** (`widget-hooks.addTabToCell` / `AddWidgetFlow`): a ⋯'s **Add widget as tab ›**, an empty cell's kinds, the strip's `+`, the palette's **Add Widget ›**. The palette and a menu run by the keys reach it with an editor still open.
- **Opening the layout edit mode** (`workspace-store.enterEdit`, which then closes every editor).
- **Whatever in a cell can take a widget off the screen** (`FilledCell`, `cell-menu`, the phone's `MobileCell`):
  - a tab switched (a click, Enter, the arrow keys, the `+N` menu) or closed;
  - Collapse / Expand row;
  - the menu's Remove widget and Change widget.

  These ask from the keys or a menu; a press elsewhere has asked already.
- **Opening an editor on a tab out of sight** (`widget-hooks.openBeside`, every editor's way in, `widget-hooks.openNumberEditor` included). It asks before it shows the tab.
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

## Questions code awaits

A question code awaits is a prompt in `ui-store`.

- `askConfirmation(prompt): Promise<boolean>` asks a yes / no question.
- `askChoice(prompt): Promise<PromptAnswer>` has three answers, `confirm` / `discard` / `cancel`. The prompt's `discardLabel` adds the third button, and `askConfirmation` drops it. An editor's Save / Discard / Keep editing is one.
- A prompt holds a title, a message and its labels (`cancelLabel` among them), `danger` and `cancelIsDefault`.
- `confirmPrompts` is a queue. `ConfirmPromptHost` renders one at a time ([components](../components.md)), and `answerConfirmation(answer: boolean | PromptAnswer)` answers the one on screen.
- The Settings modal leaves Esc to a prompt while one is open.
