# Changelog

What changed in TODO2, newest first. One entry per deployment (a push to `main`, which publishes the online app and
the offline file).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). TODO2 has no version numbers, so an
entry is headed by its deployment date. Each entry groups its changes as:

- **Added**: new features
- **Changed**: changes to how existing features work
- **Deprecated**: features that still work but are on their way out
- **Removed**: features taken out
- **Fixed**: bug fixes
- **Security**: fixes for vulnerabilities

An entry names the **data version** when the deployment changes how data is stored. A browser's data and a sync file
are upgraded on first use; an older copy of the app can no longer open them afterwards.

History before 2026-11-19 is in the git log.

## Unreleased

### Changed

- **Expand row and Expand column look alike.** Both are now a bordered button with the same unfold icon — up and down
  for a collapsed row, left and right for a collapsed column. The cell menu's Expand row and Expand column show the
  same icon.
- **List board tiles share the row.** Tiles widen to fill the space instead of leaving empty room at the end, and
  are all the same width. A tile's task count stays beside its name: a long name shortens with "…" first.

## 2026-11-23, second deployment

Data version 89. A browser's data and a sync file are upgraded on first use; an older copy of the app can't open
them afterwards.

### Added

- **Today's tally opens a list.** Click the tally marks in the top bar to see the tasks you completed today.
- **Show widget names** (Settings › Appearance › Theme). Off by default: a widget alone in its cell (Notes, the
  Neglect map, Work clusters, the Planner, the List board) no longer spends a line on its name. Turn it on to bring
  the names back.
- **Collapse a column.** Hover the line between two columns and press ◂ or ▸ on the small pill that appears: that
  column folds to a thin strip naming its widgets, and the other columns take its room. Click a name to open that
  widget larger; click ›‹ at the strip's top to bring the column back. Collapse column is also in a widget's ⋯ menu
  and in the column's menu while editing the layout. A collapsed column is saved with the layout, so it syncs.
- **The same pill collapses rows.** Hover the line between two rows for ▴ ▾: collapse the row above or below.

### Changed

- **The List board replaces Shortcuts and the List wall.** One widget (Add widget › Tasks › List board) shows a tile
  per list: the lists you pick from any layout, or every list in this layout — choose with Which lists in its ⋯ menu.
  A tile shows the list's icon, badge and count, a colored square per open task (overdue, due soon, follow-up late,
  on track, stale; click one to open the task), then its first task titles as room allows. Click a tile to open the
  list; a list of this layout also offers Show in its cell. Tiles are narrower, so more fit on a row, and the color
  legend ends each tile's tooltip. Your Shortcuts widgets become List boards of the lists you picked, and each List
  wall becomes a List board showing this layout's lists.
- **Calmer layout editing.** Edit layout gives the cards room: a margin around the layout and wider gaps between
  cells (the cards shrink a little while you edit). Column letters and row numbers sit in that margin, outside the
  cards, and light up for the card you select. The plus signs are gone: select a card and labeled tabs beside it add
  a Row above, Row below, Column left or Column right, showing the new row or column while you point at them. The
  selected card carries its own toolbar (Split, Merge, Remove and its menu), and each neighbor it can merge with shows
  a button such as "Merge as tabs with Tasks" that shows the result before you click.
- **The funnel clears the filter again.** One click on the top bar's funnel clears every filter, and the snackbar's
  Undo brings it back. Pausing moved to a small ⏸ button at the right end of the filter field, which shows while a
  filter is on; ▶ resumes it.
- **Due and Planned are date fields, like Follow-up's.** In the task editor and the review card, type a date
  (`fri`, `11/30`, `2w`) or click the calendar once to pick one. Repeat is the ↻ button in the Due field, lit while
  the task repeats: click it to set Repeat every or Stop repeating. Planned takes today or later, and its × clears the
  plan.
- **The Planner's plan is a day, or none.** Tasks are no longer put in Unplanned by hand: Unplanned shows the tasks
  with no day that its filter brings in (Focus tasks, to begin with). Unplan, and dropping a planned task on
  Unplanned, clear its plan, so it goes back to its own date's day; one with no date in the week leaves the Planner,
  and the snackbar says so with Undo. Delayed's button is now Clear plans. Plan for day no longer offers Unplanned,
  and filters lose "held in Unplanned" (`unplanned`). Tasks you had set aside in Unplanned go back to their own day.

### Fixed

- In Edit layout, the selected card's toolbar no longer runs off the right edge of the window or covers the card
  above it, and a collapsed card shows its name once.
- The Planner's done tasks open again: click a title on Today's "done" line to open that task.

## 2026-11-23

Data version 87, unchanged — and now the oldest this version reads (see Removed).

### Added

- **Shortcuts.** A new widget (Add widget › Tasks › Shortcuts) keeps lists from any layout in reach: a tile per list
  shows its icon, its due and follow-up badge, how many tasks it has, its first few tasks and its layout. Click a tile
  to open the list over the layout you are on. Add lists with Add a list, remove one from its right-click menu and
  drag the tiles into the order you like. In a smaller cell the tiles drop their task titles first, then sit in one
  line, then become rows.

### Changed

- **A wider task editor.** The task editor is 1040px wide and the facts row gives Status room for its full name; Due
  and Planned are a little wider too. A review card keeps the six facts on one line from about 770px.
- **A full calendar day shows ticks, not `+6 more`.** When a month day or week row can't show every task, its last
  line draws a tick for each task left out, as the Planner's strip does: solid for a due date or follow-up, hollow for
  a plan. A click still opens the whole day.
- **Unplanned filter.** The Planner's ⋯ entry and the words under Unplanned are named **Unplanned filter**.
- **Reset plan names what leaves.** When a reset would take tasks out of the Planner — held in Unplanned, or on a day
  only because they were planned — the question lists them before you confirm.
- **Plan for day** no longer opens with a "Plans it for that day" line.

### Removed

- Backups, exports and sync files saved before the 2026-11-22 version (data version below 87) no longer load, and
  neither does a browser's data from before it: open them in the 2026-11-22 version first.

## 2026-11-22

Data version 87. Older copies of the app will refuse the data once it is upgraded: update them, the offline file on
another computer included.

### Added

- **The planned date, shown and set like due and follow-up.** The day you plan to work on a task (the Planner's plan)
  now appears wherever dates do:
  - **On the Calendar**, with a new **Plans** toggle beside Due and Follow-up. A plan is a line with a hollow bar;
    drag it to another day to plan the task for that day (its due date and follow-up stay put). A plan whose day has
    passed shows faded. When you drop a list row on a calendar day showing more than one kind of date, the menu
    offers **Plan** beside Due date and Follow-up (`P`).
  - **In filters.** The date filter has **Planned**, with Any, None and **Only tasks held in Unplanned**. Filter
    expressions take `planned` like any date word (`planned fri`, `planned < today`, `planned none`) and the shortcut
    `unplanned`; the Syntax sheet lists them.
  - **In lists**: sort by Planned (earliest first), or group by it: Delayed · Today · This Week · Later · Unplanned ·
    Not planned.
  - **In task details and the review card**, as **Planned** beside Due: click it to plan the task for a day, hold it in
    Unplanned or clear the plan. It says when the plan falls after the task's due date or follow-up, and offers the
    Planner's fixes. The Review widget's medium card shows it too.
  - **In Quick Add**: `/plan fri` plans the new task for that day.
  - **Pick a date…** in every **Plan for day ›** menu plans any day, not only this week's.
  - Setting a plan never changes a task's Modified date, wherever you set it.
- **Choose what joins the Planner's Unplanned tray.** Unplanned used to take Focus tasks with no date; now it takes
  whatever its filter says (Focus to begin with), such as `/focus or #errands`, or nothing at all, so only what you
  unplan by hand is there. Click the filter's words under Unplanned, or **What counts as unplanned…** in the widget's
  ⋯ menu.

### Changed

- **The date filter picks its date from a menu.** One button names the date being edited, with how many dates are
  filtering; its menu lists every date, the filtering ones lit with what they filter.
- **A more compact facts row** in the task editor and review cards. Priority shows as three icons (Urgent tinted when its due
  date makes the task urgent), Due and Planned put their words under the date, and a task's repeat is set by clicking its due
  date. All six facts stay on one row, with the editor back at its usual width.
- **Picking a day plans that day**, even the task's own due or follow-up day: in Plan for day ›, Snooze and an
  Unplanned row's Today button. Only dragging a task in the Planner onto its own date's day clears its plan.
- **A plan on a task's due day stays a plan.** It is placed and flagged in the Planner like any other plan, and goes to
  Delayed once the day has passed.
- **Small calendars mark their days with ticks**, as the Planner's day strip does: a solid tick per due date and
  follow-up, a hollow tick per plan. This applies to the Calendar's small and medium faces and its compact month; the
  full month keeps its heat map.
- **The Planner's day strip hides when there's no room** for its tiles' ticks. The week's range and arrows then move up
  to the top line, or to a slim row in a cell of tabs.
- **The calendar's toggles show only their icons below 690px** of widget width (was 620px), so the Plans toggle fits.
- **A list's Add task shows what the new task will get.** Quick Add now opens with the list's people, tags and status
  already shown as chips, as if you had typed them (its priority flags already showed). Remove a chip with its × and
  the task goes without it; a status you type replaces the list's; people you type are added beside the list's.
  Details takes the same values into the task editor, the list's status included.

## 2026-11-21, fifth deployment

Nothing changes in the app. This deployment reorganizes more of the project's developer documentation.

## 2026-11-21, fourth deployment

Nothing changes in the app. This deployment reorganizes the project's developer documentation.

## 2026-11-21, third deployment

### Added

- **The Planner in a tall, narrow cell.** When the Planner sits in a narrow column that is much taller than it is
  wide, Delayed and Unplanned are docked under the days instead of after them, so they stay in view and you can
  always drop a task on Unplanned. Drag the dock's top edge to share the height between the days and the trays
  (double-click it to reset), or fold the dock to a single bar, which still takes a drop to Unplanned. In this
  layout the day tiles keep their date marks, the week arrows move up beside the range, and a line under the tiles
  shows which days are in view as you scroll.

### Fixed

- **The cobweb on a stale task fills its corner.** Its threads now fan evenly across the whole corner of the
  checkbox, and its arcs reach both sides of the box.

## 2026-11-21, second deployment

### Security

- **Imports check the ids that link rows together.** A file whose task, person, tag or list links aren't whole
  numbers is refused with a message, instead of storing links that point nowhere.
- **Stricter guards against leaving the app.** The build and the code checks now also refuse any code that would
  navigate the page to another address, so the offline file stays offline as the app changes.

## 2026-11-21

### Added

- **Plan any task from anywhere.** Every task's right-click menu, and the ⋯ menu in the task editor and the review
  card, has **Plan for day ›**: today, the next six days, or **Unplanned**. A task with no date or Focus can now be
  held in Unplanned, by the menu or by dropping it there, and joins the Planner with its corner flag. **Clear plan**
  takes the plan back off; it reads **Remove from Planner** when that takes the task out of the Planner.
- **Remove and Clear on the Planner's Unplanned rows.** A row held there shows **Remove** beside Today, or **Clear**
  when its date or Focus keeps it in the Planner anyway. A row's menu in the Planner also has Clear plan.

### Changed

- **A task in the Planner's Unplanned tray offers Today instead of Snooze.** Nothing there is planned, so there was
  nothing to put off: Snooze only planned it for tomorrow. Its hover button is now **Today**, which plans it for
  today. Its menu has no Snooze; Plan for day › still offers every day.
- **The Planner's Move to day › is now Plan for day ›**, in a row's menu.
- **Reset plan asks before it clears anything.** It says how many plans it clears, and how many of those tasks then
  leave the Planner.

### Removed

- **The Planner's Today no longer ends with an Add task row.** Add tasks from Quick Add or a list.

### Fixed

- **Calendar entries have a right-click menu.** Right-clicking a task in the calendar, or in a day's "+N more"
  popover, opened the browser's menu. It now opens the task menu, Shift+F10 and the Menu key too.
- **Deleting a selected bullet line in notes took the bullet off the line below.** Selecting a whole list line by
  dragging down to the start of the next one, then pressing Delete or Backspace, left the next line as plain text.
  Now the lines below keep their bullets and checkboxes.

## 2026-11-20, second deployment

Data version 86.

### Changed

- **The Planner is a scratch pad: planning a task never changes its dates.** Dragging a task to a day only plans it
  there. The earlier behavior, where dragging a follow-up task moved its follow-up date, is gone. A task you haven't
  planned sits on the day it is due or due for a follow-up, so an untouched Planner matches the Calendar.
- **One list of days, two trays.** Today and the days after it are one scrolling list on the left. On the right, on a
  darker ground, are **Delayed** and **Unplanned**. A click on a day in the strip scrolls the list to that day.
- **A plan you didn't get to goes to Delayed** instead of joining Today by itself. The **Unplan** button between the
  trays moves every Delayed task to Unplanned.
- **The strip shows real dates and plans separately:** a solid tick for a due date or follow-up that falls on a day,
  a hollow tick for a task planned there. A thin rule marks where the week turns.

### Added

- **A flag on placed tasks.** A task you planned or set aside carries a small folded corner, so you can tell your plan
  from what the dates alone would show.
- **Planned past a date.** When a plan falls after a task's due date or follow-up, that date shows as late and a tag
  after the title says by how much (`1 day after due`). The tag offers two fixes: move the date to the planned day, or
  plan the task for that date.
- **Snooze and Unplan** on a row's hover and in its menu. Snooze moves the plan to the next day. Unplan sets the task
  aside in Unplanned; any task can go there, and one with dates keeps them and shows the day it came off.
- **Reset plan,** in the Planner's header and its menu: put placed tasks back for the whole week, for today only, or
  for the Delayed ones.

### Removed

- **The "Focus, no day" group** is now Unplanned, and the "No day" entry in a row's Move to day menu is replaced by
  Unplan.

## 2026-11-20

Data version 85.

### Added

- **Planner widget.** A Today list beside a strip of the next seven days. It gathers your Focus tasks and everything
  due or due for a follow-up in the week, each on its day; Focus tasks with no day wait in their own group.
  - Drag a row onto a day, or use **Move to day ›** in its menu, to plan it. A row that is on its day because of its
    follow-up gets its follow-up date moved; any other row gets a **Do day**, a planning date that only the Planner
    shows. A due date never moves. A label on the dragged row says which date will change.
  - Today is in your own order: drag rows to arrange them. An unfinished Do day carries over to Today by itself.
  - Planning a task does not count as working on it, so a neglected task still fades and gathers its cobweb.
  - The arrows move the strip a week at a time. Narrow cells and the phone show one column.
- **A start screen that explains a slow launch.** After a few seconds on `Loading…` it says which step is waiting
  (opening the database, checking the sync file, loading tasks) and offers Reload. While the browser is being asked
  about the sync file it also offers **Continue without the file** and **Forget the sync file…**, which removes only
  the app's link to the file: your tasks and the file itself are untouched.

### Fixed

- **Launch could wait forever on the sync file.** When the browser never answered about the attached sync file (seen
  after a browser restart), the app stayed on `Loading…` with no way in. The browser now gets five seconds: if the
  link can't be read the app opens without the file and the storage pill shows **Sync off** until you reload or attach
  the file again, and if only the permission check is silent the usual Grant access question appears, noting that the
  link could not be checked. Either way your edits are tracked, so the file is never loaded over them later.

## 2026-11-19

Data version 84.

### Added

- **Breakdown:** a count column can show the days since the row's oldest follow-up after its count (`3  23d`), turning
  yellow past a threshold you set. Its heading has an `age` toggle that sorts by it, and a click on the age reviews
  those tasks. A new People breakdown's Follow-up column shows it by default.
- **Settings › Tasks:** you choose the quick follow-up intervals (the `1d 1w 1m 3m` buttons beside a follow-up date).
- **Review card:** the title is edited in place, the Created and Modified dates show beside it, and a ⋯ menu offers
  Open in editor, Duplicate, Make subtask of… and Delete.
- **Calendar:** a click on a date opens that day's tasks.

### Changed

- **Repeats are any interval.** A task's repeat is typed (`Repeat every 2w`, `3d`, `1m`, `1y`) instead of picked from
  a fixed list, and reads back as `Every 2 weeks · next Mon, Dec 7`. Existing repeats are converted.
- **Date filters take typed intervals.** A Relative end is typed as an interval from today (`+2w`, `-1m`, `today`),
  and filter expressions read weeks, months and years the same way (`due <= +2w`).
- **One × everywhere.** Every pill's remove, every field's clear and every dialog's close use the same centered
  button.
- **List wall:** a task's priority is drawn as it is on the task's checkbox.
