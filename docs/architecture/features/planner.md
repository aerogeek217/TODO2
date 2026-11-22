# Planner

The Planner (widget kind `planner`, under Tasks after Review, no settings) shows today and the week ahead in one widget. It is a scratch pad: **a drag only ever changes the plan, never a task's real dates**. Its components are in `components/workspace/planner`, its rules (all pure) in `utils/planner`, its writes in `services/planner-drop`, its data in `hooks/use-planner` and its in-memory state in `stores/planner-store`.

This file is the rules: a task's plan state, where a task sits, the window, what a drop writes, and the moves without a drag. How the widget is drawn (its faces, its rows, drag feedback and menus) is in [planner-widget](planner-widget.md).

## Plan state

A task's **plan state** is one of three, kept on the task (`models/todo-item.TaskPlan`):

- none;
- a **planned day** (`doDate?: Date` on `TodoItem`): the day the user plans to work on the task, a day at local midnight;
- **held in Unplanned** (`unplanned?: true`; only `true` is stored).

Never both. Neither field is indexed. The plan state is the Planner's: it is shown nowhere else, and no filter, expression, sort, row column, calendar, Quick Add, Markdown export or check-in reads it.

It is set in the Planner, or from **Plan for day ›** outside it (`task/plan-menu.planForDayEntries`): in every task menu — a list row's, a calendar entry's (the day popover's too), a search result's — and in the task editor's and the [review card](review.md)'s ⋯. That submenu offers:

- this week's days, read against this week's window;
- **Unplanned** — any open task joins the Planner there;
- with a plan state, **Clear plan** — reading **Remove from Planner** when that takes the task out of it (`utils/planner.plannerClearLeaves` → `services/planner-drop.clearPlannerTask`), the snackbar saying so.

A Planner's own rows have its [menu](planner-widget.md#menus) instead.

### The plan write

Planning is not an edit. `todo-store.setPlan(ids, plan, description?, snackbar?)` writes one plan to every task in `ids`; `setPlans([{ id, plan }], description?, snackbar?)` takes a plan per task (`TaskPlanChange`). `plan` is a `TaskPlan`:

| `plan` | Written |
|---|---|
| `{ day }` | `doDate` at local midnight, `unplanned` removed |
| `'unplanned'` | `unplanned: true`, `doDate` removed |
| `null` | neither field |

- **Both fields go in the task's one write** (`store-helpers.bulkUpdateTasks`): every task in one database write and one undo step. Only the tasks whose plan changes are written.
- The snackbar and its Undo show only when `snackbar` is passed: Reset plan, Unplan all Delayed, and a plan that takes the task out of view ([a move to a day that shows it nowhere](#nothing-leaves-the-planner-silently), Remove from Planner). The step is named `description`, else `Planned “Title”` / `Unplanned “Title”` / `Cleared the plan of “Title”` / `Changed the plan of 3 tasks`.
- It leaves every task's `modifiedAt` as it is — on the write, its undo and its redo (which put both fields back), in the store and the database (`utils/task-stamps.KEEP_STAMPS`, a stamp that lists no task). Every other [task write](tasks.md) stamps it.
- It logs no history event and never writes a due date or a follow-up.
- It never rejects. A write that fails is taken back: a task's two plan fields together, and only while both still hold that write's values, so overlapping failures can't leave a planned day beside `unplanned` (`bulkUpdateTasks`' `together`). The tasks are read back, the user is told (`Couldn't save the plan of “Title”.`) and it resolves `false`; otherwise `true`.

What other operations do with the plan state:

- Completing a repeating task clears it on the next occurrence (the checkbox and the bulk path — a check-in reply's too); the undo puts it back.
- Duplicate doesn't copy it.
- Make subtask of… drops it without naming it.
- Exports, backups, the sync file, task archives and the append import carry it. A file holding both fields keeps the planned day (import validation).

## Which tasks it holds

The Planner holds the open tasks the [screen filter](screen-filter.md) shows (`useScreenTasks`) that are in Focus, have a plan state, or have a natural day (`inPlanner`).

A task's **natural day** (`utils/planner.plannerNaturalDay`) is the earlier of its next follow-up and its due date, when that date is on or before the window's last day. A date before today counts as today. When both fall on the same day, it is the due date's.

## Where a task sits

`plannerPlacement` decides, top row first:

| The task | Where it sits |
|---|---|
| Held | the **Unplanned** tray |
| Planned for a day before today | the **Delayed** tray (nothing joins Today on its own) |
| Planned for a day inside the window, today included | that day |
| Planned for a day past the window's last day (**planned later**) | its natural day when it has one — a real date inside the window, or overdue, still shows the task, as a placed row there; else not shown in this window |
| No plan, a natural day | its natural day |
| No plan, no natural day, in Focus | the **Unplanned** tray |
| No plan, no natural day, not in Focus | not in the widget |

A row is **placed** when it has a plan state.

### Redundant plans

The planned day is the `doDate`'s day (`plannerPlannedDay`) — unless that is the very day of the task's earliest real date, wherever it lies. Such a plan is **redundant** and reads as no plan:

- the row is not placed and carries no plan mark;
- once the day has passed, the task is overdue in Today, never in Delayed.

It is decided when the plan is read, not when it is written, so it holds whether the plan or an edit of the date came last: Add task typed with a due date of today, or a due date edited onto the planned day.

### Conflicts

A row on its planned day — and one planned later — carries its **conflicts** (`PlannerConflict`): each real date the plan falls after (the due date, the follow-up), by how many days, with the fixes on offer:

- move that date to the planned day (always);
- plan for that date's day (only when it is today or later).

The row shows them in its [tag](planner-widget.md#four-planner-only-things); what a fix writes is under [A conflict's fix](#a-conflicts-fix).

## The window

The window is seven days from today plus a whole number of weeks, never before this week.

`stores/planner-store` (`usePlannerStore`) holds each Planner tab's window in memory only. It is never layout config or view state, and it is gone with a reload.

- `windows[key] = { offset }`. `offset` is the days from today to the window's first day: a multiple of 7, 0 or more (`utils/planner.plannerOffset`). No day is picked: a tile's click [scrolls](planner-widget.md#the-strip).
- `key` is `plannerWindowKey(layoutId, tabId)`: the tab in its layout, or the tab alone with no layout open. Duplicate layout keeps the tabs' ids, so the copy's Planner has a window of its own and starts on this week.
- `usePlannerWindow(key)` reads that window: this week until it is moved.
- `shift(key, weeks)` moves it a whole number of weeks, never before this week. `reset(key)` goes back to this week.
- It is kept in the store, not in the widget, so the widget popup's remount shows the same week ([Open larger](widget-chrome.md)): a tab has one live widget at a time.
- `keep(layoutId, tabIds)` drops that layout's windows whose tab is not one of its Planner tabs (`use-planner.usePlannerWindowsOf`). A tab closed or changed to another kind starts on this week if it is a Planner again. The other layouts' windows stay.

## The view

`plannerView` gives:

- **Today** — the tasks planned for today and those whose natural day is today, a late date among them, whatever the window;
- a group per day ahead, the empty ones too, from the window's first day (never before tomorrow) to its last;
- the two trays, **Delayed** and **Unplanned**;
- the window's seven **tiles**.

While the window is shifted, a task dated or planned between tomorrow and the window is in no group. The trays stay.

Each tile holds:

- `count` — the rows sitting on its day;
- `dates` — the real dates falling on it: one mark per due date and per follow-up of every open task, wherever it is planned or held. A late one counts on today's tile;
- `plans` — the tasks whose planned day it is.

They are drawn as the tile's marks (`plannerTileMarks`): a **solid tick** per real date — due dates in the deadline color, then follow-ups in the follow-up color — then a **hollow tick** (outlined, in the secondary text color) per plan. Eight in all, then `+N`.

Where each part is drawn is in [Faces](planner-widget.md#faces).

## Hand order

Inside a group the tasks follow the tab's **hand order** (`PlannerTabViewState.order`): task `uid`s, one sequence for the widget, view state, written by a drop into a group (see [The row's place](#the-rows-place)). The rest come after them by reason (due, follow-up, plan, held, Focus), then date, then `sortOrder` (`plannerOrder`).

## Top line and Reset plan

Alone in its cell, the Planner's top line reads:

- `Planner`;
- the window's range (`Nov 20 – 26`; shifted, a button back to this week);
- a badge capsule: what it holds that is due and due for a follow-up, in Settings' tab-badge ranges (as a [list tab's badge](lists.md));
- at its end, **Reset plan**: an icon and the words, the icon alone in a widget 420px wide or less.

**Reset plan** opens a menu of **This week** (the shown range while the window is shifted) · **Today only** · **Delayed**. Each shows the count of tasks it would clear (`plannerResetCounts`) and is inert at 0 ([what each clears](#unplan-all-delayed-and-reset-plan)).

A cell of tabs and the widget popup have no top line, so the same three are under **Reset plan ›** in the widget's ⋯ menu (`planner/planner-reset`: `usePlannerResetEntries`, and `usePlannerMenuEntries` through `cell-menu.useWidgetMenuContent`).

Both read what the drawn Planner reports, so no menu builds the view: it is built once per change, and a cell with no Planner reads nothing. The report is `planner-store.resets[key]`, under the [window](#the-window)'s key, set by `setReset(key, report | null)`:

- It is `{ counts, week, run }`: how many tasks each scope would clear, the first scope's name (`This week`, or the shown range while the window is shifted) and the action. `run` resets the Planner as it shows when it is called.
- `hooks/use-planner` writes it from the view it already holds, only when a count or the name changes, and removes it when the widget unmounts.
- A Planner that isn't drawn (a tab behind another) offers none.

## Drops

Desktop only: the phone has no drag. What a drag shows before the drop is in [Drag feedback](planner-widget.md#drag-feedback).

### Targets

Every day tile and every group — Today (today), each day ahead (an empty day's heading too), the two trays — is a target for a dragged task: a row of this Planner, a list widget's row, a calendar entry.

- Each is a dnd-kit droppable (`TASK_DROP_KIND.plannerDay` / `.plannerGroup`), so a clipped or covered one never counts (`task-dnd/collision`). Its drop data is the Planner, the day, the window and — for a group — its rows.
- The page's dispatcher makes the drop, once (`dispatchTaskDrop` → `services/planner-drop`). The widget's own drag hook writes nothing, and a list's `useListRowDrag` only takes its own tab's rows inside its own scroller.

### The drop rule

**The write is `utils/planner.plannerDrop`'s decision** — the only place the drop rule lives — for the task in that Planner's window, with no chooser. A completed task is refused everywhere. For an open task, the first row of its target that fits applies:

| Dropped on | The task | What the drop does |
|---|---|---|
| A day `T` (a tile, a day's group; Today = today) | `T` is before today | refused |
| | `T` is its natural day | whatever plan state it has is cleared (`own`) — a redundant plan for that very day too, and a later plan; with none to clear, nothing |
| | sits there already | nothing (the order only) |
| | any other | planned for `T` (`plan`: `doDate = T`, `unplanned` cleared) |
| **Unplanned** | sits there already | nothing (the order only) |
| | has a natural day | **held** (`unplanned`, `doDate` cleared) |
| | planned, without one | in Focus it just loses its plan (Focus keeps it there), else it is held too — **Unplan never takes a task out of the Planner** |
| | any other | held too — Unplanned is how a task with no date joins the Planner, flagged |
| **Delayed** | any | **takes no drop**; a row already in it only reorders |

**No due date and no follow-up is ever written.** Each drop is one task write of both plan fields and one undo step (`todo-store.setPlan`: [the plan write](#the-plan-write), no stamp, no history event).

### The row's place

**Dropped into a group, the row also lands where it was dropped**: the place the [drag preview](planner-widget.md#the-drag-preview) holds (`services/planner-drop.planPlannerDrop`). A row dragged inside its group is reordered, with no task write. The row's new place is **merged into the tab's stored `order`** (`plannerReorder`, through `workspace-store.patchTabViewState`: saved at once, no undo step, as a list's manual order):

- The moved row goes beside its visible neighbors.
- Every task shown takes a place. One the order didn't hold goes right after the row shown before it.
- Every other stored task keeps its position relative to every other. So a task the Planner doesn't show just now (hidden by the screen filter, on a day a shifted window leaves out, completed) keeps its place.
- Only a task the todo store no longer holds (deleted, purged) leaves the order.
- The order keeps at most 1000 (`PLANNER_ORDER_MAX`). Over that, the tasks not shown go first, the earliest first.
- A drop on a tile keeps the order.

A Planner row dropped on a Calendar widget's day is the calendar's drop, as any list row's. On a list it does nothing.

## Moves without a drag

### Snooze and Unplan

- **Snooze** plans the task for the day after the day it sits on — after its planned day, for a row planned later — never earlier than tomorrow. A Delayed row goes to tomorrow. A row in Unplanned offers no Snooze.
- **Unplan** is the Unplanned drop for one row.

Both go through the same decision (`plannerSnooze`, `plannerUnplan`), so a snoozed task landing on its natural day loses its plan. They are a row's [buttons](planner-widget.md#four-planner-only-things) and entries in its [menu](planner-widget.md#menus).

### Nothing leaves the Planner silently

- A Snooze from the window's last day keeps a task with a real date in the window where that date puts it, planned later.
- One with no such date goes out of view (the strip's `›` shows it). The move that took it there — Snooze, a drop, Plan for day › — shows the snackbar naming the day, with Undo (`Planned for Fri, Nov 27`; `plannerMovePlan`'s `hidden`, from `plannerShows`).
- A fix that moves a date past the window does the same (`Moved the due date to Fri, Nov 27`).

### Unplan all Delayed and Reset plan

**Unplan all Delayed** moves every Delayed task to Unplanned (`plannerUnplanDelayed` → `services/planner-drop.unplanDelayedTasks`). It asks nothing.

**Reset plan** clears the plan state of one of three scopes (`plannerResetTasks` → `resetPlannerPlan`), each **after asking** (the shared confirm prompt: how many plans it clears, and how many of those tasks then leave the Planner):

- the days shown — every task with a plan state that the Planner shows or holds: planned days it shows, Delayed, held in Unplanned. It is named `This week` only while the window starts today, else by its range, `Nov 27 – Dec 3` (`plannerResetWeekLabel`);
- today only — the tasks planned for today;
- Delayed.

Unplan all Delayed and each reset are one write and one undo step, with the snackbar's Undo.

### A conflict's fix

**Move due date / follow-up to the planned day** is the one Planner write that touches a real date (`applyPlannerFix`). It is the ordinary task edit, the day at local midnight: stamped, undoable, in the history.

- When the task's own dates then put it on its planned day, the plan is cleared in the same edit (one undo step), so the row is no longer placed (`plannerFixClearsPlan`).
- With another, earlier date still putting it elsewhere, the plan stays.
