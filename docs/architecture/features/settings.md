# Settings

The app's settings are the rows of the `settings` table. `data/setting-keys` names their keys. `stores/settings-store` reads and writes them: `useSettingsStore`, with `SETTINGS`, the table of every setting the store holds. `stores/setting-writes` is the one way a setting is written. `stores/ui-store` holds the Settings modal's state.

## The `settings` table

- A row is a key and a text value. `SETTING_KEYS` names the keys; a color override's row is `color.<theme>.<key>`.
- `SYNC_NEUTRAL_SETTING_KEYS` are the settings the app writes for itself (`purgePromptLastAt`, `historyLogSince`, `planLogSince`). Writing one is no unsynced change for file sync, and the browser and the file are not compared on them.
- One key is not the settings store's: `activeLayoutId`, the open layout ([workspace layout](workspace-layout.md)).

## Reading a setting

`SETTINGS` has one entry per setting. An entry names the store fields it shows and has `read(rows)`: its value from the rows by key.

- An absent or unreadable row reads as the default.
- The store's initial state is `read` of no rows.
- `load()` is `read` over every entry, then the theme on the page. A failed read says so, and still sets `data-theme` from the current mode.

## Writing a setting

An entry the store writes also has:

- `rows(value)`: every row that stores the value. A string puts the row and `null` deletes it, which is how a setting stored only off its default drops its row.
- `undo`: its undo step's name.
- `failure`: its failure notice.

Each such entry is also its writer, `SETTINGS.<name>.write(value, options?)` (`stores/setting-writes.settingWriter`).

The setters validate (an invalid value is ignored) and write through their entry:

- The value is shown at once, and saved after that setting's writes before it.
- A failed save puts back the value saved before and says so.
- The same value again writes nothing.

### Undo

Settings takes no Ctrl+Z, so a setting's undo step comes with the undo snackbar.

- **With an undo step:** `setDefaultStatusId(id, options?)`, `setCompletedRetentionDays`, `setWeekStartsOn`, `setFollowupDefaultInterval`, `setFollowupQuickIntervals`, `setAutoFollowup`, `setRemoveConvertedLines`, `setStaleCobwebs`, `setStaleFade`, `setTallyMarks`, `setShowWidgetNames`, `setUrgentDueWithinDays`, `setNewListSort(sort, direction?)`, `setNewListGroup`, `setPurgePromptIntervalDays`, `setStaleAfterDays`, `setTabBadges`, `setPriorityCues`, `setListZoom`, `setRowDates` and `setAmbience`.
- **Without one:** `setColor(theme, key, value)`, `resetColor(theme, key)`, `resetColors(theme?)`, `setThemeMode`, `setCheckinTaskFilter`, `setShortcut(id, chord)`, `resetShortcut`, `resetAllShortcuts`, `setPurgePromptLastAt(at)` and `stampHistoryLogSince`.
- `setDefaultStatusId` with `{ record: false }` records none: a status delete that clears the default status records its own.

## The settings

Each is a store field. Its row has the field's name unless one is given.

### Theme

- `themeMode`: light / dark / system.
- `colors: ThemedColors { dark, light }` over the twelve `ThemeColors` keys, with `customizedColors`: which of them are overrides, the `color.<theme>.<key>` rows. The two are one entry, so a rollback or a reset restores both.
  - A picker writes on every move (`setColor`).
  - `resetColor` removes one color's override: a row's Reset in Theme colors. A priority then follows the accent / Danger / Follow up again.
- `ThemeColors` and `ThemeName` are re-exported from `models/theme-colors`, where `ThemedColors` and `DEFAULT_THEMED_COLORS` also live.

### New tasks and follow-ups

- `defaultStatusId`: new tasks' status.
- `seededAssignedStatusId`: read only here. The status seed writes it, and the status store removes it when the seeded status is deleted.
- `followupDefaultInterval`: a `FollowupInterval`, stored compact (`1m`, `2w`, `10d`), default 1 month.
- `followupQuickIntervals`: the quick follow-up intervals ([status updates](status-updates-and-subtasks.md)).
- `autoFollowup`: "Set a next follow-up automatically", for new tasks and Mark followed up. Its row is `newTaskFollowup`, `true` / `false`: stored only as `false`, absent = on.
- `removeConvertedLines`: stored only while on ([notes → tasks](status-updates-and-subtasks.md)).

### Dates and rules

- `weekStartsOn`: 0 = Sunday, 1 = Monday. The default is 1.
- `urgentDueWithinDays`: days ahead, `0` = today, `null` = off (`utils/urgency`). Stored `off` or the day count, 0–365; absent = 3. Its undo step reads `Due within 1 week makes a task urgent`.
- `staleAfterDays`: 0–365, 0 = off, default 30 (`utils/stale`).

### Rows and lists

What each does to a row or a list is in [lists](lists.md).

- `staleCobwebs`: Cobwebs on stale tasks. Stored `false` only while off; absent = on.
- `staleFade`: Fade stale tasks, a stale row's `data-faded`. Stored `false` only while off; absent = on.
- `tallyMarks`: Tally of today’s tasks, the top bar's `TallyMarks`. Stored `false` only while off; absent = on.
- `showWidgetNames`: Show widget names (Appearance › Theme), read by `WidgetNameLine`. Stored `true` only while on; absent = off.
- `tabBadges`: its rows are `tabBadgeDue` and `tabBadgeFollowup`, both written in one transaction.
- `priorityCues`.
- `listZoom`: the default list zoom, `auto` / `stacked` / `rows` / `lines` (`utils/list-zoom`). Its row is `rowDensity`. The default `auto` is the absent row and is never stored; a picked `rows` is stored. Its undo step reads `Default list zoom: Lines`.
- `rowDates`: `relative` / `numeric`, default relative (`utils/row-dates`).
- `newListSort` and `newListSortDirection` are one entry, both rows in one transaction.
  - `newListSort` is a `TodoSortBy`; absent = `manual`.
  - The direction is `asc` / `desc`, and only `desc` is written. A stored direction for a sort without one reads as `asc`.
- `newListGroup`: a `TodoGroupBy`; absent = `none`.

### Completed tasks

These drive [the purge notice](startup-and-data-replaces.md).

- `completedRetentionDays`: `null` = keep forever.
- `purgePromptIntervalDays`: a whole number 1–365 as text; absent = 7.
- `purgePromptLastAt`: a `Date`, stored as a date-time text; `null` (absent) = never. It is when the user was last asked about old completed tasks: the purge dialog opened, or Not now in the storage pill's notice. Its write is an internal stamp: no undo step and no notice, and a failure is only logged.

### The check-in filter

- `checkinTaskFilter`: a list predicate without people, completed off (`utils/checkin-settings.checkinFilterOf`). The default is `emptyPredicate()`: no filter.
- It is stored as JSON and read through `data/checkin-filter-shape`. The row is deleted when the filter narrows nothing.
- The check-in dialog's filter line writes on every edit ([check-ins](check-ins.md)).

### Keyboard shortcuts

- `shortcutOverrides`: the user's shortcut changes. Its row is `keyboardShortcuts`: a JSON object of chord texts by binding id, only changed bindings (`utils/shortcut-bindings`).
- It is read through `utils/shortcut-bindings.readShortcutOverrides`: what the editor couldn't have saved is dropped.
- `setShortcut` resolves the refusal reason from `shortcutRefusal` and writes nothing, else saves and resolves null.

### Ambience

`ambience` is one JSON row (`models/ambience`), written by `setAmbience(changes, { mergeKey })`: fields out of range are ignored, a place is kept to two decimals, the row is removed at the defaults, and each change is one undo step named for it (`Ambience off`, `Ambience sky: Vivid`, `Header motion 60%`). What it draws is in [ambience](ambience.md).

### The history log's start

`historyLogSince` is a date-time text: when this database began logging follow-ups, markers, people and tags. `settings-store.stampHistoryLogSince` stamps it once while it is absent, at launch and after a data replace. Only an append import moves it forward (`append-import.coverAppendedHistory`): see [glance widgets](glance-widgets.md).

`planLogSince` is the same for the Planner's planned days (the `planned` event): stamped once by `settings-store.stampPlanLogSince` in the same places, moved forward by an append import the same way.

## The automatic next follow-up

`autoNextFollowup(now, s?)` is the one rule: today + `followupDefaultInterval` while `autoFollowup` is on, `null` while off.

- Every Mark followed up path uses it, for a task whose next follow-up isn't after today (`utils/followup.nextAfterFollowup`).
- So do the follow-up popover's proposal and new tasks.
- `newTaskDefaultFollowup(now)` is the same, as `undefined` when none.
- `autoFollowupInterval` is the selector.

## The theme on the page

`themeMode`'s and `colors`' entries put the page right whenever they show a value (a write, a rollback):

- `data-theme`, set to the resolved theme.
- Under System, the `matchMedia('(prefers-color-scheme: dark)')` listener, which re-applies on an OS flip.
- One inline `style.setProperty(...)` per customized color of the resolved theme. The rest fall through to `tokens.css`.

`resetSettingsModuleState()` (tests) stops following the OS theme.

## Filter settings

`currentFilterSettings()` returns `FilterSettings` (urgent range, week start) as they are now. Memoized callers use `hooks/use-filter-settings`.

## Settings rows on import

`ALL_SETTING_KEYS` is the allowlist ([import and export](import-and-export.md)).

- A row's value is validated by its key, among them `urgentDueWithinDays`, `newListSort`, `newListSortDirection`, `newListGroup`, `purgePromptIntervalDays`, `purgePromptLastAt`, `historyLogSince` and `planLogSince`.
- `checkinTaskFilter`: any text passes the check. Import keeps the parts that read (no people, completed off) and names the rest in a warning, `check-in filter (…)`.
- `keyboardShortcuts`: any text passes the check. Import keeps only the bindings that read, pass the rules and don't clash, and names the rest in a warning.

## The Settings modal

On desktop Settings is a modal over the workspace. Its state is in `useUIStore`:

- `settingsOpen`.
- `settingsSection: SettingsSectionId`, the section shown: `database`, `appearance`, `tasks`, `entities`, `shortcuts`, `about`.
- `settingsPart: SettingsPartId | null`, a merged section's part to scroll to once: `theme`, `task-rows`, `ambience`, `new-tasks`, `rules`, `new-lists`, `completed`, `file-storage`, `backups`, `import-export`, `data-integrity`. `clearSettingsPart` and `closeSettings` clear it.

### The section it opens on

- The last section shown is kept across reloads in `localStorage`, under `SETTINGS_SECTION_KEY` (`todo2-settings-section`).
- `readLastSettingsSection` reads it. An unknown or unreadable value, or none, is `FIRST_SETTINGS_SECTION`, `appearance`.
- `openSettings(target)` and `setSettingsSection` write it. `openSettings()` with no target keeps it.

### Opening and closing

- `openSettings(target?)` and `setSettingsSection(target)` take a `SettingsTarget`: a section or a part, resolved by `resolveSettingsTarget` over `SETTINGS_PART_SECTION`.
- It is opened by the gear, `G S`, the palette's Open Settings, the storage pill (on `file-storage`, `import-export` or `backups`) and the `#/settings` deep link.
- An editor with changes under it is asked first ([popovers and editors](popovers-and-editors.md)).
- `closeSettings` is every close: Esc, ×, the backdrop, and `App.tsx` at phone width, where the modal isn't shown.
- Settings holds no unsaved work, so no close asks.

## Beside it in the UI store

- A person's or tag's menu (a task row's avatar or tag, a people or tag picker's option) sets `entityAction: EntityAction | null` (`{ kind: 'person' | 'tag', id, action: 'edit' | 'delete' }`) through `openEntityAction` / `closeEntityAction`, and `EntityActionHost` renders it ([people and tags](tasks.md)).
- `rowPopover` (`openRowPopover` / `closeRowPopover`) is a row's notes popover or checklist, shown by `RowPopoverHost` ([popovers and editors](popovers-and-editors.md)).
