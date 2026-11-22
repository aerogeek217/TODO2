# Status updates and subtasks

A task has two kinds of rows of its own: **status updates**, dated lines of text, and **subtasks**, a one-level checklist. Each has its own table, repository and store, named below. What the stores have in common is in [The two stores](#the-two-stores). Both are edited in the task layout the task editor and the review card share ([Review › The task layout](review.md#the-task-layout)).

## Status updates

### Data

- A task's dated lines of text (what happened, as of a day) are in their own table: `statusUpdates`, `status-update-repository` → `status-update-store`. They are not on the task row.
- `useStatusUpdateStore.byTodo` maps a task id to its entries, newest first by day, then by when written (`utils/status-updates.compareStatusUpdates`).
- `useStatusUpdates(todoId)` reads a task's entries, a stable empty list for none. `newestStatusUpdate(todoId, byTodo?)` gives the newest one, and also serves as a selector.
- Text is stored as one trimmed line (`statusUpdateText`). Blank is refused, with no write. A day after today is stored as today (`statusUpdateDay`).
- The Status picker (`statusId`) is a separate field.

### Writes

Each write saves at once as its own undo step:

- `add(todoId, { date, text, followedUp? })`: `Add status update`.
- `addToMany(todoIds, entry, description)`: the same entry on every task given, as one step. It is how `services/mark-followed-up` records a follow-up with a status update.
- `update(id, { date?, text? })`: `Edit status update`. Only the fields that change are written.
- `remove(id)`: `Status update removed`, with the snackbar.

Each is activity on its task, so updates keep a task from going stale, and none rejects ([The two stores](#the-two-stores)).

### The Status updates section

Entries are added, edited and removed in the task layout's Status updates section, the editor's and the review card's. It is in **the right-hand column**, beside Subtasks and Notes, under the fact band.

- Its heading is at the column's top. The log and the add line are **anchored to its bottom**, straight above the host's footer, so the line typed into sits at the foot of the card.
- Held short (the editor at its viewport cap, the review card in its cell), the log scrolls inside, down to one entry. The add line never shrinks.
- Under 600px of body the layout is one column (Subtasks, Notes, Status updates) and the body scrolls as one.
- Its **heading always shows**, the count beside it once there is an entry.
- The log shows **every entry oldest first**. The list scrolls inside and opens at the bottom.
- Then the **add line**: ⏎ adds the entry dated today with `addStatusUpdate`'s rules. In a review card, ⏎ there is Mark followed up with that update. A past day is set by editing the entry.
- Each write is its own undo step.

The follow-up fields are the footer's (`TaskFollowupFields`): `Last [date] · Next [date] [1d][1w][1m][3m]`, just before **Mark followed up**.

- The buttons are Settings › Tasks' quick follow-up intervals.
- The fields' help is in the footer's spare room.
- As the footer narrows, the quick intervals give way first, then the fields' relative words, then the labels.

### Elsewhere

- The Review widget's medium face shows the heading, the latest two entries (read-only), the update line and the Next row.
- Some places show only the newest entry: the row's notes tooltip, the check-in message, the follow-up popover. The phone row shows a notes mark only.
- An entry is also added from the notes popover's Status line (dated today) and from the follow-up popover's optional **Status update** line. With text there, Mark followed up adds the entry dated today (`followedUp`) in the same undo step (`services/mark-followed-up`). From the bulk bar, it goes to every selected task.
- The text search reads every entry.

### Entering one counts as following up

**Entering a status update on an open task counts as following up on its day** (`addStatusUpdate`).

- A day after the task's last follow-up (any day, when it has none) is Mark followed up for that day. The last follow-up moves to it, the next follow-up moves by the rule counted from it, and the entry is `followedUp`. It is one undo step with the snackbar.
- An older or same day only adds the entry.
- Entries on one task are decided one after another, each after the last one's follow-up has landed, however fast they come (`inTaskOrder`).
- Any entry on a **completed** task only adds the entry. Nothing is chased on it any more: its follow-up dates stay, and the entry isn't `followedUp`.
- A new task's entries set its Last follow-up to the newest's day (a new task is always created open).
- The follow-up popover's Mark followed up, the bulk bar's, and a check-in reply's Record a follow-up are the user's explicit choice. They record the follow-up on a completed task too.
- Editing an entry's day doesn't count as following up, nor does a check-in reply without Record a follow-up.

### With the task

- A task delete takes its entries, and its undo brings them back.
- Duplicate copies them.
- They travel with exports, backups, the sync file, task archives and the append import.
- The audit deletes orphans.

## Subtasks

### Data

- A task's checklist is in its own table: `subtasks`, `subtask-repository` → `subtask-store`, ordered by `sortOrder`.
- `useSubtaskStore.byTodo` maps a task id to its subtasks in that order (`utils/subtasks.compareSubtasks`). `useSubtasks(todoId)` reads a task's, a stable empty list for none.
- Each line is a title and whether it is done, nothing else. There is one level.
- A title is stored as one trimmed line (`subtaskTitle`). Blank is refused, with no write.
- A subtask is never a list row. It is never counted, filtered, grouped or sorted, and never a search result of its own.
- **The text search finds the task by its subtasks' words.** The top bar lists such matches in a Subtasks group, the line as the snippet. The screen filter, lists and counts keep the task likewise.

### Writes

Each write saves at once as its own undo step:

- `add(todoId, title, { done? })` puts a subtask last on the checklist: `Add subtask “…”`.
- `rename(id, title)`.
- `setDone(id, done)`: `Check “…”` / `Uncheck “…”`.
- `move(id, index)` moves it within the task. Only the rows whose place changed are written.
- `moveToTask(id, todoId)` puts it last on the other task's checklist.
- `remove(id)`: `Subtask removed`, with the snackbar.
- `resetDone(todoId)` unchecks every done one. It is a recurring task's completion, inside the todo store's step.

Each is activity on its task, as a status update's is, and none rejects ([The two stores](#the-two-stores)).

### On a row

- A task row with a checklist shows a `2/5` count after its title. A 12px pie before it fills by the share done, in the accent once all are.
- The count opens the checklist as a popover: check, rename, add, and a ⋯ per line with Rename · Make a task · Move to another task… · Delete.
- An open task without a checklist shows a faint checklist mark there while the row is hovered or focused (`SubtaskAddButton`; Rows and Stacked; always on touch). It opens the empty checklist on its add line.
- The phone row shows the count on its details line. Its task menu's **Add subtask…** opens the checklist as a bottom sheet.

### In the task layout

- The task layout's writing has a Subtasks section, first, above Notes. Its heading always shows.
- Rows drag to reorder. **+ Add subtask** is its last line.
- The checkboxes and that line's plus start at the heading's left edge. A row's grip hangs in the gutter.
- The editor has it in create mode too, written with the task. The review card has it as well.

### Converting

The task menu offers **Add subtask…** and **Make subtask of…**. The checklist's ⋯ offers **Make a task**. Both conversions are in `services/subtask-convert`.

- **Make subtask of…** opens a task picker. The task keeps only its title and done state, and its own subtasks move to the parent.
- A prompt lists what goes. It is skipped when the task holds only its title and the title is short enough for a subtask.
- One undo step brings the task back whole.
- **Make a task** gives a subtask the parent's people, tags, status, due date, next follow-up and markers. It does not take the parent's notes, status updates or repeat.

### With the task

- The check that finishes an open task's checklist offers **Complete task** in the undo snackbar, under the detail `All N subtasks are done` (`All its subtasks are done` for one). It is never automatic, and it completes the task only while it is still open (`task-hooks.completeTask`).
- Completing a task with open subtasks asks nothing.
- A recurring completion unchecks the checklist in the same undo step (`resetDone`).
- A delete takes the checklist, and its undo brings it back.
- Duplicate copies it unchecked.
- Purge removes it.

## The two stores

`useStatusUpdateStore` and `useSubtaskStore` keep only their own writes. Their load and their whole-row writes are `stores/task-child-rows`' ([state](../state.md)).

### Loading

- Each is loaded once (`load` / `ensureLoaded`): from `WorkspacePage`, from `useTodoNameLookups` (`useBuiltList` among its callers) and from `ReviewWidget`.
- Both `refreshAllStores` and `refreshTaskStores` reload them.

### A write never rejects

- A failed write is logged, and the snackbar says `Couldn't add the status update.` (… save / remove) or `Couldn't add the subtask.` (… rename / check / move / remove).
- It resolves as nothing written (`undefined` / `[]` / `false`). `services/mark-followed-up` reads that to abort its group.

### A write is activity on its task

- An entry's add, edit or removal, and every subtask write, stamps the task's `modifiedAt` in the same transaction (`statusUpdateRepository`'s and `subtaskRepository`'s `TaskTouch`). So it counts for the Modified filter too.
- A subtask moved to another task stamps both tasks.
- The store tells the todo store through `task-hooks.notifyTasksStamped`. The todo store's copy follows through `task-hooks.onTasksStamped(listener)`: it subscribes once, for both stores and the people and tag assignments.
- The write's undo puts back each task's earlier stamp and its redo the one it wrote, by the rule every task write follows ([Task writes](tasks.md), `utils/task-stamps`).

### Rows written whole

- `addRows(rows)` writes rows with no undo step: a duplicate's copies, the new-task editor's pending rows, a task draft's (a note's indented lines among them). The task's create step covers them, and its undo reads them from the database.
- It is the one choke point for whole rows. Each text goes through `statusUpdateText` or `subtaskTitle` as `add`'s does, and a row left with none is not written: one such row would make every export, backup and the sync file unimportable.
- `forgetTodos(ids)` and `restoreRows(rows)` are the todo store's delete and its undo.
- `addRows` and `restoreRows` stamp nothing.

## Notes → tasks

Note lines convert to tasks three ways: the toolbar's **Convert**, Alt+T, or the convert icon in the editor's left margin beside the line under the pointer.

- One line opens Quick Add on its text, **Details** handing off to the editor.
- Two or more open a preview that shows drafts on task rows, edited in place. Nothing is stored until it is confirmed.
- A draft checked off makes no task. Its line goes on confirm, in the one note edit that a Ctrl+Z undoes.
- Settings › Tasks › New tasks' **Remove note lines after converting** (off by default) makes every converted line go that way too, asking nothing, instead of becoming `✓ <title>`.
- A draft's × leaves its line in the note.
- The indented list lines under a bullet become its task's subtasks (plain titles).
- Tab / ⇧Tab, or the toolbar's **Indent** / **Outdent**, indent list lines in every notes editor.

### A task's own notes → subtasks

**A task's own notes** (the editor's, the notes popover's) convert to that task's subtasks instead, the same three ways and with no dialog (`services/note-subtasks`).

- Each line becomes a plain title. The lines under it sit beside it (one level). A done box is a done subtask.
- The lines turn `✓` or go, as above. It is all one undo step with the snackbar.
- In create mode they join the pending subtasks.

## Subtasks in check-ins and exports

- Check-in messages list a task's open subtasks under it for context. They are never read back ([Check-ins](check-ins.md)).
- The Markdown export and Copy write indented `- [ ]` / `- [x]` lines under the task.
- The checklist travels with exports, backups, the sync file, task archives and the append import.
- The audit deletes orphans.
