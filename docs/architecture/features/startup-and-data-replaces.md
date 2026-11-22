# Startup and data replaces

Launch is `services/app-startup.runAppStartup`, behind a database version check in `App.tsx`; the start screen (`layout/StartScreen`) shows until both are done. A data replace swaps the data underneath the stores, and every one goes through `services/replace-data.replaceData`.

## Launch order

1. `App.tsx` checks the database's version.
2. Settings load (theme, color overrides).
3. The sync file reconnects (`fileStorageService.initialize()`).
4. The stores load.
5. The purge notice is offered.
6. `backupScheduler.start()` takes a daily automatic backup. Each backup kind keeps its newest few within a byte budget.

## The database version check

- Below the floor → `DatabaseTooOldDialog`. Nothing is read or written. It offers **Download this data**, **Import a file…** (which replaces the data after asking) or **Reload**.
- Saved by a newer build → `DatabaseTooNewDialog`. **Reload** only; nothing is read or written.

## The sync file at launch

When the file's handle needs permission again, launch **waits for the launch question** (**Grant access…** / **Continue without the file**) before anything else runs.

**Launch can't wait on the browser without end.** Reading the stored handle and checking its permission each get 5 s (`FILE_LINK_TIMEOUT_MS`):

- A handle not read in time, or not readable at all: launch goes on without the file. The storage pill says **Sync off** for the rest of the session, with no Dismiss, until a reload reads the handle or the file is attached again. The stored handle is kept, and edits are tracked as unsynced for the next start's load decision.
- A permission check not answered, or that fails: the launch question, saying the link to the file could not be checked.
- Neither reads or writes the file, and a late answer is dropped.

The load decision changes nothing on either side until the user resolves a disagreement: a conflict, an older file or an unreadable one leads to a dialog or a pause. A browser merely ahead of an unchanged file is written to it, after a backup of the file's text.

## The start screen

`layout/StartScreen` stands behind the version check and launch alike. It says `Loading…`. Once one part of launch has taken 6 s (`START_SCREEN_EXPLAIN_MS`) it names that part (opening the database, checking the sync file, loading tasks) and offers what is safe there:

- **Reload**, always.
- At the sync file's step, while launch waits for the browser to hand over the handle, its permission or the file's text (`launchWait`; the read has no time limit):
  - **Continue without the file**: this browser's data, sync paused, nothing written, the handle kept.
  - **Forget the sync file…**: after a confirm, the stored handle is cleared; the tasks and the file itself are untouched.

Nothing there deletes or changes a task.

## The purge notice

Completed tasks past the retention are **never purged silently**, and launch opens no dialog about them.

- The storage pill shows a **purge notice** (`17 old completed`), and so does the phone's sync sheet. It comes after any sync or backup warning, which outranks it.
- Its section offers **Review…** and **Not now**. **Review…** opens the purge dialog (**Export & delete** / **Delete** / **Not now**; a backup snapshot first), the only way anything is deleted.
- It is offered at most once every N days, counted from when the user was last asked (the dialog opened, or **Not now**). A notice merely shown stamps nothing, so one left unanswered is there at the next launch.
- It is offered after a later sync-file load too.
- A change that leaves none expired (deleted, reopened, retention off) removes it.
- Its state is `stores/purge-notice-store`, read by `overlays/PurgeNoticeHost`.

## Data replaces

`services/replace-data.replaceData` runs every data replace: a Settings import, a backup restore, the audit's cleanup, the sync file's load, the append import. Its steps, in order:

1. Note saves are held.
2. The safety snapshot is taken.
3. Layout writes in flight settle.
4. The write.
5. The stores reload (`refresh-all`). An append import reloads the task stores only and keeps the undo history.
6. The `onDataReplaced` listeners run.

### The replace hold

From the write until the reload has opened the new data, a replace (not an append import) holds layout and list writes (`stores/replace-hold`). The stores still hold the replaced data and their writes put whole rows. So an edit made then (a tab closed, a rename, an undo) changes nothing and says why, rather than writing the old layout or list over the new data.

### The import pipeline

A file (an import, a backup, the sync file) is read through the import pipeline first.

- A file from below the schema floor (`OLDEST_SUPPORTED_DB_VERSION`, v68), or without a version, is refused: nothing read, nothing written. The message names the older build that still converts it.
- A file whose layouts hold far more parts than the app keeps is refused too, with a message, before the schema upgrades run (`data/layout-size`).
- A layout row the check rejects is **repaired**, as the database read repairs it, and stored repaired with a warning. The whole file is never refused for it.
