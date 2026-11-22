# Lists

A list is a saved definition (`ListDefinition`: a name, a filter, a group, a sort, an optional prompt) that a list tab draws as task rows. The widget is in `components/workspace/list/`, its rows are in `components/task/`, and its build is `hooks/use-built-list` over `services/build-list`. The definitions are held by `stores/list-definition-store`; what a list tab shows but never saves is in `stores/list-widget-store`.

The filter model (dates, chips, expressions, a filter read back in words) is in [Filters](filters.md). The top bar's filter is in [The screen filter](screen-filter.md).

## Building the rows

- A list tab runs its definition through `useBuiltList`, with the top-bar (screen) filter composed in: the chips and the typed expression beside them. Narrowing clauses AND; Show completed ORs (`composeScreenFilter`).
- Lists also sort by Planned (the Planner's planned day, `doDate`: earliest first, no plan last either way), Last followed up (oldest first) and Completed (picked newest first).
- Manual order is per list and saves at once.

## The prompt

A list may declare a prompt (`ListDefinition.runtimeFilter?: RuntimeFilterSpec`): a per-render picker for one field, `person`, `status` or `tag`.

- Only the field is stored on the definition, never the picked value.
- A list tab keeps its picks in `list-widget-store` (`picks[tabId]`, `setPicks`), where they are never saved. `useBuiltList` feeds them to `buildList` as `ctx.runtimeFilterValue`.
- Picks are an array of ids, OR-combined. To `buildList` an empty array means no narrowing.
- `setPicks` with an empty list removes the tab's picks: nothing is picked, and the list waits on its prompt.

## Groups

### Date groups

Grouped by Due, Planned or Next follow-up, a task goes by its date's day into one of the buckets (`utils/bucket-by-date`): Overdue · Today · This Week (to the week's end, by Settings' first day of the week) · Later, then the tasks without the date (`No Due Date`, `No Follow-up`).

- **Planned** names its first bucket **Delayed**, as the Planner's tray does, and puts the tasks held in the Planner's Unplanned tray in an **Unplanned** group before **Not planned** (`utils/task-grouping`). The Group menu notes its groups.
- A row dragged to another date group changes no date: date groups are read from the task, never written (`utils/cross-group-drag`).

### People and Tag groups

Grouped by People or Tag, **the "is" picks narrow the groups** (`build-list.groupRestrictions`).

- The picks are those of the list's own filter, and of the top bar's chips and its typed expression.
- Of an expression only the top-level terms count, and never an "is not".
- So `@Alice` in the top bar shows a task of Alice and Bob under Alice alone, as `People is Alice` in the list would.
- Picks on both sides intersect. A task that has none of the people every side picks shows under each one any side picks, so no member drops.
- The trailing Unassigned / No tags section stays only while every pick has `0`.
- The filtered-tasks panel, grouped so, follows the same rule.

### Group headers

- On desktop there is 18px of space above every group but the first. The name is bold, with its count and a rule to the line's end. A grouped body's rows draw no hairline.
- A header sticks to the top of the body while its group scrolls. A hairline shows under it only while it is stuck.
- A header's click folds or unfolds its group (`list-widget-store.toggleGroup`). The list's ⋯ menu has **Collapse all groups** and **Expand all groups**, which set the keys at once (`setCollapsed(tabId, keys)`).
- The collapsed group keys are kept per layout tab and never saved.
- Group headers shrink at the Lines zoom.

## The desktop row

The desktop rows are quiet.

- **Columns.** A Rows column is there only while some task the list shows uses its field. The rest show on row hover as icons at the title's end.
- **Dates.** A set date is its text alone.
  - In words by default (`utils/date.formatRowDate`): `Today`, the next six days' weekday, else `11/20`. An overdue date reads so too, in bold. So does another year's, with no year: the date column is 45px a part.
  - The phone row's details line reads the same. The tooltip and the name keep the full date.
  - Or `MM/DD`, under Settings › Appearance › Dates (`rowDates`).
  - Everything else that shows a day (the calendar, pickers, status updates, check-ins, exports) keeps `MM/DD`.
- **Color** goes only to what needs action now: an overdue or due-soon due date, a follow-up today or late. Avatars, tags and the status glyph are muted until the row is hovered.
- **Type and size.** Titles are at regular weight (400; a Lines title 500) over 11.5px tabular meta in the muted gray. Rows are 30px. A flat list's hairline starts at the title's start.

### Priority on the checkbox

**A task's priority is drawn on its checkbox, the same at every zoom** (`shared/PriorityRing` over `utils/markers.priorityRing`).

| Priority | Drawn as |
|----------|----------|
| Urgent or Important | an outline: a 2px ring in the marker's color with a faint fill |
| Urgent + Important | a split ring: top-right urgent, bottom-left important |
| Urgent only by its due date | the ring finely dashed |
| Focus | never an outline: a tight glow in the Focus color around the box (4px blur at 18px), with a ring or around the box's own plain border |
| A completed row | none |

- The phone row draws the same.
- The priority menu opens from a slim gutter before the box (empty at rest, a flag on row hover / focus) and from the task menu.

### Priority cues

**A priority adds what Settings › Tasks › Priority cues says beside its ring** (`utils/priority-cues`): a glow from the row's left edge, several blending along the row, and a semibold title.

- By default Urgent glows, Important glows and is semibold, and Focus adds nothing.
- Urgent only by its due date glows less.
- Completed rows have none.

### Stale tasks

A task untouched for Settings' `staleAfterDays` (default 30) is stale (Settings › Tasks › Rules › Stale after).

- It is faded while Settings › Appearance › Task rows › **Fade stale tasks** is on (`staleFade`, `data-faded`; a Lines title is muted).
- Its checkbox gathers a small cobweb in its top-left corner while **Cobwebs on stale tasks** is on (`task/Cobweb`, `staleCobwebs`): three spokes and two arcs spread evenly across the corner's 90°. Desktop and phone rows have it; Lines rows don't.
- Both are on by default.

## The phone row

**The phone row follows the same rule** (`task/MobileTaskRow`).

- The checkbox is a 44px target, the priority its ring.
- The title runs up to two lines.
- One muted details line sits under it: the due date in words · the follow-up only while today or late · the checklist's `2/5` · a notes / status-update mark · people's initials (three, then `+N`) · the first tag and `+N`.
- Color is used only as the desktop date cells use it. Completed and stale rows read as on desktop.
- It has no pills, flag, status ring or ▸.

Presses:

- A tap anywhere on it opens the task. Its title is its one button, stretched over the row. A tap that closes an open popover or menu goes no further.
- The checkbox completes it.
- A long-press opens the task menu. Its Set due date…, Follow-up ›, Mark followed up, Assign people…, Add tag…, Add subtask… and priorities open their pickers at the row.
- Everything else (status, notes, status updates) is in the editor.

## The hovered task

The hover is synced across surfaces: the task under the pointer is `ui-store.hoveredTodoId` (`setHoveredTodoId`). `TaskRow`, `TaskLine` and `MobileTaskRow` each read it through a selector and write it on mouseenter and mouseleave.

## Selection

The selected tasks are in `ui-store`: `selectedTodoIds`, a Set of task ids, with `selectionAnchorId` and `selectionFocusId`.

- **A list widget's selection is scoped.** `selectionScope` is the widget's tab id, and `selectionAnchorKey` / `selectionCursorKey` are row occurrences. `setScopedSelection` sets them, with what `utils/scoped-selection.nextScopedSelection` works out.
- So a selection lives in one widget at a time, and a task shown twice is walked once per row.
- The unscoped setters (`selectOneTodo`, `rangeSelectTodo`, `selectAll`) clear the scope. `clearSelection` clears it too.

## Zoom

**A list tab has a zoom** (`ListTabViewState.zoom`). It is view state, saved at once, and never an unsaved edit.

| Level | A row shows |
|-------|-------------|
| **Stacked** | the title on its own line, up to two; the details on a line under it (due · follow-up · checklist · people · tags, clipped from the right); no notes or status cell |
| **Rows** | the desktop row above |
| **Lines** | a 15px line: a small box, the title, one date |

A Lines row in detail:

- The small box stands where the checkbox was. Its ring is the priority as on a row's checkbox, Focus's glow too. Its fill is the date state: late, due soon, follow-up late, stale. A plain task's box is empty with a neutral border.
- At the line's end is the one date that matters: the follow-up while today or late, else the due date, else the next follow-up. It is colored as the Rows date cells.
- A click opens the editor, the hover shows the row's details, and a right-click opens the task menu. Shift+F10 on the focused line does too: a line is a tab stop.

### Stepping the zoom

- Ctrl + wheel over the list, its ⋯ menu's **Zoom − / +** (the [cell's menu](widget-chrome.md)) and the palette's **Zoom List In / Out** step it.
- All three step from the level shown (`services/list-zoom.listTabZoom`). A step saves the tab's own pick, which wins over Auto.
- The level shown is `list-widget-store`'s `zoom[tabId]`, for each list tab on screen: its own pick, else the Default list zoom with Auto resolved by its width. `ListWidgetBody` writes it (`setShownZoom`) and removes it when it goes.
- The palette's commands act on the list tab last pressed or focused in (`ui-store.activeListTabId`, set by `setActiveListTab`).

### The default

A tab that hasn't picked a zoom shows Settings › Appearance › **Default list zoom**:

- **Auto**, the default: Stacked while the list's measured width is under 480px, Rows from 480px, with 16px of hysteresis so a divider drag across it doesn't flicker. Unmeasured, it is Rows. Auto is never stored: it is the absent settings row.
- Or a level, stored in the `rowDensity` settings row.

Glance-widget and dialog rows stay at Rows, and the phone has one density.

## Tab badges

**A list tab shows a badge** (`hooks/use-tab-badges` over `utils/tab-badges`): one capsule with how many of the open tasks it shows on opening (its filter as edited, its prompt pick and the screen filter) are due (magenta) and due for a follow-up (yellow).

- Each count is inside a range from Settings › Tasks (default: due, overdue and the next 3 days; follow-up, overdue and today) or the list's own from Edit list (`ListDefinition.tabBadges`: off, or its ranges).
- A part is solid while any of it is overdue.
- The tab's title gives way first, and its tooltip spells the badge out. Alone in its cell, the capsule sits on the list's top line after its name (see [Widget chrome](widget-chrome.md)).
- Tabs folded into `+N` carry theirs into that menu.
- A list still waiting on its prompt has none.
- The top bar's counter carries the same badge (see [The screen filter](screen-filter.md#the-counter)).

## One number per list

- The tab's badge capsule says what is due.
- A count (`32 of 40`, before group · sort) shows only while the screen filter narrows the list (`shown < baseCount`). Otherwise there is none, and none while a prompt waits.
- A list whose filter line is hidden carries that count on its tab. Alone in its cell, it is on its slim name line (`ListNameLine`).

## The filter line

**The filter line reads in words** (`ListFilterRow`'s `ListFilterWords`).

- The list's whole filter, its chips or its expression, is taken as one expression (`wholeExpression`) and read back by `ExpressionWords`: muted, one line, `+N more`, and the exact text in the tooltip. See [Filters](filters.md#a-filter-read-back-in-words).
- When the filter narrows by nothing the line reads `Every open task` (`Every task` while it shows completed ones).
- A click (a tap on the phone) opens Edit list, where the chips, × and + Filter are.
- The line itself has no chips, × or + Filter. The top bar's chips are not repeated there: the count says they narrow the list.

## Edit list

**A list's definition is saved like a layout.** **Edit list** opens from the words and the group · sort summary on the list's line, from its ⋯, and from the phone's list-tab sheet.

### The surface

- The open Edit list is in `ui-store`, one at a time: `listEditor: { listDefinitionId, tabId } | null`.
- `EditListHost` draws it: the popover beside that tab's panel, or the phone's half sheet.
- `openListEditor(listDefinitionId, tabId)` opens it, in place of another list's.
- `closeListEditor()` closes it at once and never asks. Edit list's draft goes with it. The user's own closes ask through Edit list's `requestClose`.

### The draft

- Edit list edits a draft of the list (`list-draft-store`). The draft is in memory only: it is gone on a reload or a data replace.
- Every widget showing the list draws the draft live. `listAsShown` gives the draft while Edit list is open on the list, else the saved list. Every reader of a list's definition goes through it.

### Save and Discard

- **Save** writes what the draft changed since it opened, over the list as it is then. The write is for good and is one undo step with the snackbar (`list-definition-store`'s `editList(id, fn, description)`, `Edited list “This week”`).
- Undo and Redo write back only the keys the step changed (`utils/config-patch`), over the list as it is then, so another part written meanwhile stays. Once the list is gone they throw `UndoGone`.
- Save is off while nothing changed, the name is blank or a filter expression doesn't read.
- **Discard** drops the draft.

`editList` runs `fn` over the stored definition, and only the editors' parts of the result count: the id, sort order and owner stay the stored ones, and a blank name keeps the stored one. It resolves false for no change, an unknown list, a failed write (`Couldn't save list “X”.`) or a data replace's hold (`stores/replace-hold`).

### Closing it

- Closing it with changes asks Save / Discard / Keep editing, as the widget editors do: Esc, ×, a press elsewhere (which then goes no further), the line's words or summary, another list's Edit list, the sheet's scrim or handle.
- Opening Settings, or anything else that would take the list off the screen, asks the same question first ([Dismissing popovers and leaving editors](popovers-and-editors.md)). `openSettings` then closes it before Settings opens.
- Once the list has left the screen, Edit list closes and its draft is dropped.

### Edits outside Edit list

- They write through at once, each one undo step. A drag in a sorted list switches it to manual, through `editList` too (`Switched “X” to manual order`).
- The zoom stays as it is: view state.
- Nothing about a list is unsaved outside Edit list. So nothing asks when a list's last tab closes (the list goes at once, and Undo brings it back) or when the layout switches.

## Add task

- **Add task** is the list's last row, inside its scroll.
- It shows when the list's filter (the prompt pick merged in) names people, a status, tags or a priority to seed the new task with, or is an expression. See [Filters](filters.md#what-a-new-task-reads-from-a-filter).
- While a view transition runs (a tab change, a group collapse), the groups' pictures nest in the scroll's and are clipped to it (`view-transition-group: nearest`). They never draw past the list's foot or its cell.

## Dragging a row

A dragged list row is **lifted** (`DragOverlayTask`).

- On grab it scales to 1.02 with the drag shadow. There is no tilt.
- A reorder or a cancel settles it, shrinking back, onto its new spot or back where it came from.
- A drop the row follows later (another group, a calendar day) settles and fades where it was let go.
- Reduced motion: no scale, and it is gone at once.
- Where it would land is always a blank slot a row high (`DropSlot`), for a reorder and for another group. In a sorted list the slot is dashed and holds the "drop to switch to manual" hint.

## Lists belong to a layout

**Every list belongs to one layout** (`owner: { layoutId }`) and is offered only there. See [Workspace layout](workspace-layout.md).

- The list store holds every layout's definitions. Choosers filter them through `listedLists(defs, layoutId)`.
- A layout edit that leaves a list shown by no tab deletes it at once, in the edit's undo step. Undo brings it back with its tab.
- Duplicate layout copies the lists it shows.
- Delete takes them with it.
- A list is deleted only by its layout's writes (`workspace-store`), as above. `forgetLists(ids)` then takes the deleted lists, and their ranks, out of the list store's state.

## The definition store

`list-definition-store` (`useListDefinitionStore`) backs every list widget and Edit list.

- **Load**: `load` and `ensureLoaded`. A failed load is reported as `lists`.
- **Add**: a new list goes last. `listDefinitionRepository.insertLast` picks the sort order in its transaction.
  - `add` takes a name and a required `owner`, the layout whose tab shows it. It accepts a membership, a sort with its `sortDirection`, a grouping, a `runtimeFilter` and `showFilterLine`.
  - A sort or grouping not given is Settings' new-list default (`newListSort` with `newListSortDirection`, `newListGroup`), so a blank list (a new List widget) starts with them.
  - A new custom list starts from `emptyPredicate()` (`models/filter-predicate`).
- **Update**: `update` writes one list. A failure rolls back only that list, and nothing is written under a data replace's hold.
- **Edit**: `editList`, described under [Save and Discard](#save-and-discard).

## State that is never saved

`list-widget-store` (`useListWidgetStore`) holds the list widgets' state that is never saved, each field a record by tab id.

| Field | Holds |
|-------|-------|
| `picks[tabId]` | a list tab's prompt picks ([The prompt](#the-prompt)) |
| `collapsed[tabId]` | its collapsed group keys ([Group headers](#group-headers)) |
| `shown[tabId]` | its tasks as shown, while its widget is on screen |
| `zoom[tabId]` | the zoom level it shows, while it is on screen ([Stepping the zoom](#stepping-the-zoom)) |
| `reviewFilters[tabId]` | each Review widget's filter ([Review](review.md)) |

The module also has the filter pickers' types, `ListFilterField` and `PopoverPoint`.

### The tasks as shown

- `shown[tabId]` is a `ShownList`: the list's name, its words, whether it is grouped, and its sections in display order, collapsed groups too.
- `ListWidgetBody` and `ListFace` write it (`setShown`) through `useShownListReport` in `list/use-shown-list`. It is removed when the widget goes.
- It is what a review of the tab counts (`services/review.listReviewCount`). The review's filter, `listReviewFilter`, finds the list by the entry's `listId`.

### Tabs that are gone

A write of the picks or of the collapsed groups drops those of tabs that are in no layout any more: not in the working copy or a saved layout. A Review filter's write does the same for the Review filters.

### A data replace

A data replace calls `resetForReplacedData()`. `CLEARED_ON_REPLACE` says for every field whether it goes or stays, and a new field has to say which.

- The picks, the Review filters and the collapsed groups go: they name ids the new data may reuse.
- `shown` and `zoom` stay: the widgets on screen write them again.

### Tab ids as keys

Every record by tab id has no prototype, and the store reads its own keys only. So a tab id such as `constructor` reads as absent.
