# TODO


## Bugs

- [x] **TaskRow people/org dropdown broken** — `useClickOutside` on `peopleRef`/`tagsRef` fired on portal clicks (portal is outside those refs in DOM), closing dropdown before `onToggle` could execute. Fixed by removing redundant handlers; `PortalDropdown` already handles outside-click detection.
- [x] **Parent+children drag restricted to top/bottom** — DragOverlay rect (tall, includes children) used by dnd-kit `rectIntersection` for collision, causing project droppable to win over task rows. Fixed: switched to `pointerWithin` collision detection, added self-group guards in drop resolver.


## Features and Enhancements

- [x] **Status feature** — user-defined workflow statuses (name, color, sortOrder) with DB table, CRUD, settings editor, default status for new tasks, task detail badge dropdown (next to priority), colored status dot on task rows, filter by status (TopBar + mobile FilterSheet), group by status (ListView with DnD), saved view serialization, bulk status commands in command palette, import/export/audit support
- [x] **Canvas respects global filters** — canvas project lists and list inset nodes now fully apply all 13 filter criteria (previously only completed/assigned filters worked on canvas; others just dimmed tasks)
- [x] **Status dot picker on TaskRow** — clicking the status dot on a task row opens a dropdown to change or clear the status
- [x] **Status drag reorder in editor** — StatusEditor supports drag-to-reorder via dnd-kit with dot-grid drag handles; order persisted to sortOrder and reflected in all dropdowns
- [x] **Cascade shift stacked canvas projects** — auto-shift projects below when a neighbor's height changes (task add/remove, collapse), with 40px gap threshold, BFS cascade, debounced persistence
- [x] **Drag tasks to taskboard from dashboard and canvas list insets** — drag from dashboard lists (Mine/Follow-up/Assigned/Stale) and canvas list inset nodes (Due, Starred, High Priority) into the taskboard
- [x] **Org autocomplete via @** — orgs appear alongside people in `@` autocomplete dropdown (sticky notes, task create, insert trigger); NLP resolver falls back to org matching for unmatched `@` names; org assignment wired through full task creation pipeline
- [x] **Remove redundant bulk actions bar** — bottom bar duplicated actions already available via multi-select-aware TaskRow icons (useBulkActions hook)
- [x] **Sticky note title grab cursor** — title label now shows grab cursor instead of text cursor, matching project node pattern (double-click to edit, otherwise draggable)
- [x] **Remove buttons on task detail chips** — people, org, and tag chips in TaskEditPopup now show × buttons for quick removal without opening the dropdown



## Up Next

- [x] **Tri-state filter dropdowns** — Assigned, Follow up, and Completed filters converted from boolean toggles to 3-option dropdowns (All/Assigned/Unassigned, All/Follow up/No follow up, All/Incomplete/Completed); radio-button dropdown UI on desktop, segmented controls on mobile; backward-compatible saved view serialization with dual-write
- [ ] **Status badge should tint to match selected status color** — the priority badge in TaskEditPopup changes its text/border/background color based on the selected priority; the status badge should do the same using the selected status's color (inline style with rgba tinting)
- [ ] **Status: canvas list inset attribute filter** — add status variant to ListInsetAttributeFilter / AttributeFilter for canvas list insets (deferred from initial implementation)
- [ ] **Status: markdown export** — include status names in markdown export task lines
- [ ] **Status: plain text export** — include status in PlainTextExportPopup task lines


## User Testing


## Future Work

- [x] **Collapse Dexie migrations** — collapsed v1-v15 into single v16 base schema, kept v17/v18 incremental. Removed ~287 lines and all 4 upgrade callbacks. Backward compat cutoff: 2026-04-10.
- [x] **Optimistic updates with rollback** — deferred from Phase 8
- [x] **Optimistic updates for assignment helpers** — `createAssignmentActions` (assign/unassign/bulk) needs structural refactor to access store `set` for error state before converting to optimistic pattern
- [x] **Optimistic updates for entity store updates** — person/tag/org `update` methods touch two state slices (entity list + assignment map); need atomic rollback of both
- [x] **Command palette lazy creation** — defer `Command` object creation or use a generator/filter-first approach. File: `src/services/command-registry.ts`. Needs API refactor.
- [x] **NLP cross-type overlap** — add cross-type overlap checking between token types. File: `src/services/natural-language-parser.ts`. Low priority, collisions unlikely.
