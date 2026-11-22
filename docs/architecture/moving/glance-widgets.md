# Text moving to glance-widgets

Moved whole out of the layer tables' long rows. It is merged into its destination and this file is deleted.

## From state.md

### useUIStore, BulkConfirmation, FollowupPopoverRequest, RowPopoverRequest — stores/ui-store.ts

`taskDialog: TaskDialogPayload | null` (`services/task-dialog`) + `showTaskDialog(payload)` (also clears the selection, so a row's actions in the dialog act on that row only) / `hideTaskDialog`; `popupListPick` (`PopupListPick`: a grouping, or a sort with its direction, picked in a popup task list's group · sort control — `pickPopupListView(pick)` merges it in; in memory only, every popup list's until a reload, read by `task-dialog.currentTaskDialogEnv` over Settings' new-list defaults) — `taskDialog` rendered by `overlays/TaskDialog`. `filterPanelOpen` + `filterPanelFocusKey` + `openFilterPanel()` (opens the top bar's filtered-tasks panel — desktop — and bumps the key, which focuses it, also when it is open already: the palette's Show Tasks Matching the Filter; clears the selection as `showTaskDialog` does) / `closeFilterPanel()` — rendered by `overlays/FilteredTasksPanel` from `TopBar`; `App.tsx` closes it when the window turns phone-sized (and a `screen` task dialog when it turns desktop-sized).

### useSettingsStore, ThemeMode, resolveTheme, SETTINGS, CustomizedColors — stores/settings-store.ts

`historyLogSince` (a `Date`, `null` = not stamped; read only here: `stampHistoryLogSince(now?)` stores it once while the row is absent — read afresh, `settingsRepository.putIfAbsent` — run by launch after the sync file's load and by every data replace, and by `runAppendImport` after an append to read it again (the append may have moved it, `append-import.coverAppendedHistory`); an internal stamp, no undo, a failure only logged),
