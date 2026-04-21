# Components

Detail reference for `src/components/` (task, canvas, overlays, shared, layout, settings, taskboard) and `src/views/` helpers. Load when touching UI, canvas nodes, overlays, editors, or view-level grouping/bucketing.

## Views

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| DashboardView | views/DashboardView.tsx | Horizon ribbon + two-column top row (Taskboard + hero horizon card, `@dnd-kit/sortable` order persisted via `settings.dashboardTopOrder`) + user-lists grid driven by `settings.dashboardUserLists` (sortable, per-card ⋯ overflow menu, "Add list" tile → `ListDefinitionPickerPopup`). Uses `buildDashboardLists` for every card. `DashboardListCard` is an internal helper in this file — not exported |
| truncateSections | views/ListView.tsx | Pure helper: walks ordered `Section[]` and slices the tail so total task count ≤ `maxTasks`; returns `{ displaySections, truncatedCount }`. Drives ListView's "hard" limit mode |
| buildDateSections, buildScheduledSections, buildDeadlineSections | views/ListView.tsx | Bucket todos by their date field into Overdue / Today / This Week / Later / (No Date\|Not Scheduled\|No Deadline). `buildDateSections` reads `effectiveDate(todo, today)`; `buildScheduledSections` reads `resolveScheduled(todo.scheduledDate, today)`; `buildDeadlineSections` reads `todo.dueDate`. Within a bucket order is `sortOrder` |

## Task Components

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| TaskEditPopup | components/task/TaskEditPopup.tsx | Centered modal for editing/creating tasks; project selector in create/edit mode |
| TaskEditHeader | components/task/TaskEditHeader.tsx | Title input + NLP autocomplete + close |
| TaskEditMetadata | components/task/TaskEditMetadata.tsx | Scheduled (SchedulePicker) + Deadline (DeadlinePicker) rows with combined helper line, recurrence select gated on deadline, project, people/orgs sections |
| TaskEditFooter | components/task/TaskEditFooter.tsx | Edit/create mode footer with timestamps, actions |
| MobileTaskRow | components/task/MobileTaskRow.tsx | Mobile two-line task row: checkbox + title + status icon + chevron (line 1), scheduled/deadline chips + `AvatarStack` (sm, max=3) + org/notes (line 2); 48px min touch targets; reads/writes `hoveredTodoId` on `useUIStore` for cross-surface hover sync |
| TaskRow | components/task/TaskRow.tsx | Desktop task row: checkbox, inline-editable title (via `useInlineEdit`), status icon + `StatusIcon` picker, scheduled/deadline chips with intensity fade (`dateIntensity`), `AvatarStack` (people) + org chip, notes-icon → `TaskNotePopover`, project picker → `ProjectPickerPopup`. Right-click opens `CanvasContextMenu` with Open / Mark complete-incomplete / Add-or-Remove-from-Taskboard / Move-to-project… / (separator) / Delete — last item reads "Remove from Taskboard" when rendered inside a `TaskboardPanel` (via `taskboardId` prop). No inline delete `×`. Host for the `PortalDropdown` helper (anchor tracking via `ResizeObserver` + pane scroll listener — no RAF polling post-Phase 1). All multi-select-aware mutations route through `useBulkActions` |

## Canvas Components

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| CanvasView | components/canvas/CanvasView.tsx | React Flow host. Registers node types (`project`, `listInset`, `floatingNote`, `floatingCalendar`, `taskboard`), memoizes node-data refs via `shallowEqualObject` + cache so memoized nodes don't re-render on pan/zoom, pipes `applyNodeChanges` through cascade-shift + alignment-guide computation, and owns the canvas-background `CanvasContextMenu` (New project / Add list / Add note / Add calendar / Add taskboard). The canvas-scoped `DragInsertContext` + `DragPreviewContext` providers live here so drag state is stable per drag rather than recomputed per move tick |
| ListInsetNode | components/canvas/ListInsetNode.tsx | Canvas node for a `ListInset`. Resolves `inset.listDefinitionId` against `useListDefinitionStore` and routes through `buildDashboardLists` (single-def call) — parity sorting, grouping, and predicate evaluation with the dashboard. Applies global filter first; renders a placeholder header when the referenced def was deleted. Emits draggable TaskRows (drag to taskboard) |
| FloatingNoteNode | components/canvas/FloatingNoteNode.tsx | Canvas note widget for `Note` rows with `canvasId` set. Drag/resize chrome + color-picker palette; body delegates to shared `NotesBody` (reads/writes the row via `activeIdOverride`). Replaces the retired `StickyNoteNode`; sticky-specific per-line task conversion + @/#/// autocomplete were dropped — NotesBody's Alt-T already converts the caret line. Spawn path is rail-slot pop-out only (canvas right-click "New Note" retired with notes-polish) |
| FloatingCalendarNode | components/canvas/FloatingCalendarNode.tsx | Canvas calendar widget for `FloatingCalendar` rows. Drag/resize chrome wrapping `CalendarStrip`; threads per-row `orientation` + `weekOffset` through `floating-calendar-store.updateOrientation` / `updateWeekOffset`; mounts `CalendarOrientationToggle` in `WidgetHeader`'s meta slot; wires `onReschedule` to `todo-store.update` via `buildRescheduleUpdate` |
| TaskboardNode | components/canvas/TaskboardNode.tsx | Canvas node for taskboard; resizable, closable (clears with confirmation), sortable drag reorder via dnd-kit for taskboard-internal reorder, droppable target for drag-to-add from project lists and list insets. Exposes `[data-taskboard-panel-id]` + `[data-tbp-entry]` so `computeTaskboardInsertIndex` can resolve floating taskboards, and consumes `useExternalTaskboardDrop` to accept native HTML5 drops from `CalendarStrip` |
| ProjectNavigator | components/canvas/ProjectNavigator.tsx | Collapsible overlay panel listing all projects; click to fitView-navigate; toggled with P key |
| DragInsertContext | components/canvas/DragInsertContext.ts | React context for stable per-drag state (activeDragTodoId, dragExpandedProjectId, dragGroupIds); consumed by CanvasView + ProjectNode |
| DragPreviewContext | components/canvas/DragInsertContext.ts | React context for rapidly-changing drag preview (insertTodoId, insertIndentLevel, insertAtEnd, insertProjectId); consumed only by SortableTaskList so CanvasView/ProjectNode don't re-render on every drag-move tick |
| InsertTrigger | components/canvas/InsertTrigger.tsx | Controlled "+" button between tasks for inline task creation; editing state lifted to SortableTaskList for Enter-chaining (new task opens next trigger) |
| findAlignments, findAlignmentsScoped, findResizeSnap | components/canvas/alignment.ts | Snap-to-edge alignment for dragging/resizing nodes (5px threshold, guide lines) |
| computeCascadeShifts, CASCADE_GAP_THRESHOLD | components/canvas/cascade-shift.ts | Auto-shift stacked projects when a neighbor's height changes (40px gap threshold, BFS cascade) |
| drag-preview.css | components/canvas/drag-preview.css | Intentionally global CSS (not a module) so selectors can target React Flow's own drag-preview class names; imported once from `CanvasView.tsx` |
| CalendarStrip | components/canvas/rails/CalendarStrip.tsx | Shared calendar widget body used by both rail slots (via `CalendarSlotContent`) and floating nodes. 7-day window anchored on Monday of today's week + `weekOffset * 7`; `orientation` prop flips between vertical rows and a `repeat(7, minmax(0, 1fr))` horizontal grid. Renders a `RangeBar` with ‹ / › nav + Today button (only off-week) + "This wk" hint + month-aware range label when `onWeekOffsetChange` is provided. Rows are native-HTML5 draggable; drops on sibling day cells call `onReschedule(todoId, targetDay)`; the same drag also feeds `useExternalTaskboardDrop` on any on-screen `TaskboardPanel`/`TaskboardNode` |
| EventRow | components/canvas/rails/calendar/EventRow.tsx | Single row inside `CalendarStrip`. Renders status `StatusIcon` (left) + scheduled (`calendar`) / deadline (`clock`) markers + recurrence `↻` glyph + title + people `AvatarStack` + org hollow `AvatarStack`; `compact` mode drops the org stack and caps people to 2 (used by horizontal columns). Emits `dataTransfer` with `application/x-todo-drag` → `{kind:'todo',todoId}` + `text/plain` todoId fallback |
| calendar-events | components/canvas/rails/calendar/calendar-events.ts | `buildEntries(todos, days, today, assignedPeopleMap, assignedOrgsMap, statuses)` bucket-and-enrich helper; returns a `Map<dayKey, EventRowEntry[]>` with real + virtual recurring instances, pre-resolved people/orgs/status. Virtual rows carry the parent todo so reschedule drags mutate the parent's anchor |
| CalendarOrientationToggle | components/canvas/rails/calendar/CalendarOrientationToggle.tsx | Shared ☰/☷ toggle button mounted in `WidgetHeader`'s `meta` slot by both `CalendarSlotContent` (wired to `canvas-rails-store.setSlotOrientation`) and `FloatingCalendarNode` (wired to `floating-calendar-store.updateOrientation`) |
| TabStrip | components/canvas/rails/TabStrip.tsx | Multi-tab slot header rendered by `RailsFrame.SlotRenderer` in place of `SlotHeader` when `slot.tabs.length >= 2`. Each tab pill shows `KIND_ICON` + label (lens → list name, others → kind label, truncated at 160 px with `title` tooltip) + `×` close; the active pill also carries a `⋯` menu (Pop out / Change type…). Trailing `+` button opens `WidgetKindMenu` to append a tab; trailing chrome buttons (pop-out ↗ / more ⋯ / close ×) mirror single-tab `SlotHeader`. A `⋮⋮` drag handle surfaces the whole-slot drag activator from `DraggableSlot`. Drag: pills are `useDraggable({ data: { kind: 'tab', slotId, tabId } })`; the strip is `useDroppable` on `encodeRailsDropId({ kind: 'tab-strip', slotId })` — drop onto another `TabStrip` reorders/merges via `reorderTab`/`moveTabToSlot`; drop onto a slot-level zone detaches + docks via `detachTabToNewSlot`. Keyboard: arrow-key roving (Left/Right/Home/End activates, Delete closes) + `role="tablist"` / `role="tab"` / `aria-selected` |

## Overlays

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| BulkConfirmDialog | components/overlays/BulkConfirmDialog.tsx | Confirmation dialog for destructive/relationship bulk actions (delete, complete/uncomplete, parent+children prompts); supports custom messages, labels, and skipIds for two-option dialogs |
| UndoSnackbar | components/overlays/UndoSnackbar.tsx | Bottom-center toast after destructive actions with "Undo" button, auto-dismiss 5s |
| FilterSheet | components/overlays/FilterSheet.tsx | Mobile filter bottom sheet: search, priority, date range, toggles, people/orgs/statuses accordion lists; reads/writes useFilterStore |
| CanvasContextMenu | components/overlays/CanvasContextMenu.tsx | Reusable right-click context menu (canvas background, project, box) |
| FilteredListPopup | components/overlays/FilteredListPopup.tsx | On-demand floating list popup triggered by right-clicking person/org on any TaskRow; reads from stores directly |
| PlainTextExportPopup | components/overlays/PlainTextExportPopup.tsx | Modal with plain text representation of current list sections; copy-to-clipboard support |
| MigrationDialog | components/overlays/MigrationDialog.tsx | Confirmation dialog for data migrations; `schema-upgrade` mode (full-screen, Dexie upgrade) and `legacy-import` mode (overlay modal, file/import); export backup button + apply/cancel |
| ProjectPickerPopup | components/overlays/ProjectPickerPopup.tsx | Portal-rendered positioned popup wrapping `ProjectPicker`; closes on outside-click / Escape; used by TaskRow right-click "Move to project…" |
| ListDefinitionPickerPopup | components/overlays/ListDefinitionPickerPopup.tsx | Portal-rendered popover with two modes. `dashboard` (default): lists unpinned defs with a Pin action. `canvas`: lists all defs with an `onSelect(id)` action the caller wires to list-inset creation. Both show a "Create new list…" footer that opens `DashboardListsEditor` |

## Settings Editors

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| DashboardListsEditor | components/settings/DashboardListsEditor.tsx | Settings modal: dnd-kit reorderable list of list definitions, inline rename, pin-to-dashboard toggle, delete confirm, "Add list" footer. Per-row ⚙ toggle expands an inline `ConfigPanel` for live-edit of membership-kind / `warningWindowDays` / sort / sortBy / grouping. For `kind:'custom'`, renders predicate-summary chips and an "Edit in ListView…" deep-link that applies the predicate to the live filter store, restores `listSortBy`, sets `editingListDefId`, and navigates to /list |

## Shared Components

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| AvatarStack | components/shared/AvatarStack.tsx | Overlapping circle avatars with `+N` overflow (default max=3); fill-variant color derived from the person's first assigned org via `utils/person-color.resolvePersonColor` (subscribes to `useOrgStore`; falls back to `DEFAULT_ENTITY_COLOR`); hollow variant uses the org's own color. `sm` variant; click bubbles to `onClick` (opens picker in TaskRow), right-click on a visible avatar surfaces per-person context menu. Used by TaskRow + MobileTaskRow in place of the legacy `.personChip` row |
| ChipSelector | components/shared/ChipSelector.tsx | Reusable autocomplete dropdown for assigning people/orgs; search input, filtered list, create-new option |
| IconSelect | components/shared/IconSelect.tsx | Generic `<select>` replacement showing a per-option icon in the trigger and each menu row; handles click-outside, Enter/Space/Escape and ArrowUp/Down cycling. Used by ListView's Group / Sort dropdowns |
| groupByIcons, itemSortByIcons | components/shared/list-option-icons.tsx | Icon registry for `ListGroupBy` / `ListItemSortBy` values; reuses `StatusIcon` (calendar/clock/flag/person/circle) + inline SVGs for project/org/none/manual |
| ColorInput | components/shared/ColorInput.tsx | Shared color picker: native swatch + editable hex text input with validation, 3-digit expansion, auto-# prefix, blur revert |
| ProjectPicker | components/shared/ProjectPicker.tsx | Shared project search + list UI (with "No project" option); self-contained search state |
| StatusIcon | components/shared/StatusIcon.tsx | Inline SVG icon registry for statuses (15 icons: person, message-bubble, circle, star, stop-sign, exclamation, clock, check, question, flag, eye, bookmark, snooze, arrow, calendar); returns null for unknown/missing icon |
| SchedulePicker | components/shared/SchedulePicker.tsx | Trigger chip + inline popover for `scheduledDate` (wraps `ScheduledValueMenu`); expired-fuzzy state shown with overdue marker |
| ScheduledValueMenu | components/shared/ScheduledValueMenu.tsx | Shared menu body for scheduled-value editing: 3×2 fuzzy-token grid (Day/Week/Month × now/next), action footer with "Pick a specific day…", optional "Add deadline…", conditional "Clear" |
| DeadlinePicker | components/shared/DeadlinePicker.tsx | Danger-tinted chip that opens native date picker for `dueDate`; inline clear button; precise-only (no fuzzy) |
| DateAnchorInput | components/shared/DateAnchorInput.tsx | Shared filter-predicate anchor picker: native `<input type="date">` for fixed anchors paired with a `<select>` of the 12 `RelativeDateToken`s (yesterday, today, tomorrow, start/end-of-week, start/end-of-month, etc.) plus an explicit `None` sentinel that clears the anchor to null; mutually exclusive — selecting a token clears the date and vice versa. `Custom…` is only rendered in the select when the value is a fixed anchor. Used by TopBar `DateRangeDropdown` and mobile `FilterSheet` |
| ErrorBoundary | components/shared/ErrorBoundary.tsx | Generic React error boundary (class component, documented exception); catches render errors, shows scoped fallback with "Try again" / "Reload"; wired at App level and around Canvas route |
| NlpAutocomplete | components/shared/NlpAutocomplete.tsx | Floating dropdown for autocomplete suggestions; renders people / orgs / projects with color dots |
| WidgetHeader | components/shared/WidgetHeader.tsx | Unified slot/widget chrome used by rails (`SlotHeader`), floating nodes (`FloatingNoteNode`, `FloatingCalendarNode`, `TaskboardNode`), and `ListInsetNode`. Renders kind icon (via `KIND_ICON`) + drag handle + title + meta + action buttons (pop-out ⇱, dock ↙, more ⋯, close ×). `floating` prop switches the button row to hover-reveal + applies React Flow's `nopan nodrag` classes. `onTitleClick` makes the title a `▾`-caret button that fires anchor coords — the carrier for the `WidgetKindMenu` opener |
| WidgetKindMenu | components/shared/WidgetKindMenu.tsx | Shared title-click popover: four kind radios (List/Notes/Calendar/Taskboard) + optional "Change list…" / "Change taskboard…" secondary row (label overridable via `secondaryLabel`). Rails consume it via `canvas-rails-store.setSlotKind`; floating nodes consume it via `convertFloatingKind` (in `services/float-kind-switch`). Keyboard navigation: arrow keys roving focus, Enter selects, Escape closes |

## Layout

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| Sidebar | components/layout/Sidebar.tsx | Desktop vertical icon sidebar: Canvas (grid), List (lines), Calendar (calendar) at top, Settings (gear) at bottom; hidden on mobile |
| BottomTabBar | components/layout/BottomTabBar.tsx | Mobile bottom tab navigation (List, Filters, Settings); shows filter active indicator dot |
| FileSyncBanner | components/layout/FileSyncBanner.tsx | Dismissible banner suggesting file sync when no file handle saved; dismissal persisted in localStorage |

## Taskboard

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| TaskboardPanel | components/taskboard/TaskboardPanel.tsx | Dashboard + rail card for taskboard; sortable drag reorder via dnd-kit; droppable target for drag-to-add from dashboard lists. Exposes `[data-taskboard-panel-id]` + `[data-tbp-entry]` anchors used by `computeTaskboardInsertIndex`; consumes `useExternalTaskboardDrop` to accept native HTML5 drops from `CalendarStrip` — insertion indicator merges dnd-kit `insertIndex` with the hook's `externalInsertIndex` so a single `.dropPreview` line covers both sources |

## UI Constants

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| DEFAULT_ENTITY_COLOR | constants.ts | Default color '#537FE7' for new people and orgs |
| UNAFFILIATED_PERSON_COLOR | constants.ts | Neutral grey '#9CA3AF' used as fallback for people with no assigned org (PeopleEditor swatch + AvatarStack fill) |
| INDENT_PX, TASK_ROW_PADDING_LEFT | constants.ts | Shared UI constants for task indentation |
