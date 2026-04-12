# TODO


## Bugs

- [x] **TaskRow people/org dropdown broken** — `useClickOutside` on `peopleRef`/`tagsRef` fired on portal clicks (portal is outside those refs in DOM), closing dropdown before `onToggle` could execute. Fixed by removing redundant handlers; `PortalDropdown` already handles outside-click detection.


## Features and Enhancements

- [x] **Cascade shift stacked canvas projects** — auto-shift projects below when a neighbor's height changes (task add/remove, collapse), with 40px gap threshold, BFS cascade, debounced persistence
- [x] **Drag tasks to taskboard from dashboard and canvas list insets** — drag from dashboard lists (Mine/Follow-up/Assigned/Stale) and canvas list inset nodes (Due, Starred, High Priority) into the taskboard



## User Testing


## Future Work

- [x] **Collapse Dexie migrations** — collapsed v1-v15 into single v16 base schema, kept v17/v18 incremental. Removed ~287 lines and all 4 upgrade callbacks. Backward compat cutoff: 2026-04-10.
- [x] **Optimistic updates with rollback** — deferred from Phase 8
- [x] **Optimistic updates for assignment helpers** — `createAssignmentActions` (assign/unassign/bulk) needs structural refactor to access store `set` for error state before converting to optimistic pattern
- [x] **Optimistic updates for entity store updates** — person/tag/org `update` methods touch two state slices (entity list + assignment map); need atomic rollback of both
- [x] **Command palette lazy creation** — defer `Command` object creation or use a generator/filter-first approach. File: `src/services/command-registry.ts`. Needs API refactor.
- [x] **NLP cross-type overlap** — add cross-type overlap checking between token types. File: `src/services/natural-language-parser.ts`. Low priority, collisions unlikely.
