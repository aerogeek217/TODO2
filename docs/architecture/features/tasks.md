# Task writes, people and tags

In normal use a task write goes UI → Zustand stores → repositories → Dexie, and stamps the task's `modifiedAt`. This file covers the sync file's part in that path, the stamp across undo and redo (`utils/task-stamps`), backups before destructive operations, new tasks and their flight to a list (`overlays/task-fly`), and people and tags. The task editor's layout is in [Review › The task layout](review.md#the-task-layout).

## The sync file

- While a sync file is syncing, Dexie hooks debounce-save to it.
- While sync is paused or waiting for permission, the hooks only mark the browser dirty. The next load resolves that: the browser's data is written to an unchanged file, else the user is asked.

## The `modifiedAt` stamp

- Every task write stamps the task's `modifiedAt`, in the store and the database alike. The stale fade and the Modified filter and sort read it.
- **An undo puts back the stamp the task had before the step, a redo the one the step wrote.** Each does so only where the task still holds the stamp the other left, so a task touched since keeps its newer one (`utils/task-stamps`).
- The same rule holds for field edits, completions, follow-ups, priority flags, status updates, subtasks and assignments.
- A delete's undo puts the row back with its stored stamp.
- One write stamps nothing: a task's plan state, described in [Planner](planner.md).

## Backups before destructive operations

Destructive operations back up first (`takeSafetySnapshot`): a data replace, a purge, a bulk delete of more than five tasks, removing unused people and tags. A failed backup asks before going on.

## New tasks

New tasks come through `QuickAddBar`. Its **Details** hands off to `TaskEditPopup`'s create mode.

**A new task flies home** (`overlays/task-fly`):

- It flies when a list row on screen shows it: drawn, its center in view and the topmost thing there.
- The topmost thing may instead be the list's `.row` box around it: its `content-visibility: auto` skips a just-added row's contents until a frame finds it on screen.
- The test looks through the closing Quick Add / New task editor (`FLIGHT_SEE_THROUGH_ATTR`) and the pill itself.
- A ghost of the task's title flies to the row from Quick Add's place. The row is held closed until the ghost lands, then opens and glows.
- Otherwise (no such row, a phone, reduced motion) the recent-task pill shows.

## People and tags

- People and tags are many-to-many with tasks via `todoPeople` / `todoTags`, cached in the person and tag stores' assignment maps (`assignedPeopleMap`, `assignedTagsMap`).
- Assigning or unassigning one (a row's picker, the editor, the bulk bar) is activity on the task. It stamps the task's `modifiedAt` in the same transaction, and its undo puts the earlier stamp back.
- A create's people and tags are stamped once, as the create.
- Renaming or deleting the person or tag itself, and **Find unused…**'s removal, are housekeeping: they leave the tasks' `modifiedAt` alone.
- `Org: <name>` people and `Project: <name>` tags are naming conventions only.

### The "none" choice

Every People / Status / Tags filter has a "none" choice, id 0 (Unassigned, No status, No tags). `Tags is No tags` keeps untagged tasks (a triage list); `Tags is not No tags` reads "has a tag".

### Find unused…

Settings › People, statuses & tags › **Find unused…** opens the **Unused people & tags** dialog.

- It lists the people and tags no task has. It can ignore completed tasks, and it notes the filters that name them.
- It removes the ticked ones with their assignments as one undo step.
- Filters naming them keep the ids and stop matching, as after a single delete.
