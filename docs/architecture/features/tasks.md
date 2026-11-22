# Task writes, undo, people and tags

In normal use a task write goes UI → Zustand stores → repositories → Dexie, and stamps the task's `modifiedAt`. This file covers the task row (`models/todo-item`), the task store (`stores/todo-store`) and the repository under it (`data/todo-repository`), the sync file's part in that path, the stamp across undo and redo (`utils/task-stamps`), undo and redo themselves (`stores/undo-store`), backups before destructive operations, new tasks and their flight to a list (`overlays/task-fly`), and people and tags. The task editor's layout is in [Review › The task layout](review.md#the-task-layout).

## The task row

`TodoItem` (`models/todo-item.ts`) is the core todo entry. Its `id` is optional before the insert. `NewTodoItem` is the insert payload, with an optional `uid`.

- Optional: `notes`, `statusId`, `dueDate` (the UI's "Due": a day, and the recurrence anchor) and `recurrenceRule`.
- `uid: string` is the task's stable identity across export and import, under the unique Dexie index `&uid`. `todoRepository.insert` mints it via `newTodoUid` unless one is passed. Duplicate detection keys on it, never on `id`.
- `completedAt?: Date` is set on completion and cleared on reopen. It is the retention purge clock.
- `lastFollowupAt?: Date` is the exact moment from "Mark followed up", or a day when edited. It is never in the future.
- `nextFollowupAt?: Date` is a day at local midnight. New tasks get today + `settings.followupDefaultInterval`, or none while Settings' automatic next follow-up is off ([Settings](settings.md#the-automatic-next-follow-up)). It has no index: it is filtered in memory.
- `focus?: boolean` means in focus. Only `true` is stored, and taking a task out deletes the key. It has no index. The Focus marker and the Priority (markers) filter read it ([Filters](filters.md#priority-filters)).
- `urgent?: boolean` / `important?: boolean` are flags: only `true` is stored, with no index. A task is also urgent when its due date is within `settings.urgentDueWithinDays` (`utils/urgency.isEffectivelyUrgent`). That never sets the flag.
- The plan state (`doDate`, `unplanned`) is the Planner's: [Planner › Plan state](planner.md#plan-state).

## The sync file

- While a sync file is syncing, Dexie hooks debounce-save to it.
- While sync is paused or waiting for permission, the hooks only mark the browser dirty. The next load resolves that: the browser's data is written to an unchanged file, else the user is asked.

## The task store

`useTodoStore` (`stores/todo-store.ts`) holds all tasks (`loadAll`, and the memoized `ensureAllLoaded`) and makes every write to one: CRUD and the bulk operations.

### Creating

`addMany(items, { description, snackbar? })` is every create. Quick Add and the editor come through `services/create-task`, notes through `services/note-tasks`, and a subtask's Make a task through `services/subtask-convert`. They stamp Settings' default status and next follow-up.

- The tasks go in with their people and tag ids in one transaction, last in order. The repository picks `sortOrder` in its insert transaction, so creates that start together never share one.
- The rows come back from the insert itself. The assignment caches are then reloaded.
- It is one undo step: undo takes the tasks out, and redo puts them back as they were when undone.

### Editing

`update(id, changes)` takes a `TodoChanges`: just the fields the caller changed, never a whole row, so a caller holding an old copy can't write it back.

- Fields already holding the value are skipped. No change means no write and no undo step.
- The edit is written as a patch via `todoRepository.update(id, changes)`. Undo, redo and a failed write's rollback touch only those fields.
- It **never rejects**. A failed write is rolled back, the snackbar says `Couldn't save your change to "<title>".` and it resolves `false` (else `true`). So fire-and-forget callers leave no unhandled rejection, and `checkin-reply/apply` stops on `false`.

### Completing

- `toggleComplete` completes or reopens one task, as one undo step. Every completion shows the undo snackbar, because a completed row may fold out of its list. Reopening a task stays quiet.
- A recurring task advances instead (`advanceRecurring`). The advance clears the task's plan state (`doDate`, `unplanned`), since the next occurrence isn't planned, and its undo puts it back. The advance keeps its own snackbar.
- `bulkSetCompleted` writes the completions and the recurring advances in one `bulkUpdate` transaction, each advance clearing its plan state likewise. Its undo is one transaction too. A failed write rolls back and re-reads the tasks (`loadAll`).
- The optimistic completion state mirrors the repository's `completedAt` rule (`resolveCompletedAt`).

### Bulk fields and flags

- `bulkSetStatus`, `bulkSetDeadline`, `bulkSetFollowup` and `bulkSetLastFollowup` set one field on every task given.
- `bulkSetFocus`: on writes `focus: true`, off removes the key, as one undo step. `bulkSetUrgent` / `bulkSetImportant` have the same shape on `urgent` / `important`.
- `setMarkerFlags(changes, description)` makes per-task Urgent / Important / Focus writes: a Priority group drop (`services/cross-group-mutation`). It is one undo step with the snackbar.
- `bulkClearDueDate(ids)` removes due dates. It is one undo step with the snackbar `Removed the due date` / `Removed N due dates`.

### Mark followed up

`markFollowedUp(ids, { next?, at? })` is "Mark followed up" on every path: the task menu, the bulk bar, the follow-up popover, the editor, and a check-in reply applied with Record a follow-up.

- The last follow-up becomes now, or the day `at`: a status update dated back ([Entering one counts as following up](status-updates-and-subtasks.md#entering-one-counts-as-following-up)).
- With `next` given (the popover's edited field; `null` = none), every task gets it as its next follow-up.
- Without it the rule is **per task** (`utils/followup.nextAfterFollowup`). A next follow-up after that day is kept. It is not written, so undo and a failed write's rollback leave it as it is then. One on that day, in the past or none gets `settings-store.autoNextFollowup`: the day + the interval, or none while the automatic next follow-up is off.
- One timestamp is shared by the store and the database.
- It is one undo step with the snackbar, named by `followedUpName`:
  - `Followed up · next follow-up <date>`;
  - `Followed up · no next follow-up`;
  - `Followed up · next follow-up kept` (`… follow-ups kept` for several);
  - mixed, `Followed up · next follow-up <date> · 2 kept`.
- Undo restores the last follow-up everywhere, and the next follow-up only where it was written. Redo sets the same given `next`, else the rule again per task from the redo's now.

### Deleting

`remove` and `bulkRemove` delete tasks as one undo step. The undo puts back the tasks with their people, tags, dependent rows and **event history**: the repository's delete returns the deleted `todoEvents` rows. A redo captures afresh, so the next undo brings back what the tasks had then.

- More than `BULK_DELETE_SNAPSHOT_MIN` (5) tasks are backed up first (`takeSafetySnapshot`), outside the tracked write. Cancelled, nothing is deleted. Without a backup the snackbar says `Delete N tasks — no backup was taken`. A redo skips the gate.
- `opts.beforeDelete` runs only once the delete goes ahead. The bulk confirm clears the selection and closes the editor there, so a cancel keeps them.

### Confirming a bulk write

Task deletes and bulk completions are confirmed through `ui-store.bulkConfirmation`: `showBulkConfirmation(action, ids, options?)` sets it and `clearBulkConfirmation` clears it. The action is `delete`, `complete`, `uncomplete`, or `custom` with its own title, message, confirm label and `onConfirm`. `App.tsx`'s `AppBulkConfirmDialog` draws it.

### A task goes, a task comes back

There is one take and one put-back for every way a task goes or comes back.

- Every delete, a delete's redo and a create's undo run through the store's `takeTasks(ids)`.
  - It reads each row as it is now: the store's copy, or the database's for a task not loaded.
  - It reads the task's people and tags and its dependent rows (`stores/task-dependents.captureDependents`: list ranks, status updates, subtasks).
  - It deletes them (`todoRepository.bulkDelete`, which returns the events) and drops them from the stores (`forgetDependents`, the assignment maps' entries too).
- `putBackTasks` restores rows, joins and events in one transaction (`restoreManyWithAssignments`), reloads the assignment caches and restores the dependent rows (`restoreDependents`).
- So a change made after a create, or between an undo and a redo, without an undo step of its own (a manual-order move, a sync-file load) survives the round trip.
- The redo of an undone create puts the task back with its `created` event, so Created vs completed and a Number's history read the same ([Glance widgets](glance-widgets.md#history-log)).
- A new kind of task-owned row is one edit in `task-dependents`, and one in `data/tables.TASK_CHILD_TABLE_NAMES`, which `bulkDelete` walks.

### Duplicate

`duplicate(id)` copies the title, notes, due date, next follow-up, status, recurrence and the urgent and important flags. It does not copy focus or the plan state.

- The copy goes in with the source's people and tags in one insert transaction.
- Then come its status updates: the same days and texts with a fresh `createdAt`, best effort through `status-update-store.addRows`. The checklist follows the same way ([Status updates and subtasks](status-updates-and-subtasks.md)).
- Undo and redo are a create's.

### Purging completed tasks

`purgeCompleted(ids)` resolves a `PurgeOutcome`: `done` with `deleted` and `noBackup`, or `cancelled` when the backup failed and the user cancelled.

- It deletes only the given ids still completed **in the database**, re-read after the backup gate (`takeSafetySnapshot`).
- It is called only after the purge dialog or Settings' cleanup confirms ([the purge notice](startup-and-data-replaces.md#the-purge-notice)). Expiry is keyed on `completedAt`.
- It only deletes and forgets. There is no undo.

### The set of tasks

`todosVersion: number` is a monotonic counter.

- It is bumped on every mutation that changes the id-set: `addMany`, `duplicate`, `remove`, `bulkRemove`, their undo and redo, `purgeCompleted` and a load.
- It is **not** bumped on field edits: `update`, `toggleComplete`, the `bulkSet*` writes.
- Surfaces that only care about membership use `${todos.length}:${todosVersion}` as an O(1) cache key. `useEntityAssignmentsForLoadedTodos` (the workspace) does: it subscribes to the count and `todosVersion` separately, to gate the effect that loads the assignment joins.

## The repository

`todoRepository` (`data/todo-repository.ts`) has full CRUD and queries for `TodoItem`. Its write paths emit `todoEvents` in the same transaction.

### Inserts

- `insert` mints the `uid`. Without a `sortOrder` it places the task last with `nextSortOrder`, inside the insert transaction. `insertManyWithAssignments` always does.
- `insertManyWithAssignments` writes several tasks, their `created` events and their `todoPeople` / `todoTags` rows in one transaction.
- `restoreManyWithAssignments` is the undo of a delete and the redo of a create: rows with their ids, joins not duplicated, and their `events` back with their own ids.
- Both back `todo-store`.

### Updates

- `update(id, changes)` writes only the given fields. A field set to `undefined` is removed. A missing row is left alone: nothing is recreated.
- It is the single-row `bulkUpdate`, a batched transaction that also skips missing rows.
- `update(id, changes, stamp?)`, `complete(id, completed, completedAt?, stamp?)` and `bulkUpdate(mutations, stamp?)` set `modifiedAt` by a `utils/task-stamps.Stamp`, as [the stamp](#the-modifiedat-stamp) describes.
  - A `Date` is the caller's now, so the store's copy matches, and the events carry the same time.
  - An undo or redo passes its `StampChanges`. The events then take the write's time.

**The recurrence-orphan invariant.** `update` and `bulkUpdate(mutations)` merge the change against the existing row and run `utils/todo-changes.withOrphanedRuleDropped`. When the merged row has a `recurrenceRule` but no `dueDate`, and the write doesn't set the rule itself, the rule is dropped before the write. So every caller converges on `TaskEditPopup`'s silent clear. The todo store mirrors it in memory.

**The completion clock.** `insert`, `update`, `complete(id, completed, completedAt?)` and `bulkUpdate` keep `completedAt` in step with `isCompleted` via `resolveCompletedAt` (`utils/completed-at.ts`):

- newly completed → now, or the explicit value (an undo passes the original back);
- still completed → kept;
- reopened → removed.

### Deletes

- `delete` and `bulkDelete` (an atomic multi-delete) clear the todo's own rows in every table of `tables.TASK_CHILD_TABLE_NAMES`, in the same transaction as the row drop: `todoPeople`, `todoTags`, `todoEvents`, `statusUpdates`, `subtasks` and `listOrders`.
- The compiler makes that list cover every table whose row has a `todoId`.
- They return the deleted `todoEvents` rows, which undo puts back.

### Reads

- `existingIds(ids)` gives the ids among them that exist, keys only. It is the undo guard's read.
- `getByIds(ids)` / `getByUids(uids)` are database reads for the purge notice and `purgeCompleted`, which must not depend on what the store has loaded.

## The `modifiedAt` stamp

- Every task write stamps the task's `modifiedAt`. The stale fade and the Modified filter and sort read it.
- **One `modifiedAt` per write.** Each write mints its timestamp once and passes it to the repository (`update` / `complete` / `bulkUpdate` take a `Stamp`), so the store and the database hold the same value.
- **An undo puts back the stamp the task had before the step, a redo the one the step wrote** (`utils/task-stamps`).
  - Each step keeps its `StampChanges`: each task's stamp before → after.
  - Its undo writes them inverted and its redo as they are, as a guarded `Stamp`: only where the task still holds the stamp the other left. A task touched since keeps its newer one.
  - That holds in the database (in the write's transaction) and the store alike (`stampAfter`).
- The same rule holds for every undoable task write:
  - a field edit (`patchTodo`'s `stamp`), a completion (`writeCompletion`) and a recurring advance;
  - `bulkSetCompleted`, whose undo restores every task it wrote, a no-op completion's too;
  - `bulkUpdateField` and `setMarkerFlags`;
  - `markFollowedUp`, where a redo still counts the rule from its own now and the stamp is the original's;
  - a status deleted from Settings (`status-store`);
  - the writes of the entry stores (status updates, subtasks) and of the assignments.
- A delete's undo puts the row back with its stored stamp.
- One write stamps nothing: a task's plan state, described in [Planner](planner.md).

## Undo and redo

`useUndoStore` (`stores/undo-store.ts`) holds the undo and redo stacks and the snackbar's state.

### The stacks

- Each stack holds at most 50 entries. The store has `push`, `undo`, `redo` and `clear`.
- `isPerformingUndoRedo` is the guard while an undo or redo runs.

### Merged steps

An entry may carry a merge key (`UndoEntry.mergeKey`).

- A push whose key is the newest entry's, with no group open, merges into it. The entry keeps its undo and its name and takes the push's redo. The redo stack is cleared, and the snackbar is shown again when asked.
- `push` returns the newest entry. `mergeTarget(key)` says beforehand which entry a push would merge into. `dropNewest(entry)` removes it when it is still the newest: a run typed back to its start.
- The layout's divider keys and the settings writes pass a `mergeKey`.
- A compound step never merges.

### Compound steps

`runGroup(description, fn)` runs every compound operation, check-in replies among them.

- There is one shared queue, so groups never overlap.
- `fn` gets the group's token. When it settles (resolved or thrown) with the group still open, the group ends as one entry named `description` (a string, or a function read then), with the snackbar.
- `undo()` / `redo()` pressed while a `runGroup` group is open or queued wait for it (`groupsSettled`). So they take back or redo the whole compound step, never a part of it.
- An unrelated undoable write landing inside a group's window is merged into it. That is accepted: groups take milliseconds.

Under it are the group calls:

- `beginGroup()` returns a token. `endGroup(token, …)` / `abortGroup(token, …)` take it: a token that isn't the open group's does nothing and warns.
- While a group is open, pushes neither trim the stack nor show a snackbar. `endGroup` trims and decides the snackbar.
- `abortGroup(token, description)` is for a compound operation that failed part-way. It takes back the group's entries newest first, as an undo (no new entries are pushed meanwhile), and leaves none. When it can't, it resolves `false` and keeps what it couldn't take back as one entry named `description`.

### An undo that fails

`undo` / `redo` never reject.

- An entry whose undo or redo throws stays on its stack where it was, and the next undo / redo tries it again. The snackbar's notice says `Couldn't undo: <description>` / `Couldn't redo: …`.
- For an `UndoRefused` the notice is the error's message. It is a reason the user can fix, such as a layout to open first.
- An `UndoGone` means the subject is gone for good: a task a purge deleted. The entry is dropped, never retried, with the error's message as a notice.
- A compound step skips its gone parts. It is gone only when every part is.

### The snackbar and notices

- The snackbar's state auto-dismisses. A timer ends only the snackbar it was started for: `snackbarTimerId` must still be its own. So a replaced timer, or one left from before the store was reset, clears nothing.
- An entry pushed with an `action` (`{ label, run }`: the checklist's Complete task) shows it as a button beside Undo. Taken, it is its own step.
- An entry's optional `detail` is the snackbar's second line, shown for `NOTICE_SNACKBAR_MS`. It is passed through `undoable(…, detail)`: the checklist's last check passes one.
- `notify(description)` shows a notice, with no Undo and for `NOTICE_SNACKBAR_MS`, without touching the stacks.
- `notify(description, { action?, onEnd? })` (`NoticeOptions`) is a notice with an offer, such as Cancel's Restore in the [layout edit mode](layout-edit-mode.md), and what follows its end without the offer taken. That end is a timeout, a dismissal, or another snackbar replacing it: a push, a group's end, another notice.
- `clear()` (a data replace) runs no `onEnd`.

## Backups before destructive operations

Destructive operations back up first (`takeSafetySnapshot`): a data replace, a purge, a bulk delete of more than five tasks, removing unused people and tags. A failed backup asks before going on.

## New tasks

New tasks come through `QuickAddBar`. Its **Details** hands off to `TaskEditPopup`'s create mode.

Quick Add's state is in `ui-store`:

- `quickAddOpen`, with `openQuickAdd(seed?)` and `closeQuickAdd()`.
- `quickAddDraft: QuickAddDraftSeed { rawTitle, defaults? } | null`, with `setQuickAddDraft`. `defaults` is a list's predicate seed, from its **Add task** row. The draft is also the Details → create-popup handoff.
- `recentlyCreated: { todoId, key }`, with `showRecentlyCreated` / `clearRecentlyCreated`: the transient `RecentTaskPill`.

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
