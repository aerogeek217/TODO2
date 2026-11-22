# Charts

The chart widgets are Breakdown, Pivot and Created vs completed: three of the glance kinds. Breakdown's and Pivot's configs are in `models/chart-widgets`, Created vs completed's in `models/glance-widgets`. Their components are in `components/workspace/glance/` and their statistics in `services/stats/`.

What every glance widget shares, the Number, the widget editors' Save / Discard, the task dialog and the history log are in [Glance widgets](glance-widgets.md).

## The chart kinds

The chart kinds (`ChartWidgetKind`) are `breakdown` and `pivot`; `isChartTab` tells their tabs. A chart (`models/chart-widgets`) is a `name` and a `filter` whose tasks it splits, among those the top bar shows, as a Number counts ([Glance widgets](glance-widgets.md#number)).

- Its editor follows the Number editor's pattern (`ChartEditor`): name, filter, and the kind's own fields.
- **Edit breakdown…** / **Edit pivot…** in the ⋯ opens it, never on add.
- It is hosted on the page as `ChartEditorHost` (`chart-widgets-store.editorTabId`).
- Every bar, cell and segment opens its tasks in the task dialog (`chart-drills`, titled `<chart> · <row>`).
- Small face: its title and top entry. Medium and large: the chart.

### Breakdown

Kind `breakdown`; statistics in `services/stats/breakdown`. Its config is `BreakdownConfig`, layout config:

`{ name, filter, splitBy, style, show, oldestBy?, showNone, columns? }`

- `splitBy`: `people`, `tags`, `status`, `priority`, `due` or `age` (since created).
  - Priority: the Priority sort's exclusive groups, each with its ring.
  - Due: Overdue · Today · Next 7 days · Later. The first reads Before today once a completed task is among them.
- `style`: it is drawn as `bars`, a `donut` or one `stacked` bar.
- `show`: each row's `count`, or its `oldest` task's age. `oldestBy` is stored only with `oldest`; absent is the last follow-up.
- `showNone`: whether the none row shows.
- `columns`: its [count columns](#count-columns).
- Presets (`breakdownPreset`): People, Tags and Status (every open task by theirs) and Custom. A new Breakdown takes the Add widget preset as `TabSeed.breakdown`.

What the read of a stored config or view state repairs, and what a schema upgrade rewrote, is in [models-and-data](../models-and-data.md).

#### The table

- Columns: name · Open (or Oldest), built in, then its count columns.
- Open reads Tasks while its filter lets completed tasks through, as its header and a Pivot say.
- Each heading is a sort: counts largest first, names A–Z. A second click reverses it, a third goes back to the default.
- The default is most counted across the count columns first for people and tags, and the natural order for the other splits.
- The none row (Unassigned, No tags, No status, No priority, No due date) stays last.
- The header has no sort words: the heading's ▼ / ▲ says it.
- It has no filter field of its own.
- The medium face is a compact name · count columns table.

The sort is per split. It is view state, saved at once: `{ sorts?: { [split]: { by, reversed? } } }`.

- `by` is a fixed heading (`name` or `open`, `BREAKDOWN_FIXED_SORT_KEYS`), a column's id, or `age:<columnId>`.
- It is read through `liveBreakdownSort(sort, breakdownSortKeys(columns))`. A heading the Breakdown has reads as stored; an age sort does only while its column has `age`.
- Any other reads as the split's default order: a column removed in the editor, for example.

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

`BreakdownConfig.columns` holds up to four (`BREAKDOWN_COLUMNS_MAX`), each `{ id, name, color, filter, litWhen, litAt?, age? }`. Every column after the name and Open is one.

- `id` is word characters and `-`, unique among the Breakdown's columns and never `name` or `open`, so a sort names it.
- `color` is a hex. `filter` is a predicate, read as a Number's.
- A row's cell counts that row's tasks the column's Graphical / Expression filter keeps, as a Number counts.
- The count is filled solid in the column's color while it meets the column's Light up when rule, and outlined in it otherwise. The rule is a Number's (`columnIsLit`).
- Outlined, the color is as the theme draws it as text (`utils/theme-color`).
- None is a dim `–`.
- A click jumps to the Review widget with those tasks as its filter, with the fallbacks under Rows.
- Each column is 40px, its number's room. Its heading is cut with an ellipsis, its name in the tooltip. The name column takes the rest.
- They are set in the editor's **Count columns**: name, color, Light up when, filter, ×, **+ Add column**.

#### Follow-up age

A column may carry the row's follow-up age after its count: `age: { yellowAfterDays }`, a whole number from 0 to 999. Absent is off. It reads `[3] 23d`.

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

- A new Breakdown (every preset, and Change widget) writes two as its `columns`: `defaultBreakdownColumns(app, { followupAge })`, in `workspace-store`'s seed. `followupAge` gives the Follow-up column its `age`.
- They are **Due** (id `due`: due by today + N, overdue included) and **Follow-up** (id `followup`: the next follow-up likewise), each lit above 0 in its color (`DUE_COLUMN_COLOR` / `FOLLOWUP_COLUMN_COLOR`).
- N is Settings › Tasks' ranges of the moment. A range `off` drops its column; `overdue` counts only the late tasks, those dated by yesterday.
- They are ordinary columns from then on.
- `breakdownColumns(config, app)` gives a Breakdown's columns: its `columns`, else `defaultBreakdownColumns(app)`. So a config without `columns` (a hand-made file) reads the two defaults in Settings' ranges.

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
- Some days the history log can't count exactly (`filter-history.historyExactFrom`): the days before `historyLogSince` for follow-ups, priorities, people and tags, and every day for text and the modified date. See [History log](glance-widgets.md#history-log).
- Those days are dimmed bars or dashed lines. Their tooltip says which fields read as they are now (`glance-copy.approximateNote`).
- There is no ≈ note on the chart, as a Number's line has none. Copy names such a bar `Thu 8 (approximate)`.

### Config and editor

- Its config is `models/glance-widgets.TrendTabConfig`: `{ range, name?, filter?, show? }`. A new tab writes `range`, `name` and `show`.
- A tab without `name`, `filter` or `show` (a name renamed blank, a hand-made file) reads its default name, every task, and Bars (`models/glance-widgets.trendName` / `trendShow`, `hooks/use-glance-data.trendFilter`).
- **Edit chart…** in its ⋯ (before Range) opens its editor under its title: `TrendEditor`, hosted on the page as `TrendEditorHost` (`chart-widgets-store.trendEditorTabId`).
- Its fields: name, filter with Reads as, Show as, Range.
- Save / Discard work as the Number editor's ([Glance widgets](glance-widgets.md)). The undo step is `Edited chart “X”`.
