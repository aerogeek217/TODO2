# TODO

## Intake


## Phase 1 — Bug Fixes
Core bugs that break existing functionality.

- [x] Default status not being set on new tasks created from projects — `add`/`addAt` in todo-store don't read `defaultStatusId`
- [x] No new task button on empty project — InsertTrigger only renders inside the task loop, so empty projects show nothing
- [x] Clicking off empty new task should clear it (currently stays open)
- [x] Drag-and-drop shadow animation moves in wrong direction (jumps back to old location)
- [x] Canvas list views don't snap on width change
- [x] Status not showing on canvas tasks until visiting Settings — status store not loaded at app startup

## Phase 2 — Canvas Interaction
Canvas node improvements and drag-and-drop polish.

- [ ] Canvas list views: add height adjustor and corner drag handle (enable scrolling)
- [ ] Dragging item from taskboard onto canvas should remove it from taskboard

## Phase 3 — Task Views & Lists
Task row, detail, and list view improvements.

- [ ] Add isAssigned (delegation flag) toggle to TaskRow — currently only togglable from popup
- [ ] Lists grouping by People: include orgs first (currently last)
- [ ] Task detail: sort project selector alphabetically
- [ ] Plain text export: allow selecting text in popup (currently all or nothing)
- [ ] Show last modified date on stale tasks (dashboard)
- [ ] Add text export button to projects (like existing list export)

## Phase 4 — Smart Defaults & Filters
Intelligent behavior and advanced filtering.

- [ ] When adding task, use current filters to infer people, org, tags
- [ ] Org filter: option to only show tasks with org tagged (not people in the org)
- [ ] Button in settings to manually clean up tasks older than N days

## Unable to Reproduce

- [ ] Unable to set priority from task bar (works in detail view) — bulk-actions `setPriority` path; code appears correct

## Future work


## User Testing





