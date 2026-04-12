# TODO


## Bugs

- [x] Assign button missing in create-task mode (was gated behind `isEdit`)


## Features and Enhancements

- [x] Add a Dashboard view with Top 10 lists (Mine, Follow-up, Assigned, Stale) ranked by hard deadline, due date, and priority
- [ ] **Dashboard test coverage** — add unit tests for `scoreTask` and `buildDashboardLists` in `src/views/DashboardView.tsx`

## User Testing


## Future Work

- [ ] **Collapse Dexie migrations** — export database to JSON, collapse 10 migration versions down to a single current schema declaration (keeping only the v3 upgrade logic as a safety net or removing entirely), re-import. Removes ~150 lines of redundant schema re-declarations (v5/v8/v9 are no-ops, others just add a table/index).
- [ ] **Optimistic updates with rollback** — deferred from Phase 8
- [ ] **Virtualized lists (ListView only)** — `@tanstack/react-virtual`, only when 100+ tasks visible
- [ ] **Command palette lazy creation** — defer `Command` object creation or use a generator/filter-first approach. File: `src/services/command-registry.ts`. Needs API refactor.
- [ ] **NLP cross-type overlap** — add cross-type overlap checking between token types. File: `src/services/natural-language-parser.ts`. Low priority, collisions unlikely.
