# Glance widgets

The glance widgets are the Insights kinds that count and chart tasks: the Number, the Breakdown and Created vs completed. Each is a widget kind of its own, composed in the layout's table. Their components are in `components/workspace/glance/`, their configs in `models/glance-widgets`, `models/number-shapes` and `models/chart-widgets`, their statistics in `services/stats/*`, and their data hooks in `hooks/use-glance-data`, `hooks/use-number-shapes` and `hooks/use-chart-data`.

This file covers what they share, the Number and its shapes, the widget editors, the task dialog and the history log. Breakdown and Created vs completed are in [Charts](charts.md). The whole-widget maps that share their menu group (the Neglect map, Work clusters) are in [Task maps](task-maps.md).

## What every glance widget shares

- Each reads the screen filter as it is (`stores/screen-filter`). The stats base (`useStatsBase`), the calendar and the Neglect map read it too. See [Screen filter](screen-filter.md).
- No glance widget shows task rows.
- Every glance widget's ⋯ ends with **Copy** (its lines).
- Adding one opens no editor. Its editor is in its ⋯.
- Faces, fit rows and the strip of Numbers are in [Widget chrome](widget-chrome.md).

### The kinds and their flags

`GlanceWidgetKind` (`models/workspace-layout`) is `numbers`, `breakdown` and `trend`, which is Created vs completed. `isGlanceKind` and `isGlanceTab` tell them. A Numbers widget (`numbers`, its name **Numbers**, added as **Number**) holds one Number or more in `config.items`, each a Number's config with its own id and icon (`NumberItem`); the workspace draws each of its Numbers as a tab of its own (`utils/number-views`).

Each kind's `WidgetKindSpec` in `WIDGET_KIND_SPECS` carries three flags:

- `group`: `tasks` or `insights`. It is the menus' grouping only (`WIDGET_KIND_GROUPS` / `widgetKindsOf`, in `WIDGET_KIND_SPECS`' order). Nothing behavioral reads it.
- `glance`: the glance kinds.
  - A track of only glance cells may shrink to 64px, and a glance cell to 72px wide ([Workspace layout](workspace-layout.md)).
  - A right-click anywhere on one alone in its cell opens the cell's ⋯.
- `fitHeight`: the Numbers only. A row track whose cells hold only Numbers fits its content ([Widget chrome](widget-chrome.md)).

The three maps are whole widgets: they are in `insights` for the menus only, with neither `glance` nor `fitHeight`. The Calendar has neither too.

### In the menus

- The add-widget and **Change widget** menus list them under **Insights**, after the **Tasks** kinds (List, Calendar, Review, Planner, Notes).
- The order is Number, Breakdown and Created vs completed, then the Neglect map and Work clusters.
- Adding a Breakdown opens its presets: **People** · **Tags** · **Status** · **Custom** ([Charts](charts.md)).

### Tab titles

`kindTabTitle(tab)` gives a non-list tab's title:

- A chart's tab reads its name. Blank, it reads its kind's name (`Breakdown`). A Numbers widget of one Number reads that Number's name (blank: `Number`); of several, its tab name, else `Numbers`.
- Created vs completed reads its name, else `Created vs completed` (`trendName`).
- Any other tab reads its tab name, else its kind's name.

## Number

A Number is a filter. Its config is `models/glance-widgets.NumberConfig`:

`{ name, color?, unlitColor?, filter, show, litWhen, litAt?, compare, breakdown?, of?, oldestBy?, goal?, items?, list? }`

### What it holds

- `name`: at most 80 characters (`NUMBER_NAME_MAX`). It may be blank.
- Two colors, each a hex: **when lit** (`color`) and **otherwise** (`unlitColor`).
- `filter`: a `TodoPredicate`, Graphical or an expression, with no presets and no metric list. An empty filter counts every open task. A Completed range admits the completed tasks in it.
- `show`: its shape, with that shape's one field ([Number shapes](#number-shapes)).
- When it lights (`numberIsLit`): `litWhen` is `never`, or `above` / `below` `litAt`. `litAt` is a whole number, absent with `never`.
- `compare`, what its change compares with: `yesterday`, `lastWeek` (the same day last week) or `none`.
- `breakdown`, its large face's: `none`, `people`, `tags`, `status` or `priority`. Absent is none.

A new one (`newNumberConfig`) is `Open` over an empty filter, never lit, against yesterday. What the read of a stored config repairs is in [models-and-data](../models-and-data.md).

### Colors

- `color` absent is Auto: the accent.
- `unlitColor` is optional. Absent is Auto: the name muted, the count in the text color, a 0 muted, the line in the accent.
- Its name, count and 14-day line take whichever of the two applies.
- A 0 in a picked "otherwise" color is dimmed (`number-colors.dimmed`).
- A shape lit by its own rule (Oldest, Against a goal) is colored the same way.
- A group's items keep their one color each, lit by the group's rule.
- Each color is drawn per theme with nothing stored changed (`utils/theme-color`):
  - a preset as its hue's text token;
  - four fixed hexes (the dark theme's danger, overdue, follow-up and muted-text values, `UPGRADE_COLOR_TOKENS`) as those meanings' tokens;
  - any other hex shaded by `--custom-color-shade`, which is 0% in dark.

### Count and click

- It counts its filter's tasks among those the top bar shows, as a list does (`stores/screen-filter`), as `shown of total` (`services/stats/number-count`).
- A click opens them in [the task dialog](#the-task-dialog), titled by its name with its filter in words (`glance-drills.numberDrill`).

### Editor

- **Edit number…** in the ⋯ opens `NumberEditor` beside the Number's body. Adding a Number opens nothing.
- It is hosted on `WorkspacePage` outside the widget tree (`NumberEditorHost`, `ui-store.numberEditorTabId`).
- `openNumberEditor(tabId)` sets `numberEditorTabId` and `closeNumberEditor()` clears it. One is open at a time, and `openSettings` closes it, as it closes Edit list.
- Its fields: name; **Color when lit** and **Color otherwise**, each a `ColorPicker` with Auto before its swatches; the filter, with the Graphical / Expression switch and Reads as; the shape and its fields; Light up when; Compare with.
- With Light up when set to Never it shows one **Color** field, the color otherwise. The lit color is kept as stored.

### Rolling figures

- While mounted, each digit of a count or of a shape's main figure that changes slides out as the new one slides in (`shared/RollingNumber`): up as it rises, down as it falls, in about 280 ms.
- Nothing rolls on first render. The element's text is the plain figure.
- A figure that stops being lit cross-fades to its unlit color and sends one ring in its lit color out from it (`glance/LightRing`). Nothing happens on becoming lit, and there is no ring under reduced motion.

### Faces

- Small and medium: its name over its count, with its 14-day line and its change beside the count wherever they fit.
- The room decides that, not the face, so a Numbers row shows them too.
- The count, line and change are one line box of the count's height that clips what wraps. The change drops out first, then the line, never the count.
- This is CSS only, so nothing flickers on a divider drag, and the row is no taller.
- The line needs about 115px of cell beside a one-digit count; the change some 220–280px, by its words.
- A Share of… does likewise, with its line and change under its percent.
- Large draws it bigger, with a breakdown by person, tag, status or priority. Each line opens its tasks.
  - By status: each status in Settings' order with its glyph, then No status.
  - By priority: the Priority sort's groups (Focus, Urgent + Important, Urgent, Important) with their rings, then No priority.

## Number shapes

The shapes are in `models/number-shapes`; the config's `show` picks one. The config holds only the active shape's one field: `share`'s `of`, `oldest`'s `oldestBy`, `goal`'s `goal`, `group`'s `items`, `list`'s `list`. The data is `use-number-shapes` over `services/stats/number-shapes`.

- **Count** (`count`).
- **Share of…** (`share`): its tasks as a share of a second filter's (`of`, every open task by default). It draws a ring, the percent and `N of M`, and a line of percents.
- **Oldest** (`oldest`): the age in days of its stalest task.
  - The age is by last follow-up (never followed up: since created), created, modified or due.
  - It shows that task's title and `N · median D days`. N is the tasks that have that date: the ones its click opens.
  - It is lit by the age.
- **Against a goal** (`goal`): at most / at least N, optionally a week with its pace as a tick.
  - It is lit while behind pace or over the limit.
  - The first day of the week is compared with 0, so a week never opens lit.
- **Several counts** (`group`): up to six counts in one cell. Each has its own name, filter and color, and each opens its tasks.
- **Follow a list** (`list`): one of the layout's lists as it shows (its filter as edited, its prompt and the screen filter), with its tab badge.
  - A click opens the list in the widget popup ([Widget chrome](widget-chrome.md)).
  - The layout counts that list as shown (`utils/workspace-layout-lists`), so it is kept and Duplicate layout repoints it.

Only Count and Share of… compare.

## The widget editors: Save / Discard

Every widget editor (the Number's, a chart's and Created vs completed's in [Charts](charts.md), and the [Planner settings](planner-widget.md#the-unplanned-filters-editor)) is Edit list's Save / Discard. The draft is `glance/editor-draft.useEditorDraft`; the foot is `EditorFooter`.

- Its controls edit a copy of the config, which the widget draws live (`stores/widget-preview-store`, read by `GlanceWidget`).
- **Save** writes only the keys that changed, for good, as one layout config update: one undo step. A ⋯ menu's write made meanwhile (Tags, for example) stays.
- **Save** is off while nothing changed or while a filter expression doesn't read. The fields report through `shared/filters/expression-report`.
- **Discard** drops the copy.
- Esc, × or a press elsewhere close it at once while nothing changed.
- With changes they ask Save / Discard / Keep editing, in the shared confirm prompt (`Save changes to number “Open”?`). The press that asked goes no further.
- Nothing is kept across a reload.

What else asks before an editor is left is in [Popovers and editors](popovers-and-editors.md).

## The task dialog

A Number's click and a chart's bar open their tasks in the task dialog (`overlays/TaskDialog`). Its state is in `ui-store`.

- `taskDialog` is a `TaskDialogPayload` (`stores/task-dialog-payload`), or `null` while it is closed. `services/task-dialog` resolves the payload to rows.
- `showTaskDialog(payload)` opens it and clears the selection, so a row's actions in the dialog act on that row only. `hideTaskDialog` closes it.
- `popupListPick` (`PopupListPick`) is a grouping, or a sort with its direction, picked in a popup task list's group · sort control. `pickPopupListView(pick)` merges it in.
- The pick is in memory only: it is every popup list's until a reload. `task-dialog.currentTaskDialogEnv` reads it over Settings' new-list defaults.
- `App.tsx` closes a `screen` task dialog (the screen filter's tasks) when the window turns desktop-sized. There the filtered-tasks panel shows them ([Screen filter](screen-filter.md)).

## History log

### What is logged

- `todoEvents` log `created` / `completed` / `reopened`, due-date changes and status changes.
- They also log the next follow-up (`followup`), the last follow-up (`followedUp`), the priority flags (`marker`) and each person and tag added or removed (`person` / `tag`).
- These are logged at the repository's diff, at the assignment joins and at each undo / redo. The joins are the bulk bar, the editor, the pickers, check-in replies, Make a task, Duplicate, the append import, a create's people and tags, and deleting a person or tag (Find unused…'s removal too).

### When the log began

- `historyLogSince` is a sync-neutral settings row: when this database began logging follow-ups, priorities, people and tags.
- In `settings-store` it is a `Date`, or `null` while not stamped. The store only reads it: `stampHistoryLogSince(now?)` is its one write.
- It is stamped once. `stampHistoryLogSince` stores it only while the row is absent, reading the row afresh (`settingsRepository.putIfAbsent`).
- Launch runs the stamp after the sync file's load, and every data replace runs it (`refresh-all.refreshAllStores`), so a replace that brings no stamp gets one.
- It is an internal stamp: no undo step, and a failure is only logged.
- An append import moves it forward when the file's log doesn't reach back as far as the browser's (`data/append-import.coverAppendedHistory`). A file with no stamp (a task archive, an older file) moves it to now; a later stamp moves it to that stamp.
- A past day before it then reads as approximate, not exact.
- `runAppendImport` runs the stamp after an append, so the store reads the row again.

### A filter's history

- A filter's history (`services/stats/filter-history`) replays every task to each day's end (`task-history.taskFieldReplay` → `taskAsOf`) and evaluates the filter with that day as today.
- A field on a day before the log began reads as it was when the log began. A line that reads one there is approximate.
- So is a line that reads text, the modified date or the planned date, which are never logged (a plan write logs no event).
- The line's tooltip (`NumberLine`) names the fields (`historyExactness`), and its accessible name says "About". There is no ≈ mark beside it.
- The trend and a Number's line (its filter under its screen filter, 14 days) read the events through `trend-events-store`, a window each: a trend range, a trend range's fields window (`fields-14d`, …), or `history`.

## Shared statistics

- Every statistic is a pure `services/stats/*` function over the screen-filtered tasks and over all tasks.
- `hooks/use-glance-data` has a hook per part over one shared base.
- Each part is a `utils/shared-memo.sharedMemo` keyed by its inputs' identity. A Number's and a chart's are keyed by their filter (`sharedMemoByKey`).
- So a dozen widgets on screen filter the tasks once and compute each statistic once. The calendar and the Neglect map are among them (`useScreenTasks`).
- Every Number's line counts from one shared replay of the tasks. After a write it is drawn a moment later, off the write's render.
- A write that leaves the shown tasks as they were recomputes none.
- `hooks/use-number-shapes` and `hooks/use-chart-data` build on the same base.
