# Planner

The Planner (widget kind `planner`, under Tasks after Review; its one setting is the [Unplanned filter](#the-unplanned-filter)) shows today and the week ahead in one widget. It is a scratch pad: **a drag only ever changes the plan, never a task's real dates**. Its components are in `components/workspace/planner`, its rules (all pure) in `utils/planner`, its writes in `services/planner-drop`, its data in `hooks/use-planner` and its in-memory state in `stores/planner-store`.

This file is the rules: a task's plan state, where a task sits, the Unplanned filter, the window, what a drop writes, and the moves without a drag. How the widget is drawn (its faces, its rows, drag feedback and menus) is in [planner-widget](planner-widget.md).

## Plan state

A task's **plan state** is a **planned day** or none, kept on the task (`models/todo-item.TaskPlan`): `doDate?: Date` on `TodoItem`, the day the user plans to work on the task, a day at local midnight. It is not indexed. Nothing is put in the Planner by hand: a task with no plan shows there only by its own dates or the Unplanned filter. Besides the Planner, the plan state is shown and set in the task layout's [Planned cell](review.md#the-fact-band) (the task editor and the review card) and named on the review's medium card; Quick Add's `/plan <date>` sets it on a new task ([Creating](tasks.md#creating)). The [Calendar](workspace-layout.md#the-calendar) shows a planned day as a plan entry (Plans, a date type) and a drag of it plans the task for another day outright. Filters read it as the **Planned** date type (`DateField` `planned`), and lists sort and group by it; no row column, Markdown export or check-in message reads it.

It is set in the Planner, or from **Plan for day ›** outside it (`task/plan-menu.planForDayEntries`): in every task menu — a list row's, a calendar entry's (the day popover's too), a search result's — and in the task editor's and the [review card](review.md)'s ⋯. That submenu offers:

- this week's days, read against this week's window, the task's due and follow-up days noted (`due`, `follow-up`) and its planned day checked. A pick **plans that day outright**, the task's own date's day too (a `pick` target, `PlannerTarget.pick`); only a [drag](#the-drop-rule) onto that day clears the plan;
- **Pick a date…** — any day from today on, in the browser's date picker (`shared/pick-date`: one hidden date input of the page's own, since the menu is gone by then), planned the same way;
- with a plan state, **Clear plan** — reading **Remove from Planner** when that takes the task out of it (`utils/planner.plannerClearLeaves` → `services/planner-drop.clearPlannerTask`), the snackbar saying so.

A Planner's own rows have its [menu](planner-widget.md#menus) instead.

### The plan write

Planning is not an edit. `todo-store.setPlan(ids, plan, description?, snackbar?)` writes one plan to every task in `ids`; `setPlans([{ id, plan }], description?, snackbar?)` takes a plan per task (`TaskPlanChange`). `plan` is a `TaskPlan`:

| `plan` | Written |
|---|---|
| `{ day }` | `doDate` at local midnight |
| `null` | `doDate` removed |

- **Every task in one database write and one undo step** (`store-helpers.bulkUpdateTasks`). Only the tasks whose plan changes are written.
- The snackbar and its Undo show only when `snackbar` is passed: Reset plan, Clear Delayed plans, and a plan that takes the task out of view or out of the Planner ([nothing leaves silently](#nothing-leaves-the-planner-silently), Remove from Planner). The step is named `description`, else `Planned “Title”` / `Cleared the plan of “Title”` / `Changed the plan of 3 tasks`.
- It leaves every task's `modifiedAt` as it is — on the write, its undo and its redo, in the store and the database (`utils/task-stamps.KEEP_STAMPS`, a stamp that lists no task). Every other [task write](tasks.md) stamps it.
- It logs a `planned` event (the planned day before and after, as the repository's diff logs every `doDate` write, its undo and its redo too) and never writes a due date or a follow-up.
- It never rejects. A write that fails is taken back, only where the task still holds that write's day. The tasks are read back, the user is told (`Couldn't save the plan of “Title”.`) and it resolves `false`; otherwise `true`.

What other operations do with the plan state:

- Completing a repeating task clears it on the next occurrence (the checkbox and the bulk path — a check-in reply's too); the undo puts it back.
- Duplicate doesn't copy it.
- Make subtask of… drops it without naming it.
- Exports, backups, the sync file, task archives and the append import carry it.

## Which tasks it holds

The Planner holds the open tasks the [screen filter](screen-filter.md) shows (`useScreenTasks`) that have a plan state, have a natural day, or match its [Unplanned filter](#the-unplanned-filter) (`inPlanner`).

A task's **natural day** (`utils/planner.plannerNaturalDay`) is the earlier of its next follow-up and its due date, when that date is on or before the window's last day. A date before today counts as today. When both fall on the same day, it is the due date's.

## Where a task sits

`plannerPlacement` decides, top row first:

| The task | Where it sits |
|---|---|
| Planned for a day before today | the **Delayed** tray (nothing joins Today on its own) |
| Planned for a day inside the window, today included | that day |
| Planned for a day past the window's last day (**planned later**) | its natural day when it has one — a real date inside the window, or overdue, still shows the task, as a placed row there; else not shown in this window |
| No plan, a natural day | its natural day |
| No plan, no natural day, matching the Unplanned filter | the **Unplanned** tray |
| No plan, no natural day, not matching it | not in the widget |

A row is **placed** when it has a plan state.

The planned day is the `doDate`'s day (`plannerPlannedDay`). A plan on the very day of the task's due date or follow-up is a plan like any other: the row is placed and carries its plan mark, and once the day has passed it is in Delayed.

### Conflicts

A row on its planned day — and one planned later — carries its **conflicts** (`PlannerConflict`): each real date the plan falls after (the due date, the follow-up), by how many days, with the fixes on offer:

- move that date to the planned day (always);
- plan for that date's day, outright (only when it is today or later).

The row shows them in its [tag](planner-widget.md#four-planner-only-things); what a fix writes is under [A conflict's fix](#a-conflicts-fix).

## The Unplanned filter

**What joins Unplanned** is the tab's filter, `PlannerTab.config.unplanned` (a `TodoPredicate`, layout config):

- Absent, it is Focus (`plannerUnplannedFilter`: `/focus`), the default of every Planner.
- Empty, nothing joins: Unplanned stays empty.
- It decides **Unplanned only**. A task with a date in the window sits on its day, matching or not.
- The hook evaluates it with a list's matcher (`matchesFilterWithLookups`) over the tasks the screen filter already narrowed, and hands it to the rules in the window (`PlannerJoins`, `window.joins`). Every rule that asks whether a task joins Unplanned reads it: the placement, `inPlanner`, and whether clearing a plan takes a task out of the Planner (`plannerClearLeaves`: Clear vs Remove, Unplan, Clear Delayed plans).
- It is asked of the task as it would be with no plan state.
- Outside a Planner (Plan for day › in a task menu, the task layout's Planned cell) there is no tab: the rules read Focus.
- The layout repair reads it as a list's predicate. One that is no predicate is dropped (Focus again), a fix.

How it is shown and edited is in [The Unplanned filter's editor](planner-widget.md#the-unplanned-filters-editor).

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
- `dates` — the real dates falling on it: one mark per due date and per follow-up of every open task, wherever it is planned. A late one counts on today's tile;
- `plans` — the tasks whose planned day it is.

They are drawn as the tile's ticks (`utils/day-ticks.dayTicks`, drawn by `shared/DayTicks` — the Calendar's small day cells draw the same): a **solid tick** per real date — due dates in the deadline color, then follow-ups in the follow-up color — then a **hollow tick** (outlined, in the secondary text color) per plan. Eight in all, then `+N`.

Where each part is drawn is in [Faces](planner-widget.md#faces).

## Hand order

Inside a group the tasks follow the tab's **hand order** (`PlannerTabViewState.order`): task `uid`s, one sequence for the widget, view state, written by a drop into a group (see [The row's place](#the-rows-place)). The rest come after them by reason (due, follow-up, plan, the Unplanned filter), then date, then `sortOrder` (`plannerOrder`).

## Top line and Reset plan

Alone in its cell, the Planner's top line reads:

- `Planner`;
- the window's range (`Nov 20 – 26`; shifted, a button back to this week);
- a badge capsule: what it holds that is due and due for a follow-up, in Settings' tab-badge ranges (as a [list tab's badge](lists.md));
- the [week load](week-load.md) meter (`19 / 13`); in a widget 540px wide or less, a slim bar across the top of the body instead;
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
| | planned for `T` and sits there | nothing (the order only): a plan on its natural day is kept |
| | `T` is its natural day | whatever plan state it has is cleared (`own`) — a later plan too; with none to clear, nothing |
| | sits there already | nothing (the order only) |
| | any other | planned for `T` (`plan`: `doDate = T`) |
| **Unplanned** | sits there already | nothing (the order only) |
| | planned | its plan cleared (`unplan`): back to its natural day, kept in Unplanned by the Unplanned filter, or out of the Planner, [said so](#nothing-leaves-the-planner-silently) |
| | any other | refused: nothing is put in Unplanned by hand |
| **Delayed** | any | **takes no drop**; a row already in it only reorders |

**Only a drag is a drop.** Every other move to a day is a pick (`target.pick`) and plans the day outright, `T` its natural day too: Plan for day ›, Pick a date…, the Planned field's day, a conflict's Plan for {day}, Snooze and an Unplanned row's Today. Nothing is written only when it is planned for `T` already, and a day before today is refused.

**No due date and no follow-up is ever written.** Each drop is one task write of the plan and one undo step (`todo-store.setPlan`: [the plan write](#the-plan-write), no stamp, a `planned` event).

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
- **Unplan** is the Unplanned drop for one row: its plan cleared.

Both go through the same decision (`plannerSnooze`, `plannerUnplan`). Snooze is a pick: a task landing on its natural day is planned for it. They are a row's [buttons](planner-widget.md#four-planner-only-things) and entries in its [menu](planner-widget.md#menus).

### Nothing leaves the Planner silently

- A Snooze from the window's last day keeps a task with a real date in the window where that date puts it, planned later.
- One with no such date goes out of view (the strip's `›` shows it). The move that took it there — Snooze, a drop, Plan for day › — shows the snackbar naming the day, with Undo (`Planned for Fri, Nov 27`; `plannerMovePlan`'s `hidden`, from `plannerShows`). Outside a Planner there is none to leave, so a day picked past the week shows no snackbar.
- An Unplan — a drop on Unplanned, the row's button or menu — whose task then shows nowhere (no date in the window, not matching the Unplanned filter) takes it out of the Planner, and the snackbar says so, with Undo (`Removed “Title” from the Planner`; `plannerMovePlan`'s `leaves`, from `plannerClearLeaves`).
- A fix that moves a date past the window does the same (`Moved the due date to Fri, Nov 27`).

### Clear Delayed plans and Reset plan

**Clear Delayed plans** clears the plan of every Delayed task (`plannerClearDelayed` → `services/planner-drop.clearDelayedPlans`): each goes back to its natural day, joins Unplanned by the filter, or leaves the Planner. It asks nothing; its snackbar says how many left, as Reset plan says it (`Cleared 3 Delayed plans. 1 of them left the Planner.`).

**Reset plan** clears the plan state of one of three scopes (`plannerResetTasks` → `resetPlannerPlan`), each **after asking** (the shared confirm prompt: how many plans it clears and how many of those tasks then leave the Planner, those named one per line under it — `Planned Thu, Nov 26` — as the prompt's `list`):

- the days shown — every task with a plan state that the Planner shows: planned days it shows and Delayed. It is named `This week` only while the window starts today, else by its range, `Nov 27 – Dec 3` (`plannerResetWeekLabel`);
- today only — the tasks planned for today;
- Delayed.

Clear Delayed plans and each reset are one write and one undo step, with the snackbar's Undo.

### A conflict's fix

**Move due date / follow-up to the planned day** is the one Planner write that touches a real date (`applyPlannerFix`). It is the ordinary task edit, the day at local midnight: stamped, undoable, in the history.

- When the task's own dates then put it on its planned day in the window (its natural day), the plan is cleared in the same edit (one undo step), so the row is no longer placed (`plannerFixClearsPlan`).
- With another, earlier date still putting it elsewhere, or the planned day past the window, the plan stays.

The task layout's Planned cell offers the same fixes outside a Planner (`applyPlannerFix` with no tab, this week's window): a date moved out of view there shows no snackbar.
