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

Nothing yet.

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
