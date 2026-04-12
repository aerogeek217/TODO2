# TODO


## Bugs



## Features and Enhancements


## User Testing


## Future Work

- [ ] **Collapse Dexie migrations** — export database to JSON, collapse 10 migration versions down to a single current schema declaration (keeping only the v3 upgrade logic as a safety net or removing entirely), re-import. Removes ~150 lines of redundant schema re-declarations (v5/v8/v9 are no-ops, others just add a table/index).
- [ ] **Optimistic updates with rollback** — deferred from Phase 8
- [ ] **Virtualized lists (ListView only)** — `@tanstack/react-virtual`, only when 100+ tasks visible
- [ ] **Command palette lazy creation** — defer `Command` object creation or use a generator/filter-first approach. File: `src/services/command-registry.ts`. Needs API refactor.
- [ ] **Sections memo unnecessary deps** — split the `sections` useMemo per sort-mode or narrow the dependency array. File: `src/views/ListView.tsx`. Adds complexity for minimal perf benefit.
- [ ] **NLP cross-type overlap** — add cross-type overlap checking between token types. File: `src/services/natural-language-parser.ts`. Low priority, collisions unlikely.
