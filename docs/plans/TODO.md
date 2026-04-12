# TODO


## Bugs

- [x] **Recurrence day drift** — monthly/yearly recurrence drifts when months have fewer days (e.g., Jan 31 → Feb 28 → Mar 28). Need to store original day-of-month alongside recurrence rule. Files: `src/models/recurrence.ts`, `src/services/recurrence.ts`. Requires model change + DB migration.
- [x] When a line wraps on a post-it, there should be only one icon to add it as a task (at the start of the line). Currently it's placing an icon for each wrapped line, and these are actually adding the next task down.
- [x] When delegated parents are hidden, non-delegated children should still show up. The parents would have the ghost appearance in this case.
- [x] When selecting text on a task detail page (and possibly other popups), if I accidentally drag the cursor away from the text input it closes the task. It should not close it.
- [x] When clearing filters on the lists page, preset badges are remaining highlighted even if they're not longer active

## Features and Enhancements
- [x] Don't allow tasks with no people or org to be assigned.
- [x] Change Starred to Followup. Change it to a chat bubble icon instead of a star.
- [x] Parents should not show a checkbox
- [x] Post-its are hard to drag because the title text input field is interfering. How are we doing it on projects?
- [x] Person and org initials: Allow up to 3
- [x] For recurring tasks, add quarterly option
- [x] When exporting JSON, include a timestamp so we don't have conflicts for same-day saves.
- [x] Confirmation on delete post-it with non-empty contents
- [x] Confirmation when deleting list presets
- [x] Allow initials to be specified for orgs
- [x] In lists (filter selectors, selections in task detail, people editor), sort people and orgs alphabetically
- [ ] Separate people and orgs into separate editors on the settings page
- [ ] In list view, when grouping by people, for tasks with more than one person, only group by people that satisfy any active org filters. I'd expect to see only people from the filtered org(s) as the grouping headers. Currently it's just picking the first person on the task, regardless of whether they satisfy the filter. I think this is the only combination where this issue occurs, but think about other types of filters and groups.
- [ ] Post-it delete confirmation should use the same UI pattern as other confirmations, not a custom set of buttons on the post-it

## User Testing
- [x] Selecting text on task detail doesn't close window
- [ ] List presets not highlighted after filters cleared
- [ ] Confirm when deleting presets
- [ ] Initials for orgs
- [ ] Alphabetical people and or sorting

## Future Work

- [ ] **Collapse Dexie migrations** — export database to JSON, collapse 10 migration versions down to a single current schema declaration (keeping only the v3 upgrade logic as a safety net or removing entirely), re-import. Removes ~150 lines of redundant schema re-declarations (v5/v8/v9 are no-ops, others just add a table/index).
- [ ] **Optimistic updates with rollback** — deferred from Phase 8
- [ ] **Virtualized lists (ListView only)** — `@tanstack/react-virtual`, only when 100+ tasks visible
- [ ] **Command palette lazy creation** — defer `Command` object creation or use a generator/filter-first approach. File: `src/services/command-registry.ts`. Needs API refactor.
- [ ] **Sections memo unnecessary deps** — split the `sections` useMemo per sort-mode or narrow the dependency array. File: `src/views/ListView.tsx`. Adds complexity for minimal perf benefit.
- [ ] **NLP cross-type overlap** — add cross-type overlap checking between token types. File: `src/services/natural-language-parser.ts`. Low priority, collisions unlikely.
