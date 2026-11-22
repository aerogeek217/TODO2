# Text moving to task-maps

Moved whole out of the layer tables' long rows. It is merged into its destination and this file is deleted.

## From models-and-data.md

### WorkspaceLayout, PersistedWorkspaceLayout, GridTrack, LayoutGrid, GridAxis, CellArea, LayoutCell, LayoutBody, emptyLayoutBody, layoutBodyOf, withLayoutBody, DEFAULT_WEIGHT, LayoutTab, WidgetKind, GlanceWidgetKind, ChartWidgetKind, GlanceTab, ChartTab, isGlanceKind, isGlanceTab, isChartTab, kindTabTitle, WIDGET_KIND_SPECS, WidgetKindSpec, WidgetKindGroup, WIDGET_KIND_GROUPS, widgetKindsOf, WIDGET_KINDS, widgetKindLabel, UNKNOWN_WIDGET_LABEL, isWidgetKind, NeglectTab, NeglectTabConfig, NeglectColourBy, defaultNeglectConfig, DEFAULT_NEGLECT_UNTOUCHED_DAYS, NEGLECT_UNTOUCHED_CHOICES, NEGLECT_UNTOUCHED_MAX, isNeglectUntouchedDays, TabSeed, TabConfigOf, TabViewStateOf, createTab, tabListId, getActiveTab, toggleCalendarDateType — models/workspace-layout.ts

**Neglect map** tabs (`neglect`, D25 board H, label "Neglect map"): config `{ colourBy: { kind: 'tags'; tagIds } | { kind: 'people' } | { kind: 'none' }; untouchedDays }` (layout config; a threshold is a whole number 1 – 59, `isNeglectUntouchedDays`, so its line stays left of the 60-day cap; the menu offers 7 / 14 / 21 / 30 / 45), no view state; a new one (`defaultNeglectConfig`) colours by `TabSeed.neglectTagIds` — the workspace store passes the `Project: …` tags (`utils/neglect-map.projectTagIds`) — at 14 days. No schema step or version marker (the user's call, 2026-11-06: older builds opening newer databases aren't a concern) — an older build's layout repair drops the unknown kind's tab. A deleted tag stays in `tagIds` and stops colouring, as in a filter.
