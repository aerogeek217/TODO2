# The Planner widget

How the [Planner](planner.md) is drawn: its faces, its rows, the feedback during a drag and its menus. The rules it draws (where a task sits, what a drop writes) are in [planner](planner.md).

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
- A tile's name says its [marks](planner.md#the-view) (`Mon, Nov 23: 2 tasks, 1 due, 1 planned`).
- The arrows move the [window](planner.md#the-window) a week. `‹` is off on this week.
- In a widget 520px wide or less, the strip stacks each tile's weekday, date and count and draws no ticks.
- A widget under 300px wide has the two arrows around the range in words instead of tiles.

### Large: two panes

- On the left, **one scrolling list of days**: Today, then every later day of the window in order. A day with nothing on it is a quiet heading (its name muted, no count) that still takes a drop.
- On the right, on a darker ground (`--color-inset-deep`), the trays in a scroll of their own:
  - **Delayed**, only while it holds a task;
  - the **↓ Unplan** button, centered on a hairline rule, shown with Delayed, named `Unplan all Delayed tasks`, its tooltip `Move all Delayed tasks to Unplanned` ([what it writes](planner.md#unplan-all-delayed-and-reset-plan));
  - **Unplanned**, always there, reading `Nothing unplanned` while empty.

### Medium: the portrait layout

The strip sits over the days in one scroll. Under them **the trays dock** (`planner/PlannerDock`): Delayed, the Unplan button and Unplanned on the darker ground, in a scroll of their own.

- The dock's top edge is a separator sharing the height. A drag moves it, ↑ / ↓ step it 16px and a double-click resets it. The share is saved as the tab's view state `dockShare` (default 0.38).
- Its chevron folds it (`dockFolded`) to one bar — `Delayed 2 · Unplanned 6` — that unfolds on a click and is a drop target meaning Unplanned.
- Alone in its cell, the week arrows sit in the [top line](planner.md#top-line-and-reset-plan) around the range.
- The narrow tiles keep their ticks.
- A 2px line under the tiles marks the days whose groups show in the day list (`planner-dock.useDaysInView`).

## Rows

Rows are the app's task rows as a [list](lists.md) draws them:

- the list's draggable row (`list/ListWidgetRow`: the tab's id its scope, the group's key its section), or `MobileTaskRow` on the phone;
- at Settings' Default list zoom (Auto by each pane's width: Stacked under 480px);
- one `TaskRowGrid` per pane;
- under headers in the list's group-header look (name, count, a rule; no count on an empty day).

A click opens the task. There is no selection or bulk bar. The Planner is no list widget: `LIST_WIDGET_ATTR` is absent, so the list zoom never finds it.

### Four Planner-only things

`planner/PlannerRowExtras` draws them. The parts inside the row reach it through `task/task-row-extras.TaskRowExtrasContext` — `(todo) => { tag?, actions?, late? }`, read by `TaskRow`, `TaskLine` and the phone row's details. The context is null without a provider, so a list's rows, the task dialog's and the drag overlay's copy draw exactly as they did.

1. **A corner flag** on every [placed](planner.md#where-a-task-sits) row: a 9px filled triangle at the row's top-left in the secondary text color, taking no press.
   - The Planner draws it around the row (`PlannerRowWrap`), so it shows over the hover fill, over the slot a lifted row leaves, at every zoom and on the phone.
   - It is drawn only. Its words are in the row's accessible description (`plannerRowStateWords` → `TaskRowExtras.description`, on the row's checkbox, a line, the phone row's button): `planned`, `planned for Wed` on a Delayed row, `set aside`.
2. **A tag** after the title (`utils/planner.plannerRowTag`). A Stacked row's leads its details line; the phone's is on a line under the row.
   - A Delayed row: its planned day in words (`Wed`; past six days `Nov 12`), muted.
   - A held row: its natural day, muted.
   - A row planned past a real date: `1 day after due` / `2 days after follow-up` (the due date's when both are passed), in the deadline color.
   - A row planned later: `planned Fri, Nov 27`, muted, its date drawn late too.
   - The last two are buttons whose menu lists that row's [fixes](planner.md#conflicts) (`plannerFixLabel`: `Move due date to Tue, Nov 24`, `Plan for Mon, Nov 23`). Esc hands the focus back to the tag.
3. **The date the plan falls after, drawn late** (bold over its type's faint band) though it may not be past. This is the look only: its name and tooltip are unchanged.
4. **Snooze** and **Unplan** text buttons ([what they do](planner.md#snooze-and-unplan)) at the title's end, on the row's hover and focus (in the row's hover cluster). None on a screen with no hover, on a Lines row or on the phone. A row in Unplanned has neither, nothing there being planned to put off. It has:
   - **Today** — the drop on today (`planner-drop.planPlannerTaskToday`);
   - when held there (flagged), **Remove** — its plan cleared, out of the Planner — or, when a date in the window or Focus keeps it there, **Clear** (`clearPlannerTask`).

Pressed from the keyboard — the buttons, a fix from a menu opened with Enter — **the focus follows the row** (`planner/planner-focus`): to the row at its new place, on the same control when it has it. When the row left the view, it goes to the row that took its place, else to its group's heading.

## Drag feedback

While a task is dragged over the Planner (`use-planner-drag` → `planner-store.drag`, [the drag preview](#the-drag-preview), from dnd-kit's `over` and the pointer over the groups as measured when the drag started):

- The target's tile and group are dashed in one neutral color, since no real date changes (`data-planner-drop`).
- The list's blank drop slot shows where the row would land. The looks are the list's: the dragged row is its slot in its own group, or faded in place when headed elsewhere, and the others are dimmed while they make room.
- **The lifted row carries a label** under it — above it at the window's foot — saying what the drop does to the plan (`PlannerDragLabel`, in the page's drag overlay): `Plan · Wed, Nov 25`, `Unplan`, or — the plan cleared on the task's own date's day — `Its date · Wed, Nov 25`.
- A refused target has no mark, no slot and no label, and shows the not-allowed cursor.
- A drop that moves the row to another group lands where it was let go. A reorder settles onto the row.

What the drop then writes is [the drop rule](planner.md#the-drop-rule).

### The drag preview

`planner-store.drag` (a `PlannerDragPreview` or null, set by `setDrag`) is the task drag over a Planner now: `{ tabId, over: 'tile' | 'group', key, drop, index }`.

- `tabId`: the Planner under the pointer.
- `over`: what is hovered.
- `key`: the target's key. A day's is its `dayKey`, which Today's group and today's tile share; a tray's is `delayed` or `unplanned`.
- `drop`: what a drop there does to the task's plan (`utils/planner.PlannerDrop`).
- `index`: over a group, the place the row would land at, before row `index` of the group's rows without it. It is null with no place: a tile, a refused drop, a task the drop wouldn't bring into the group.

That Planner's `use-planner-drag` sets and clears it. Its readers:

- the Planner's tiles and groups, for the marks and the slot;
- the page's drag overlay, for the label (`PlannerDragLabel`);
- the drop itself, for the place (`services/planner-drop.planPlannerDrop`).

It is state in a zustand store, so the test setup resets it.

## Menus

A row's task menu in a Planner — right-click, Shift+F10, the phone's long-press — carries the same moves without a pointer (`planner-menu`, through `TaskMenuExtrasContext`):

- **Plan for day ›** — its submenu a muted first line (`Plans it for that day`), then Today and the window's days in words (the planned day checked, the row's due and follow-up days noted), then **Pick a date…**. A pick plans that day outright, the row's own date's day too; only a drag there clears the plan.
- **Snooze**, naming the day it plans for. None on a row in Unplanned.
- **Unplan** — off, with its reason in a tooltip, for a row in Unplanned already.
- On a placed row, **Clear plan** (**Remove from Planner** when that takes it out).

The task menus outside a Planner have their own **Plan for day ›**: see [Plan state](planner.md#plan-state).

## Completed rows and the phone

- A row completed here lingers, then folds, as a list's (`hooks/use-planner` over `useLeavingRows`).
- Under Today's rows, **`N done`** lists the tasks completed today (the tally's count, `utils/tally.tasksDoneToday`), struck, on one line.
- Today has no Add task row.
- On the phone, a day with no tasks and an empty Unplanned are left out (a tile's tap goes to the next day that has a group), and a completed row leaves at once.
