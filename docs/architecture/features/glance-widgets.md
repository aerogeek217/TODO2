# Glance widgets

The glance widgets are the Insights kinds that count and chart tasks: the Number, the charts (Breakdown and Pivot) and Created vs completed. Each is a widget kind of its own, composed in the layout's table. Their components are in `components/workspace/glance/`, their configs in `models/glance-widgets`, `models/number-shapes` and `models/chart-widgets`, their statistics in `services/stats/*`, and their data hooks in `hooks/use-glance-data`, `hooks/use-number-shapes` and `hooks/use-chart-data`.

The whole-widget maps that share their menu group (the Neglect map, Work clusters, the List wall) are in [Task maps](task-maps.md).

## What every glance widget shares

- Each reads the screen filter as it is (`stores/screen-filter`). The stats base (`useStatsBase`), the calendar and the Neglect map read it too. See [Screen filter](screen-filter.md).
- No glance widget shows task rows.
- Every glance widget's ⋯ ends with **Copy** (its lines).
- Adding one opens no editor. Its editor is in its ⋯.
- Faces, fit rows and the strip of Numbers are in [Widget chrome](widget-chrome.md).

### In the menus

- The add-widget and **Change widget** menus list them under **Insights**, after the **Tasks** kinds (List, Calendar, Review, Planner, Notes).
- The order is Number, Breakdown, Pivot and Created vs completed, then the Neglect map, Work clusters and the List wall.
- Adding a Breakdown opens its presets: **People** · **Tags** · **Status** · **Custom**.
- The three maps are whole widgets, in the group for the menus only: `WidgetKindSpec.group` is read by the menus alone.
- The glance minimums, fit rows and the right-click rule read `glance` / `fitHeight`, which the Calendar and the Neglect map don't have.

## Number

A Number is a filter. Its config is `models/glance-widgets.NumberConfig`: `{ name, color?, unlitColor?, filter, show, litWhen, litAt?, compare, breakdown? }`, plus the active shape's field.

### What it holds

- A name.
- Two colors: **when lit** (`color`) and **otherwise** (`unlitColor`).
- A Graphical / Expression filter, with no presets and no metric list. A new Number's filter is empty and counts every open task. A Completed range admits the completed tasks in it.
- When it lights: `litWhen` is never, or above / below `litAt`.
- What its change compares with: yesterday, the same day last week, or none.

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
- A click opens them in the task dialog, titled by its name with its filter in words (`glance-drills.numberDrill`).

### Editor

- **Edit number…** in the ⋯ opens `NumberEditor` beside the Number's body. Adding a Number opens nothing.
- It is hosted on `WorkspacePage` outside the widget tree (`NumberEditorHost`, `ui-store.numberEditorTabId`).
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

## The widget editors: Save / Discard

Every widget editor (the Number's, a chart's, Created vs completed's) is Edit list's Save / Discard. The draft is `glance/editor-draft.useEditorDraft`; the foot is `EditorFooter`.

- Its controls edit a copy of the config, which the widget draws live (`stores/widget-preview-store`, read by `GlanceWidget`).
- **Save** writes only the keys that changed, for good, as one layout config update: one undo step. A ⋯ menu's write made meanwhile (Tags, for example) stays.
- **Save** is off while nothing changed or while a filter expression doesn't read. The fields report through `shared/filters/expression-report`.
- **Discard** drops the copy.
- Esc, × or a press elsewhere close it at once while nothing changed.
- With changes they ask Save / Discard / Keep editing, in the shared confirm prompt (`Save changes to number “Open”?`). The press that asked goes no further.
- Nothing is kept across a reload.

What else asks before an editor is left is in [Popovers and editors](popovers-and-editors.md).

## Number shapes

The shapes are in `models/number-shapes`; the config's `show` picks one. The config holds only the active shape's field. The data is `use-number-shapes` over `services/stats/number-shapes`.

- **Count.**
- **Share of…**: its tasks as a share of a second filter's (`of`, every open task by default). It draws a ring, the percent and `N of M`, and a line of percents.
- **Oldest**: the age in days of its stalest task.
  - The age is by last follow-up (never followed up: since created), created, modified or due.
  - It shows that task's title and `N · median D days`. N is the tasks that have that date: the ones its click opens.
  - It is lit by the age.
- **Against a goal**: at most / at least N, optionally a week with its pace as a tick.
  - It is lit while behind pace or over the limit.
  - The first day of the week is compared with 0, so a week never opens lit.
- **Several counts** (a group): up to six counts in one cell. Each has its own name, filter and color, and each opens its tasks.
- **Follow a list**: one of the layout's lists as it shows (its filter as edited, its prompt and the screen filter), with its tab badge.
  - A click opens the list in the widget popup ([Widget chrome](widget-chrome.md)).
  - The layout counts that list as shown (`utils/workspace-layout-lists`), so it is kept and Duplicate layout repoints it.

Only Count and Share of… compare.

## Charts

A chart (`models/chart-widgets`) is a name and a filter whose tasks it splits, among those the top bar shows, as a Number counts.

- Its editor follows the Number editor's pattern (`ChartEditor`): name, filter, and the kind's own fields.
- **Edit breakdown…** / **Edit pivot…** in the ⋯ opens it, never on add.
- It is hosted on the page as `ChartEditorHost` (`chart-widgets-store.editorTabId`).
- Every bar, cell and segment opens its tasks in the task dialog (`chart-drills`, titled `<chart> · <row>`).
- Small face: its title and top entry. Medium and large: the chart.

### Breakdown

Kind `breakdown`; statistics in `services/stats/breakdown`.

- It splits by people, tags, status, priority, due or age (since created).
  - Priority: the Priority sort's exclusive groups, each with its ring.
  - Due: Overdue · Today · Next 7 days · Later. The first reads Before today once a completed task is among them.
- It is drawn as bars, a donut or one stacked bar.
- It shows each row's count or its oldest task's age.
- Presets (`breakdownPreset`): People, Tags and Status (every open task by theirs) and Custom.

#### The table

- Columns: name · Open (or Oldest), built in, then its count columns.
- Open reads Tasks while its filter lets completed tasks through, as its header and a Pivot say.
- Each heading is a sort: counts largest first, names A–Z. A second click reverses it, a third goes back to the default.
- The default is most counted across the count columns first for people and tags, and the natural order for the other splits.
- The none row (Unassigned, No tags, No status, No priority, No due date) stays last.
- The sort is per split, view state saved at once.
- The header has no sort words: the heading's ▼ / ▲ says it.
- A stored sort naming a column the Breakdown doesn't have reads as the default order (`liveBreakdownSort`).
- It has no filter field of its own.
- The medium face is a compact name · count columns table.

#### Rows

- Its people and tags rows narrow by the `@` / `#` picks, its own filter's and the top bar's, as a list grouped by them does (`build-list.groupRestrictions`, `services/stats/row-restrictions`).
- A person's or tag's right-click opens the one person / tag menu (`EntityMenu`).
- The row's action is **Review**: a muted 24px icon button right after the row's name, in the name column. It has no column of its own, and the name ellipsizes before it.
- It shows while the row is hovered or holds the focus (opacity only, so nothing shifts), and always where there is no hover.
- It is drawn wherever a Review jump is offered (`useEntityMenuOffers`): everywhere but in a dialog the task dialog can't show above.
- Its Review button and a count column's count jump to the Review widget with those tasks as its filter: the open layout's Review widget, else the popup review ([Review](review.md)).
- They open the tasks in the task dialog instead for a row no filter can say, and for every row of a Breakdown whose filter lets completed tasks through (`breakdownReviews`): a review takes open tasks only.
- Where no Review is offered, a count's click opens its tasks in the task dialog too.

#### Count columns

`BreakdownConfig.columns` holds up to four, each `{ id, name, color, filter, litWhen, litAt?, age? }`. Every column after the name and Open is one.

- A row's cell counts that row's tasks the column's Graphical / Expression filter keeps, as a Number counts.
- The count is filled solid in the column's color while it meets the column's Light up when rule, and outlined in it otherwise.
- Outlined, the color is as the theme draws it as text (`utils/theme-color`).
- None is a dim `–`.
- A click jumps to the Review widget with those tasks as its filter, with the fallbacks under Rows.
- Each column is 40px, its number's room. Its heading is cut with an ellipsis, its name in the tooltip. The name column takes the rest.
- They are set in the editor's **Count columns**: name, color, Light up when, filter, ×, **+ Add column**.

#### Follow-up age

A column may carry the row's follow-up age after its count: `age: { yellowAfterDays }`, optional. It reads `[3] 23d`.

- It is the oldest of the row's open tasks by last follow-up (never followed up: since created). A completed task never counts.
- It is muted, and in the follow-up color past its threshold. With no open task it is a dim `–`.
- The cell is 100px.
- Its tooltip names that task and the median.
- A click jumps as the row's Review does.
- The heading's small `age` toggle sorts by it (`age:<columnId>`, oldest first, view state).
- Copy writes `Follow-up 3 · 23d`.
- The editor has **Days since follow-up after the count** and **Yellow past** [14] **days**.
- A new People Breakdown's Follow-up column has it, and so does Change widget's.

#### Default columns

- A new Breakdown (every preset, and Change widget) writes two as its `columns` (`defaultBreakdownColumns`, in `workspace-store`'s seed).
- They are **Due** (`due` by today + N, overdue included) and **Follow-up** (`followup` likewise), each lit above 0 in its color.
- N is Settings › Tasks' ranges of the moment. A range `off` drops its column; `overdue` counts only the late tasks.
- They are ordinary columns from then on.
- A config without `columns` (a hand-made file) reads the two defaults in Settings' ranges (`models/chart-widgets.breakdownColumns`).

### Pivot

Kind `pivot`; statistics in `services/stats/pivot`.

- Rows × columns, each a Breakdown split, as a heat table with totals. A cell's color is its share of the largest.
- Its headings sort the rows, as a Breakdown's do. The name heading (what the rows split by, `Person`), each column and Total are buttons.
- A click sorts largest first (names A–Z), a second reverses, a third goes back to the natural order. ▼ / ▲ marks the sorted one.
- The none row stays last. The columns never move.
- The sort is `PivotViewState.sort`: view state saved at once, with no undo step.
- A sort by a column the table doesn't show reads as the natural order (`sortPivotRows`).

## Created vs completed

Kind `trend`. It is a name (default `Created vs completed`), a Graphical / Expression filter (absent: every task) counted among the tasks the top bar shows, a **Show as** and a Range (14 days, daily; 4 / 12 weeks, weekly).

### Show as

- **Bars**: created and completed per bar, the totals and the net change.
- **Burndown**: the open tasks it counts at each day's end; the start, now and the change; a falling or rising line.
- **Cumulative**: running totals of created, starting on the tasks open when the range began, and of completed.
- Each bar or point (a day, or a week on the weekly ranges) opens its tasks (`glance-drills`: `trendBucketDrill`, `trendOpenDrill`, `trendCumulativeDrill`).
- The line charts are drawn as built SVG nodes, with a transparent button per point over them.
- Small face: its name and the presentation's headline (the net, the open count now, the completed count).
- Copy writes the presentation's lines (`glance-summary.trendLines`).

### What it counts

- While neither its filter nor the screen filter narrows, every task is read as it is (`services/stats/trend.computeTrend`).
- Otherwise each task is replayed to each day's end and counted while the filter kept it then. This is `computeTrend`'s `TrendFilter`, over the fields window `fields-<range>`, which holds every event type a filter's history reads.
- So a tag added mid-range brings a task in from that day.
- Some days the history log can't count exactly (`filter-history.historyExactFrom`): the days before `historyLogSince` for follow-ups, priorities, people and tags, and every day for text and the modified date.
- Those days are dimmed bars or dashed lines. Their tooltip says which fields read as they are now (`glance-copy.approximateNote`).
- There is no ≈ note on the chart, as a Number's line has none. Copy names such a bar `Thu 8 (approximate)`.

### Config and editor

- Its config fields `name`, `filter` and `show` are optional. A new tab writes `name` and `show`.
- A tab without them (a name renamed blank, a hand-made file) reads its default name, every task, and Bars (`models/glance-widgets.trendName` / `trendShow`, `hooks/use-glance-data.trendFilter`).
- **Edit chart…** in its ⋯ (before Range) opens its editor under its title: `TrendEditor`, hosted on the page as `TrendEditorHost` (`chart-widgets-store.trendEditorTabId`).
- Its fields: name, filter with Reads as, Show as, Range.
- Save / Discard work as the Number editor's. The undo step is `Edited chart “X”`.

## History log

### What is logged

- `todoEvents` log `created` / `completed` / `reopened`, due-date changes and status changes.
- They also log the next follow-up (`followup`), the last follow-up (`followedUp`), the priority flags (`marker`) and each person and tag added or removed (`person` / `tag`).
- These are logged at the repository's diff, at the assignment joins and at each undo / redo. The joins are the bulk bar, the editor, the pickers, check-in replies, Make a task, Duplicate, the append import, a create's people and tags, and deleting a person or tag (Find unused…'s removal too).

### When the log began

- `historyLogSince` is a sync-neutral settings row: when this database began logging follow-ups, priorities, people and tags.
- It is stamped once. Launch writes it while the row is absent, and so does a data replace that brings none.
- An append import moves it forward when the file's log doesn't reach back as far as the browser's (`data/append-import.coverAppendedHistory`). A file with no stamp (a task archive, an older file) moves it to now; a later stamp moves it to that stamp.
- A past day before it then reads as approximate, not exact.

### A filter's history

- A filter's history (`services/stats/filter-history`) replays every task to each day's end (`task-history.taskFieldReplay` → `taskAsOf`) and evaluates the filter with that day as today.
- A field on a day before the log began reads as it was when the log began. A line that reads one there is approximate.
- So is a line that reads text or the modified date, which are never logged.
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
