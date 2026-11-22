# Planner

The Planner (widget kind `planner`, under Tasks after Review, no settings) shows today and the week ahead in one widget. It is a scratch pad: **a drag only ever changes the plan, never a task's real dates**. Its components are in `components/workspace/planner`, its rules (all pure) in `utils/planner`, its writes in `services/planner-drop`, its data in `hooks/use-planner` and its in-memory state in `stores/planner-store`.

## Plan state

A task's **plan state** is one of three, kept on the task (`models/todo-item.TaskPlan`):

- none;
- a **planned day** (`TodoItem.doDate`): the day the user plans to work on the task, a day at local midnight;
- **held in Unplanned** (`TodoItem.unplanned`; only `true` is stored).

Never both. Neither field is indexed. The plan state is the Planner's: it is shown nowhere else, and no filter, expression, sort, row column, calendar, Quick Add, Markdown export or check-in reads it.

It is set in the Planner, or from **Plan for day ›** outside it (`task/plan-menu.planForDayEntries`): in every task menu — a list row's, a calendar entry's (the day popover's too), a search result's — and in the task editor's and the [review card](review.md)'s ⋯. That submenu offers:

- this week's days, read against this week's window;
- **Unplanned** — any open task joins the Planner there;
- with a plan state, **Clear plan** — reading **Remove from Planner** when that takes the task out of it (`utils/planner.plannerClearLeaves` → `services/planner-drop.clearPlannerTask`), the snackbar saying so.

A Planner's own rows have its [menu](#menus) instead.

### The plan write

Planning is not an edit. `todo-store.setPlan(ids, plan)` / `setPlans([{ id, plan }])` take `plan` as a `TaskPlan`: `{ day }`, `'unplanned'` or `null`.

- **Both fields go in the task's one write** (`store-helpers.bulkUpdateTasks`), as one undo step for all the tasks.
- The snackbar shows only where the caller asks (the Planner's bulk actions: Reset plan, Unplan all Delayed). The step is named `Planned “Title”` / `Unplanned “Title”` / `Cleared the plan of “Title”` / `Changed the plan of 3 tasks`, or in the caller's words.
- It leaves every task's `modifiedAt` as it is — on the write, its undo and its redo (which put both fields back), in the store and the database (`utils/task-stamps.KEEP_STAMPS`, a stamp that lists no task). Every other [task write](tasks.md) stamps it.
- It logs no history event and never writes a due date or a follow-up.
- It never rejects. A write that fails is taken back: a task's two plan fields together, and only while both still hold that write's values, so overlapping failures can't leave a planned day beside `unplanned` (`bulkUpdateTasks`' `together`). The tasks are read back, the user is told (`Couldn't save the plan of “Title”.`) and it resolves `false`.

What other operations do with the plan state:

- Completing a repeating task clears it on the next occurrence (the checkbox and the bulk path — a check-in reply's too); the undo puts it back.
- Duplicate doesn't copy it.
- Make subtask of… drops it without naming it.
- Exports, backups, the sync file, task archives and the append import carry it. A file holding both fields keeps the planned day.

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

## The window

The window is seven days from today plus a whole number of weeks, never before this week.

- It is the tab's in its layout, in memory and gone with a reload (`stores/planner-store`, by layout id and tab id).
- Keyed that way, the widget popup's remount keeps it ([Open larger](widget-chrome.md)), while a duplicated layout, which keeps its tabs' ids, starts on this week.
- A tab that stops being a Planner loses it (`use-planner.usePlannerWindowsOf`).

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

## Hand order

Inside a group the tasks follow the tab's **hand order** (`PlannerTabViewState.order`): task `uid`s, one sequence for the widget, view state, written by a drop into a group (see [The row's place](#the-rows-place)). The rest come after them by reason (due, follow-up, plan, held, Focus), then date, then `sortOrder` (`plannerOrder`).

## Faces

`utils/widget-face.plannerFaceFor` picks the [face](widget-chrome.md):

| Face | When |
|---|---|
| Large: the strip, then two panes | from 720 × 300px |
| Medium, the portrait layout | a tall, narrow cell (`utils/widget-face.plannerPortrait`: under 720px wide, at least 560px tall and 1.4 × as tall as wide; not the phone) |
| Medium: the strip over one column — Today, the days ahead, Delayed, the Unplan button, Unplanned, in that order in one scroll | narrower or shorter, not tall; the phone |
| Small: its name and `Today N`, a click opening it larger | as every widget's |

### The strip

`PlannerStrip` draws `‹`, seven tiles of one width (weekends too) and `›`.

- A thin rule in a slightly wider gap stands before the tile that starts a week, by Settings' first day of the week (`settings-store.weekStartsOn`, the calendar's), never before the first tile.
- **A tile's click scrolls the day list to its day** — smoothly, at once under reduced motion — and picks nothing.
- A tile's name says its marks (`Mon, Nov 23: 2 tasks, 1 due, 1 planned`).
- The arrows move the window a week. `‹` is off on this week.
- In a widget 520px wide or less, the strip stacks each tile's weekday, date and count and draws no ticks.
- A widget under 300px wide has the two arrows around the range in words instead of tiles.

### Large: two panes

- On the left, **one scrolling list of days**: Today, then every later day of the window in order. A day with nothing on it is a quiet heading (its name muted, no count) that still takes a drop.
- On the right, on a darker ground (`--color-inset-deep`), the trays in a scroll of their own:
  - **Delayed**, only while it holds a task;
  - the **↓ Unplan** button, centered on a hairline rule, shown with Delayed, named `Unplan all Delayed tasks`, its tooltip `Move all Delayed tasks to Unplanned`;
  - **Unplanned**, always there, reading `Nothing unplanned` while empty.

### Medium: the portrait layout

The strip sits over the days in one scroll. Under them **the trays dock** (`planner/PlannerDock`): Delayed, the Unplan button and Unplanned on the darker ground, in a scroll of their own.

- The dock's top edge is a separator sharing the height. A drag moves it, ↑ / ↓ step it 16px and a double-click resets it. The share is saved as the tab's view state `dockShare` (default 0.38).
- Its chevron folds it (`dockFolded`) to one bar — `Delayed 2 · Unplanned 6` — that unfolds on a click and is a drop target meaning Unplanned.
- Alone in its cell, the week arrows sit in the top line around the range.
- The narrow tiles keep their ticks.
- A 2px line under the tiles marks the days whose groups show in the day list (`planner-dock.useDaysInView`).

## Top line and Reset plan

Alone in its cell, the Planner's top line reads:

- `Planner`;
- the window's range (`Nov 20 – 26`; shifted, a button back to this week);
- a badge capsule: what it holds that is due and due for a follow-up, in Settings' tab-badge ranges (as a [list tab's badge](lists.md));
- at its end, **Reset plan**: an icon and the words, the icon alone in a widget 420px wide or less.

**Reset plan** opens a menu of **This week** (the shown range while the window is shifted) · **Today only** · **Delayed**. Each shows the count of tasks it would clear (`plannerResetCounts`) and is inert at 0 ([what each clears](#unplan-all-delayed-and-reset-plan)).

A cell of tabs and the widget popup have no top line, so the same three are under **Reset plan ›** in the widget's ⋯ menu (`planner/planner-reset`: `usePlannerResetEntries`, and `usePlannerMenuEntries` through `cell-menu.useWidgetMenuContent`).

Both read what the drawn Planner reports (`planner-store.resets`, written by `hooks/use-planner` from the view it already holds: the counts, the first choice's name and the action). So the view is built once per change, and a cell with no Planner reads nothing. A Planner that isn't drawn (a tab behind another) offers none.

## Rows

Rows are the app's task rows as a [list](lists.md) draws them:

- the list's draggable row (`list/ListWidgetRow`: the tab's id its scope, the group's key its section), or `MobileTaskRow` on the phone;
- at Settings' Default list zoom (Auto by each pane's width: Stacked under 480px);
- one `TaskRowGrid` per pane;
- under headers in the list's group-header look (name, count, a rule; no count on an empty day).

A click opens the task. There is no selection or bulk bar. The Planner is no list widget: `LIST_WIDGET_ATTR` is absent, so the list zoom never finds it.

### Four Planner-only things

`planner/PlannerRowExtras` draws them. The parts inside the row reach it through `task/task-row-extras.TaskRowExtrasContext` — `(todo) => { tag?, actions?, late? }`, read by `TaskRow`, `TaskLine` and the phone row's details. The context is null without a provider, so a list's rows, the task dialog's and the drag overlay's copy draw exactly as they did.

1. **A corner flag** on every placed row: a 9px filled triangle at the row's top-left in the secondary text color, taking no press.
   - The Planner draws it around the row (`PlannerRowWrap`), so it shows over the hover fill, over the slot a lifted row leaves, at every zoom and on the phone.
   - It is drawn only. Its words are in the row's accessible description (`plannerRowStateWords` → `TaskRowExtras.description`, on the row's checkbox, a line, the phone row's button): `planned`, `planned for Wed` on a Delayed row, `set aside`.
2. **A tag** after the title (`utils/planner.plannerRowTag`). A Stacked row's leads its details line; the phone's is on a line under the row.
   - A Delayed row: its planned day in words (`Wed`; past six days `Nov 12`), muted.
   - A held row: its natural day, muted.
   - A row planned past a real date: `1 day after due` / `2 days after follow-up` (the due date's when both are passed), in the deadline color.
   - A row planned later: `planned Fri, Nov 27`, muted, its date drawn late too.
   - The last two are buttons whose menu lists that row's fixes (`plannerFixLabel`: `Move due date to Tue, Nov 24`, `Plan for Mon, Nov 23`). Esc hands the focus back to the tag.
3. **The date the plan falls after, drawn late** (bold over its type's faint band) though it may not be past. This is the look only: its name and tooltip are unchanged.
4. **Snooze** and **Unplan** text buttons at the title's end, on the row's hover and focus (in the row's hover cluster). None on a screen with no hover, on a Lines row or on the phone. A row in Unplanned has neither, nothing there being planned to put off. It has:
   - **Today** — the drop on today (`planner-drop.planPlannerTaskToday`);
   - when held there (flagged), **Remove** — its plan cleared, out of the Planner — or, when a date in the window or Focus keeps it there, **Clear** (`clearPlannerTask`).

Pressed from the keyboard — the buttons, a fix from a menu opened with Enter — **the focus follows the row** (`planner/planner-focus`): to the row at its new place, on the same control when it has it. When the row left the view, it goes to the row that took its place, else to its group's heading.

## Drops

Desktop only: the phone has no drag.

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

**Dropped into a group, the row also lands where it was dropped.** A row dragged inside its group is reordered, with no task write. The row's new place is **merged into the tab's stored `order`** (`plannerReorder`, through `workspace-store.patchTabViewState`: saved at once, no undo step, as a list's manual order):

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

Both go through the same decision (`plannerSnooze`, `plannerUnplan`), so a snoozed task landing on its natural day loses its plan.

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

## Drag feedback

While a task is dragged over the Planner (`use-planner-drag` → `planner-store.drag`, from dnd-kit's `over` and the pointer over the groups as measured when the drag started):

- The target's tile and group are dashed in one neutral color, since no real date changes (`data-planner-drop`).
- The list's blank drop slot shows where the row would land. The looks are the list's: the dragged row is its slot in its own group, or faded in place when headed elsewhere, and the others are dimmed while they make room.
- **The lifted row carries a label** under it — above it at the window's foot — saying what the drop does to the plan (`PlannerDragLabel`, in the page's drag overlay): `Plan · Wed, Nov 25`, `Unplan`, or — the plan cleared on the task's own date's day — `Its date · Wed, Nov 25`.
- A refused target has no mark, no slot and no label, and shows the not-allowed cursor.
- A drop that moves the row to another group lands where it was let go. A reorder settles onto the row.

## Menus

A row's task menu in a Planner — right-click, Shift+F10, the phone's long-press — carries the same moves without a pointer (`planner-menu`, through `TaskMenuExtrasContext`):

- **Plan for day ›** — its submenu a muted first line (`Plans it for that day`), then Today and the window's days in words, the day the row sits on checked. A pick is the drop on that day.
- **Snooze**, naming the day it plans for. None on a row in Unplanned.
- **Unplan** — off, with its reason in a tooltip, for a row in Unplanned already.
- On a placed row, **Clear plan** (**Remove from Planner** when that takes it out).

## Completed rows and the phone

- A row completed here lingers, then folds, as a list's (`hooks/use-planner` over `useLeavingRows`).
- Under Today's rows, **`N done`** lists the tasks completed today (the tally's count, `utils/tally.tasksDoneToday`), struck, on one line.
- Today has no Add task row.
- On the phone, a day with no tasks and an empty Unplanned are left out (a tile's tap goes to the next day that has a group), and a completed row leaves at once.
