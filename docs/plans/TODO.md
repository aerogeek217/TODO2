# TODO


## Bugs



## Features and Enhancements

- [x] **Cascade shift stacked canvas projects** — auto-shift projects below when a neighbor's height changes (task add/remove, collapse), with 40px gap threshold, BFS cascade, debounced persistence



## User Testing


## Future Work

- [ ] **Collapse Dexie migrations** — export database to JSON, collapse 10 migration versions down to a single current schema declaration (keeping only the v3 upgrade logic as a safety net or removing entirely), re-import. Removes ~150 lines of redundant schema re-declarations (v5/v8/v9 are no-ops, others just add a table/index).
- [x] **Optimistic updates with rollback** — deferred from Phase 8
- [ ] **Optimistic updates for assignment helpers** — `createAssignmentActions` (assign/unassign/bulk) needs structural refactor to access store `set` for error state before converting to optimistic pattern
- [ ] **Optimistic updates for entity store updates** — person/tag/org `update` methods touch two state slices (entity list + assignment map); need atomic rollback of both
- [x] **Command palette lazy creation** — defer `Command` object creation or use a generator/filter-first approach. File: `src/services/command-registry.ts`. Needs API refactor.
- [x] **NLP cross-type overlap** — add cross-type overlap checking between token types. File: `src/services/natural-language-parser.ts`. Low priority, collisions unlikely.
