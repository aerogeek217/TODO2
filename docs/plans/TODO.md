# TODO


## Bugs



## Features and Enhancements

### Code Review Remediation (docs/plans/CODE-REVIEW.md)
- [ ] Add a Dashboard view. We'll start by including Top 10 lists. For a few categories, this will show a top 10 list of the most important tasks weighted by hard deadline, then due date, then priority. (For example, a task with high priority due next friday would be ranked higher than a task simply due next friday). Categories include Mine (not assigned and no discussion required), Followup, and Assigned. Also include a Stale list with the top 10 oldest "last modified" dates. The Top 10 lists are not filtered. I think we can fit all lists at once, but they could be selectable if it makes the dashboard too cluttered.


## User Testing


## Future Work

- [ ] **Collapse Dexie migrations** — export database to JSON, collapse 10 migration versions down to a single current schema declaration (keeping only the v3 upgrade logic as a safety net or removing entirely), re-import. Removes ~150 lines of redundant schema re-declarations (v5/v8/v9 are no-ops, others just add a table/index).
- [ ] **Optimistic updates with rollback** — deferred from Phase 8
- [ ] **Virtualized lists (ListView only)** — `@tanstack/react-virtual`, only when 100+ tasks visible
- [ ] **Command palette lazy creation** — defer `Command` object creation or use a generator/filter-first approach. File: `src/services/command-registry.ts`. Needs API refactor.
- [ ] **NLP cross-type overlap** — add cross-type overlap checking between token types. File: `src/services/natural-language-parser.ts`. Low priority, collisions unlikely.
