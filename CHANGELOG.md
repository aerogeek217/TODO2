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
