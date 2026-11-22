# Testing

Detail reference for the test setup (`src/test/`, `e2e/`, `vitest.config.ts`, `playwright.config.ts`). Load when writing or debugging tests. `ARCHITECTURE.md` › Testing has the orientation: which layer verifies what.

## vitest (`npm test`)

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| Projects `isolated` / `shared` | vitest.config.ts | `isolated` — any test file calling `vi.mock` / `vi.doMock` (detected at config load), plus the `REFUSED_OPEN` list (`database-too-old.test.tsx`: its below-floor open makes the floor's upgrade throw, which leaves Dexie's in-memory schema of the shared `db` at the floor's tables, so every later database of the worker would lack the tables added since — v72's `statusUpdates`), one fresh worker per file so module fakes can't leak; `shared` — every other file, `isolate: false` (one jsdom + module cache per worker, the bulk of the speed-up). `e2e/**` is excluded from the sweep. The test / hook timeout is 30 s (a heavy test can take several times its ~1 s on a loaded machine) |
| vitest 5 defaults the suite relies on | vitest.config.ts | `clearMocks` is on by default: every mock's call history is cleared before each test (implementations stay), so a test can't assert calls made in `beforeAll`, at a file's top level or by an earlier test. An async assertion (`resolves` / `rejects`) must be awaited or the test fails; `vi.mock` / `vi.hoisted` must be at the top level of the file. `-t` joins suite and test names with ` > `: match one segment, or `'suite.*test'` |
| Per-test reset | src/test/setup.ts, src/test/store-tracking.ts | **Before every test, in both projects**: every zustand store back to `getInitialState()` (the setup's `vi.mock('zustand')` wrapper, `store-tracking.ts`, registers each store as it is created) and `utils/module-reset.resetModuleState()` — every module with state outside a store registers its own reset when it loads (`registerModuleReset` — writes and loads in flight in `store-helpers`, `fileStorageService`, `backupScheduler`, the file-handle cache, the file-storage prompts, the note store's save timer / queue, the settings store's OS-theme listener, the list-order load), so a new singleton is covered by registering, not by a list in the setup |
| Per-test settle | src/test/setup.ts, utils/module-reset.ts | **After every test, in both projects**: `settleModuleWork()` awaits every registered settle (`registerModuleSettle` — `store-helpers.settleWrites`: no tracked write in flight), then one real macrotask, so what a write does once its database write lands (an undo push, a rollback) happens in the test that started it, not after the next test's reset (cr31 tests 2.2: a Duplicate's undo step landed in the next test; an un-awaited `getOrCreate` took id 1 under a later test). Bounded at 2 s of real time: a write left stuck (e.g. under a test's fake timers) is forgotten by the next reset (`resetWriteTracking`). A chain of writes (one starting after another settles) can outlast it: a test waits on its own end state |
| Fake timers | vitest.config.ts `fakeTimers.toFake` | What `vi.useFakeTimers()` fakes when a test names nothing: vitest's default list less `setImmediate` / `clearImmediate`, which fake-indexeddb runs every database step on — faked, a database open started under fake timers was dropped by `useRealTimers` and every later database op of the file hung (cr31 tests 2.4). A test that names its own `toFake` replaces the list. `test/infra/fake-timers-db.test.ts` checks this and `test/infra/work-in-flight.test.ts` the per-test settle, each pair passing in either order only with its fix |
| File-boundary reset | src/test/setup-shared.ts | **At each file boundary of the shared project**: the rest of what a fresh worker would give — the Dexie db deleted, Testing Library `cleanup()`, `<body>` / `<html>` attributes / storage / URL cleared, real timers, global + env stubs undone (and clipboard stubs a file defined straight on `navigator` / `globalThis`, and a `vi.fn` assigned to `HTMLInputElement.prototype.showPicker` — jsdom has none), `vi.spyOn` spies restored |
| Shuffled run | package.json `test:shuffle`, .github/workflows/deploy.yml | `vitest run --sequence.shuffle`: files and tests in a random order, the seed printed in the header (`--sequence.seed=<seed>` replays it). The resets above make any order pass; a failure here is a leak between tests. The deploy runs it after `npm test` |
| Types and lint | tsconfig.test.json | `src/test/**` is type-checked by `tsc -b` (the app's options plus Node's types) and linted with type information like the rest |
| Tooltip queries | src/test/helpers.ts | `getByTooltip(container, text)` and its kin (`queryByTooltip`, `getAllByTooltip`, `findByTooltip`, …: testing-library queries over `data-tooltip`, flair P9) stand in for the `ByTitle` queries — `document.body` where a test used `screen`. A tooltip's text is asserted as `toHaveAttribute('data-tooltip', …)`; e2e `tooltips.spec.ts` checks the app's bubble on several surfaces and that no element on a layout of every widget kind, the task editor or Settings has a native `title` (iframes aside). |
| addTask | src/test/add-task.ts | `addTask(title)` — one task through the store's create path (`todo-store.addMany`, as Quick Add / the editor / notes create), with Settings' default status and next follow-up, as one undo step `Add "<title>"`; resolves its id. The store has no single-title create (cr31 A1), so tests' create → undo → redo exercises the path users get |
| expectWithin | src/test/timing.ts | `expectWithin(ms, run)` — "stays fast on huge input" checks: the best of up to three runs against the bound (a super-linear regression slows every run, load slows one) |
| pinTimeZone, DST_ZONE | src/test/time-zone.ts | `pinTimeZone(zone)` in a `describe` runs its tests in that zone (`process.env.TZ`, the worker's own put back after), so a daylight-saving test asserts on the UTC deploy too; `DST_ZONE` = `America/Chicago`. Build the dates inside the tests. `services/stats/history-dst.test` (cr34 T13) replays history over a 14-day window holding the 25-hour day and one holding the 23-hour day: an event belongs to its calendar day, a due date is late from the next, the log's first exact day is the day it began |
| Priority tints | src/test/services/priority-tints.test.ts, e2e/priority-tints.spec.ts | `/urgent`, `/important` and `/focus` each carry their own tint (cr34 T9). The unit test: the three pure maps (`tokenTints`, `searchTints`, `expressionTints`) and a rule for every `TokenTint` in each stylesheet that draws it (the list is typed as the whole union, so a new tint must say where it is drawn). The spec, in a real browser: Quick Add's field and chips, the notes editor, the top bar's filter field, Edit list's expression field and the Review field typed and as pills — each token's computed color and fill are its `--color-marker-*` tokens, three different colors; a color set in Settings › Theme colors reaches a typed token and stays after a reload |
| Top bar typed filter | e2e/top-bar-expression.spec.ts, src/test/stores/screen-expression.test.ts, src/test/components/layout/top-bar-search-tokens.test.tsx, src/test/utils/filter-expression.test.ts (search box forms) | Feedback P2. The store test: a typed expression split into chips and an expression (`screenFilterOf`), both narrowing the screen-filtered tasks, `fieldFilter` as typed vs canonical, Clear all (the field's ×), the panel's review and the group narrowing reading both, the new-task seeds. The JSDOM test: the field applies after the pause / on ⏎, holds what no chip says, never applies an unreadable text (its error, Esc), the pills and their ×, the results dropdown, the funnel. The spec, in a real browser: an `or` expression narrowing a list and the counter, pills and their ×, the funnel, the error line keeping the last filter, Esc, and a text chips can say showing checked in the Filter menu's pickers |
| Folder cycles | src/test/architecture/folder-cycles.test.ts | Scans every relative import in `src/` (static, dynamic, CSS, `composes … from`) into a graph of folders (`components/<area>`, the other top-level folders, each top-level file) and fails on any cycle. Its allow-list of edges is empty; an entry would fail once its edge is gone. It holds the layers in place, lowest first: `models` / `utils` → `data` → `stores` → `services` → `hooks` → `components` → `views` |
| Doc budgets | src/test/architecture/doc-budgets.test.ts | Keeps the docs small enough to load: `docs/ARCHITECTURE.md` at most 3,000 words, each file under `docs/architecture/features/` at most 4,000 (a word is a run of non-whitespace), each row of `testing.md`, `state.md` and `models-and-data.md` at most 300 (the pipes between cells left out), every feature file linked from the map, and every relative link in the map, the feature files and those three layer tables pointing at a file that exists. `services-and-utils.md` and `components.md` are held by a ratchet: `doc-budgets.baseline.json` lists their rows over 300 by name with their word counts, and a long row it does not list, a listed row that grows, or an entry whose row is at or under 300 or gone fails. Over budget, the detail moves to a feature file or the feature file is split in two |
| Export use | src/test/architecture/export-use.test.ts · export-graph.ts · test-seams.ts | Every export of the app (`src/` outside `src/test/`) is imported by another app file (or `scripts/`, a root config), or is a **test seam** listed in `test-seams.ts` — only tests import it (a pure helper tested on its own, a test oracle such as `filter-match.matchesComposedFilter`, a hook such as `module-reset.resetModuleState`); seams stay exported in place. `export-graph` parses every TypeScript file of the repository with the compiler's parser and resolves each import — static, type, dynamic (`import('…').then((m) => m.X)` reads `X`), `typeof import()`, named re-exports and `export *` — to the module that declares the name. It fails on an export nothing in the app imports that isn't listed (un-export it, or delete it), and on a listed seam that is gone, now imported by the app, or imported by no test (cr34 J3) |
| Style checks | src/test/styles/ | Contrast ratios of the text tokens (D19: the warm light theme on every surface, the accent and each layout hue at 3:1 for the focus ring, the heat map's late numbers and counts on every step, muted tab labels at the cell header's foot, a stored colour as text in light — each preset hue's and v78's four metric colours' token, and a dark-theme tone shaded by `--custom-color-shade`, at 4.5:1 on every light surface, J21), no `[data-theme]` selector in a component stylesheet, no hard-coded white, every token used and every `var()` defined, every `font-size` a `--font-size-*` token, no `--font-size-legacy-*` and no inline literal `fontSize` (`font-sizes.test.ts`) |
| Dev seed check | src/test/data/dev-seed.test.ts | Keeps `npm run seed:dev`'s output (`scripts/dev-seed.ts` → `dev-data/seed-v87.json`, a realistic export in the current schema — `Org:` people, `Project:` tags, two layouts drawn as tables (D26: tall cells spanning rows, a collapsed row, a fit row of Numbers, a fixed strip — a former band) owning their lists ("Done this week": a Completed range sorted newest first; "Not followed up lately": Last follow-up up to 14 days ago or none; "Follow-ups to chase": an expression, `not followed within last 7 days or not followup within 14 days`; a list tab at each zoom and a Neglect map coloured by the `Project:` tags, in Planning — the layout repair keeps both whole; Numbers converted from the v77 metrics by `upgrades/v78/number-metrics` (imported with its extension, so plain Node runs it); Breakdowns — Status, People, Waiting on, Tags, Priority —, a Pivot, Created vs completed and the task maps), a check-in filter, flags and follow-ups, a handful of open tasks with a planned day (yesterday, today, the next days; one repeating) and two held in the Planner's Unplanned tray, a few status updates on some tasks (none after today, the newest `followedUp` where the task was followed up), dates relative to the run day) current and clean: its version is `CURRENT_DB_VERSION` (a schema step must move the seed with it — its rows are typed by the models), and it imports with no warnings and leaves nothing for the audit |
| Check-in reply captures | src/test/fixtures/checkin-replies/ | Pasted replies to the sample check-in email (`sample-tasks.ts`, its README): `<name>.html` / `.txt` (the paste's two flavours) and an optional `<name>.expected.json`, each read by `test/services/checkin-reply/fixtures.test.ts` (a new pair is tested automatically for the general contract). Four synthetic ones (hand-made imitations, not real client output): new Outlook inline, classic Outlook inline, classic Outlook plain quoted — their `Status:` rows with the newest update's `(MM/DD)` typed over or kept —, and `synthetic-progress-label-plain-quoted` (cr27: a reply to an email sent before status updates, its `Progress:` label read as Status) |
| cell, grid, single, emptyBody, picture, numberTab, CellSpec, TrackSpec, GridOptions | src/test/helpers/layout-builders.ts | Builders for layouts in the table shape (D26), so a test says what it builds: `grid([[a, a, b], [c, d, b]])` — each inner array a row track, each entry a column track, each `cell(id, tabs)` covering the tracks where it appears (a rectangle); tracks `c1 …` / `r1 …` (or `opts.prefix`-ed), weight 1000 unless `opts` gives the column / row sizes (`TrackSpec`: a weight, or `{ px }` / `collapsed`). `single(cell)` one cell, `emptyBody()` none; `picture(body)` draws a body back as rows of cell ids (what a test asserts on); `numberTab(id, metric?, patch?)` a Number converted from a v77 metric |
| layoutSteps, settleLayoutWrites | src/test/helpers/layout-steps.ts | `layoutSteps()`: the names of the undo steps of structural layout edits (`workspace-store.isLayoutEditStep`), oldest first — what a test checks where it once checked the layout was unsaved; `settleLayoutWrites` re-exported (every committed edit's write and what follows it) |
| escapeRegExp | src/test/helpers/escape-reg-exp.ts | `escapeRegExp(text)`: the text as a pattern that matches it literally (every metacharacter escaped, the backslash too) — what a test uses to build a `RegExp` around a name or a URL, never a hand-picked character list (CodeQL's incomplete-escaping check) |
| LegacyCell, LegacyRow, LegacyColumn, LegacyBand, cell, rowOf, row, col, band | src/test/helpers/legacy-layout-builders.ts | Builders of the layout shapes before the table (v76's rows in columns, v77's bands): what an older file holds, for the schema upgrades' tests |
| computeMetrics, computeClosedThisWeek, computeMetricHistory, HISTORY_EVENT_TYPES | src/test/fixtures/v77-metrics.ts | The v77 metrics' statistics, frozen: what the v78 Numbers (`upgrades/v78/numbers`) must count the same as |
| SAMPLE_TASKS, SAMPLE_EVENTS, SAMPLE_CTX, SAMPLE_TODAY, PEOPLE, TAGS, STATUSES, ASSIGNED_PEOPLE, ASSIGNED_TAGS, SAMPLE_LISTS, windowDay, DESIGN_TREND | src/test/fixtures/glance-sample.ts | The glance widgets' sample workspace (the retired Dashboard design's), as data: today Sat 10 Oct 2026, 19 open and 14 completed tasks with 14 days of created / completed / reopened events, so the design's numbers (Open 19, Urgent 8, Overdue 2, the trend's 17 / 14, …) follow from it — the statistics, the widgets and the task dialog's tests read it |
| Export fixture | src/test/fixtures/v68-export.json | A small full export at the floor (v68, an older build's upgrade output: `Org:` people, `Project:` tags, a layout `Lists from upgrade`) — the input of the import-cap and missing-table tests. Data below the floor has no fixture: it is refused, which `import-pipeline.test` / `database-too-old.test` check with inline files and databases |
| Reference copies of upgrade code | src/test/data/reference/ (`layout-tabs-before-cr34.ts`, `layout-table-before-cr34.ts`) | `data/upgrades/layout-tabs.ts` and `upgrades/v78/layout-table.ts` word for word as they were before cr34 made their loops one pass. `data/layout-work-bounds.test` runs old and new on 7,000 seeded random layouts (tilings and tables that tile nothing) and requires equal output — the proof the upgrades produce what they produced —, and holds the import, the upgrades, the layout check and the repair to time bounds (`expectWithin`) on the security review's sizes. Never edit the copies |
| Layout write paths | src/test/data/layout-write-path-validity.test.ts | Every layout row the workspace store writes is one import accepts (cr34 T2): the store's own actions (add each kind, rename, icon, change kind, each editor's Save at its longest fields, view state, cell and layout edits, undo / redo), then the stored row must pass `validateRow` with no `rowFixes` and a full export must import with no warning. A new layout write path adds its action here |

## Playwright (`npm run test:e2e`)

| Abstraction | Location | Purpose |
|-------------|----------|---------|
| Config | playwright.config.ts | Chromium only. Starts its own `npm run dev` on port 5173, or `PW_PORT` when set (the everyday dev server is 5180; with `reuseExistingServer` a second checkout must pick its own port or it tests the first one's code), `--strictPort`, `trace: 'retain-on-failure'`, `fullyParallel` (each test has its own browser context, so tests within one spec spread across workers), `outputDir: test-results/port-<port>` (a run empties its own folder only, so two runs at once keep their traces). **A reused server must be freshly started**: after a source edit under a running server Vite serves the changed modules as `…?t=<stamp>`, the app runs on those copies and a spec's bare `import('/src/stores/…')` gets a second one, so its store calls never reach the page — `seedWorkspace` (`fixtures/workspace.hotModules`) fails at once, saying to restart the server, when the page asks for a stamped `stores` / `services` / `data` module; a spec that loads the app itself and imports its modules in the page (the launch, sync-file, backup and purge specs) takes `test` from `fixtures/test` instead of `@playwright/test`, which watches its page the same way and fails the test with the same message. **The time limit** is Playwright's 30 s per test; `PW_TIMEOUT=<ms>` raises it (0 = none; a `--timeout` flag wins). **A local full run** is `npm run test:e2e:local` (`--workers=4 --timeout=300000`: on a machine whose Chromium draws no frame for minutes after launch the first tests of each worker need the long limit; add `PW_PORT` as ever, and spec paths after `--`). The app is hash-routed (`/#/`, `/#/settings`). Specs wait on app state (a locator, a stored row, `whenIdle`, a database turn), never on timers (`waitForTimeout`). CI (the deploy workflow) runs only the vitest suite — Playwright stays local |
| seedWorkspace, seedTaskList, wsTableOf, wsRow, drag, dragTab, dragRow, dragPanel, releaseDrag, wsCell, wsTab, wsCard, wsPanelHandle, wsGhost, wsDivider, wsShape, openCellMenu, openCellLayoutMenu, pickCellMenu, pickSplit, pickWidgetKind, addWidgetAsTab, enterLayoutEdit, finishLayoutEdit, editLayout, layoutEditBar, edges, expectSameEdges, wsListWidget, reviewField, pickInReview, gotoSettingsDeepLink, openSettings, expectLayoutStored, expectLayoutStep, openListFilterEditor, closeListFilterEditor, editListSave, editListNow | e2e/fixtures/workspace.ts | The workspace fixture for specs: it seeds layouts, lists and tasks straight into IndexedDB, finds cells, tabs, cards, dividers and the drop ghost, opens the cell and layout menus, drives the layout edit mode and trusted-mouse drags, and waits until a layout edit is stored. Detail: [The workspace fixture](#the-workspace-fixture). |
| Task-row locators, rowTitles | e2e/fixtures/seed.ts | The task-row locators and the titles in display order |
| readStore, readStores, writeStores, assignedNames, afterTransactionsOn | e2e/fixtures/db.ts | Reads and writes the app's IndexedDB straight; `afterTransactionsOn` resolves once the app's transactions on given stores have finished |
| purgeDialog, openPurgeNotice, reviewPurge, dismissPurgeNotice | e2e/fixtures/purge-notice.ts | The storage pill's purge notice (desktop, or the phone's sync sheet) and the purge dialog it opens |
| box, pointIn, expectInsideViewport, clickOutside | e2e/fixtures/geometry.ts | Geometry helpers |
| stripState, stripAt, expectFits, shrinks, widestWidthWhere, findStripWidths, DESKTOP_MIN_WIDTH | e2e/fixtures/tab-strip.ts | A cell's tab strip as drawn, and **the window widths where it changes how it fits, found by measuring** (cr34 T10): a spec never names the width where tabs shrink or fold — a label or a header button changing size moved those and turned specs red with nothing broken. `stripState` reads the settled strip (every two frames until two reads agree); `findStripWidths` widens until the tabs stop growing (their full widths), then halves down to `fullAt` (the narrowest window at full width) and `foldAt` (the widest that folds a tab); `widestWidthWhere(holds)` halves for any condition that holds from some width down (throws when the range doesn't bracket it); `expectFits` is the rules (no tab cut off, the strip clear of the header's buttons, `+N` iff a tab is folded and no room for one). `DESKTOP_MIN_WIDTH` is one past the phone breakpoint. `e2e/tab-strip-fit.spec.ts`, `tab-strip-refit.spec.ts` (a sweep over the widths that shrink without folding) and `tab-strip-open-larger.spec.ts` (the header's Open larger hidden under 340px of header, the ⋯ entry kept; the strip fitting again when the button comes and goes with a Number's face, the header's width unchanged) use it |
| installClock, tooltipDelayPassed, pageTasksDone | e2e/fixtures/clock.ts | Time a spec must let pass, without a sleep (cr34 T11): `installClock(page)` before the page loads puts the app's timers on Playwright's clock (which runs like the real one), `tooltipDelayPassed` runs it a second on — every timer due fires, a hover's 400 ms tooltip delay among them — and waits a turn of the page's task queue (`pageTasksDone`), so "no tooltip opened" is exact on any machine; the same wait after the same hover with no popover open must find the tooltip (`tooltip.spec`, `workspace-list-widget.spec`) |
| render counter, expectCounterLive | e2e/fixtures/render-count.ts | Counts named components' renders through a stand-in React DevTools hook installed before the app loads (dev server names), for "this interaction renders no row" checks without timing. It leans on React's fiber internals, so `expectCounterLive` first proves it still sees renders and a React change fails loudly |
| readSyncFile, attachSyncHandle, stubFilePermission, setPermissionAnswer, answerPermission | e2e/fixtures/sync-file.ts | `readSyncFile` reads an OPFS sync file only once `fileStorageService.whenIdle()` resolves (a `File` read while a save swaps the file in throws `NotFoundError`); `attachSyncHandle` stores a sync file's handle as an earlier session would; the permission stubs script the browser's answers for the launch question |
| built-csp | e2e/built-csp.spec.ts | Builds both targets into a temp folder and runs them (online served over http, offline from `file://`) with no CSP violations. **The offline file's request audit** (cr25 P5): every request the context makes (pages, popups, frames, WebSockets) and every CSP violation (DOM events and console reports, across reloads) is recorded while it drives the built file from disk — Quick Add, an inline rename, the Edit task dialog, a completion, every Settings section, the check-in dialog's sandboxed preview, Export JSON (a `blob:` download) and Import JSON of it through the file input (the File System Access pickers removed), the glance widgets (a Number's small face and its tasks, a Breakdown opened larger; the Tags and Status Breakdowns, Created vs completed) and the Neglect map (a dot opening the editor), and the sync file end to end (Create New File, edits land in it, reload → the launch question → Grant access, the next edit lands); any URL but `file:` (with no host — a UNC share is SMB), `data:`, `blob:`, `about:` fails, as does any violation. The sync test runs its own Chromium with `--allow-file-access-from-files` (the only way a `file://` page gets OPFS), its save picker handing out an OPFS file — a real `FileSystemFileHandle`. It also runs the build's egress check (`scripts/offline-file.checkOfflineFile`) on the written file. `seedWorkspace` / `seedTaskList` take a start `url` for it |
| Before / after screenshots | e2e/type-shots.spec.ts | Opt-in, not a regression (`TYPE_SHOTS=<folder>`, the seed `TYPE_SHOTS_SEED`, default `dev-data/seed-v87.json`): imports the dev seed plus a "Shots" layout (a list at each zoom, a Review widget) and screenshots most screens — each layout, the editors, the palette, Quick Add, the filter menus, Settings, the phone's sheets — at 1440 × 900, 1920 × 1080 and 390 × 844 in both themes, Ambience off; `TYPE_SHOTS_SWEEP=1` also lists each screen's form controls with their computed font size. An unchanged tree gives the same pictures on the same day (the backups list's time aside) |
| Timings of the built file | e2e/perf-offline.spec.ts | Opt-in, not a regression (`PERF=1`, after `npm run seed:dev` and `npm run build`): opens `dist/todo2.html` from disk on the GPU, imports the dev seed plus a seven-cell layout, and prints / writes per scenario the press-to-shown and press-to-settled times, Event Timing, script / style / layout time, long frames, React renders and (traced) style-recalc element counts — layout and tab switches, a press after a layout tab, pointer crossings, focus moves, typing, completing, Open larger, adding widgets, idle. `PERF_FILE` another build, `PERF_ONLY`, `PERF_RUNS`, `PERF_DROP_RULES` / `PERF_ADD_CSS` (experiments), `PERF_TRACE_DIR`. |
| README screenshots | e2e/readme-shots.spec.ts, e2e/fixtures/readme-data.ts | Opt-in, not a regression (`README_SHOTS=1`, or a folder to write to): the README's five pictures in `docs/screenshots/` — the workspace, a list, the Review widget (the README's layouts hold none, so the shot makes one on a layout of its own and jumps to it with a person, as a Review button does — `services/review-jump.jumpToReview`), the insight widgets, Quick Add — in the dark theme over a small made-up dataset (a product team's tasks, dates relative to the run day), each cropped to what it shows. Run with `--workers=1 --timeout=600000` |
| Review jumps | e2e/review-jump.spec.ts, e2e/filtered-tasks-review.spec.ts, src/test/services/review-jump.test.ts, src/test/services/review.test.ts | A Review button's jump. The specs, in a real browser: on the open layout a list's Review these N tasks sets the widget's field to the list's filter and the focus lands on the card's update line, nothing saved; with the Review widget on another layout the person menu's Review with X opens the popup review with `@Name` instead — no layout switch, the other widget left alone —, a second Review replaces it, a reload clears it; with no Review widget anywhere every entry point still shows (the person menu, the palette, the tab menu) and opens the popup review, the task editor over it; an open editor with changes asks first — Keep editing cancels, Discard goes on; the filtered-tasks panel's Review and the phone's screen-filter dialog's open the popup review (the phone's full screen at the Review widget's medium face). The unit tests: `jumpToReview` (the open layout's widget, a replace without asking, the popup review with none there — another layout's never switched to —, the editor-leave question, a widget open larger closed unless it is that widget, the task dialog and the filtered-tasks panel closed) and each entry point's filter (`services/review`: a person, a tag, several people — names with spaces, quotes and parentheses printing as the field reads them —, a list as it shows incl. its prompt pick, every open task as an empty `and`, the top bar's chips and text search, every Breakdown split's rows keeping exactly the row's tasks, ANDed with the chart's and a count column's filter). The Review widget's session (place, marks, drafts, ✓) is `src/test/stores/review-session.test.ts` |
| Open larger | e2e/widget-popup.spec.ts, e2e/widget-faces.spec.ts, e2e/dialogs.spec.ts, src/test/services/widget-popup.test.ts, src/test/components/workspace/widget-popup.test.tsx, src/test/utils/widget-face.test.ts | Specs and unit tests for the widget popup: opening a widget larger from the cell, the menu and the palette, closing it, the dialog contract, the popup's store state and its editor-leave question, and one live widget per tab between the cell and the popup. Detail: [The Open larger tests](#the-open-larger-tests). |
| The Planner | src/test/utils/planner.test.ts, src/test/utils/planner-drop-plan.test.ts, src/test/utils/task-dnd/dispatch-planner.test.ts, src/test/services/planner-drop.test.ts, src/test/stores/planner-store.test.ts, src/test/stores/task-plan.test.ts, src/test/hooks/use-planner-window.test.tsx, src/test/data/planner-layout-shape.test.ts, src/test/components/workspace/planner-widget.test.tsx, src/test/components/workspace/planner-rows.test.tsx, src/test/components/workspace/planner-drag.test.tsx, src/test/components/workspace/planner-drag-hook.test.tsx, src/test/components/workspace/planner-menu.test.tsx, src/test/components/workspace/planner-dock.test.ts, e2e/planner.spec.ts, e2e/widget-faces.spec.ts, e2e/widget-kinds.spec.ts | The Planner's tests: the pure rules (the window, where a task sits, conflicts, the drop rule, the hand order), the window store, the stored tab's shape, the widget's faces, rows, menus and drag feedback in JSDOM, the plan and drop writes on the real stores and database, and real-browser specs for drags, faces, the dock and the keyboard. Detail: [The Planner's tests](#the-planners-tests). |
| Popup lists' group · sort | e2e/popup-sort-group.spec.ts, src/test/services/task-dialog.test.ts, src/test/components/overlays/task-dialog.test.tsx | The X of Y panel and a Number's task dialog open on Settings' new-list grouping and sort; a pick in one (Group by Priority, Sort by Due date) holds in the other until a reload, which brings back the defaults; the popover's Esc closes it before the panel; a phone's dialog takes a pick too. The unit tests: `popupListView` (defaults, the pick over them), every source in the view, a `groups` source's own headings kept until a grouping is picked |
| Hit targets | e2e/hit-targets.spec.ts | The 24px hit areas by `elementFromPoint` (UX cleanup 5A): the tab ×, the top bar's and an editor's filter-chip ×, Quick Add's chip × and the desktop checkbox each take presses over 24 × 24 px at their drawn size, while the tab's label, the chip's value, the next chip, the priority gutter and the title keep theirs; a hidden × takes none; Lines rows have no checkbox |
| Offline file check | src/test/build/offline-file.test.ts | `scripts/offline-file.ts` on fixtures: script elements found as the parser finds them (a `<script>` inside a script's text, a comment, `<scripts>`), the CSP hash over the parsed text (CR LF / CR → LF, NUL → U+FFFD), and `checkOfflineFile` — a file shaped like the built one passes; each rule fails on its own (a second or loaded script, a `<!--` in the script's text, a looser or misplaced CSP, a directive named twice (a browser enforces the first copy; cr31 L3), a wrong hash, no referrer policy or DNS prefetch control, a link / element that loads, each network API (a `window.open` reference uncalled, a resource hint's rel value quoted in script however it is set), a URL off the inert list (a dotless `//fileserver/share` and a bracketed IPv6 host too), base64 noise and escaped-slash regexes not mistaken for either) |

## The workspace fixture

`e2e/fixtures/workspace.ts` seeds a workspace for a spec and drives it. The top bar's filter has its own fixture, `e2e/fixtures/filters.ts`.

### Seeds

- The fixture seeds layouts, lists and tasks straight into IndexedDB, at the current schema version. An older stored shape belongs to the upgrade tests: `v79-upgrade.test`, `v79-real-paths.test`, `schema-v79-import.spec`.
- A layout seed is a `table` (`areas`: a line per row track, each word a column track holding a cell id), or columns of rows of cells with bands, the shape most specs use. `wsTableOf` turns the second into the table the v78 upgrade makes of it.
- `WorkspaceSeed.settings` writes settings rows as they are; `null` deletes one.
- The Default list zoom is seeded as Rows (`rowDensity: 'rows'`) unless the seed names it, so the app's Auto default does not draw a cell under 480px Stacked. `{ rowDensity: null }` gives Auto.
- A calendar tab seed's `titles` sets its month's Titles view state. Absent, the month is the heat map.
- A tag may be seeded with its color (`{ name, color }`).
- A Neglect map tab seed's `neglect` sets its Color by (tag names, `people` or `none`) and its threshold.
- A Review tab has no settings, and its picks are temporary, so a spec types them: `pickInReview(page, tabId, ...names)` fills its field (`reviewField`) and takes each name with ⏎.

Specs that rest on these seeds:

- `e2e/list-zoom.spec.ts`, at Auto: Stacked or Rows by the list's width, with hysteresis; the stepper and Ctrl + wheel step from the level shown.
- `e2e/workspace-calendar.spec.ts` seeds `titles: true` for its bar tests.
- `e2e/calendar-heat.spec.ts`: a day's step, count and `--cal-heat-*` fill; the tooltip and the popover; Titles surviving a reload.
- `e2e/neglect-map.spec.ts`:
  - Slipping tasks in the shaded corner (dot centers against its box) and in the numbered list;
  - the dots' colors, sizes and follow-up ring;
  - a click opening the editor;
  - a lasso drag selecting the corner's dots into the bulk bar;
  - the screen filter narrowing the dots;
  - the cell menu's Color by and Untouched after;
  - the phone's stacked layout.

### The table and the cell menu

- `wsShape` reads the table as drawn: the tab ids of each cell, by the column track the cell starts in, top to bottom.
- `openCellMenu` opens a cell's ⋯ menu, `Cell options`: the widget's entries, Add widget as tab ›, Remove widget, Collapse row, Edit layout ([widget-chrome](features/widget-chrome.md)).
- `addWidgetAsTab` picks its Add widget as tab ›, or Add tab › in a cell showing a tab strip (`ADD_TAB_ENTRY` matches both).
- `pickWidgetKind` picks a kind in Add widget or Change widget, a preset too.
- `wsDivider(a, b)` finds the divider between two cells.

### The layout edit mode

Helpers for the [layout edit mode](features/layout-edit-mode.md):

- `enterLayoutEdit` picks Edit layout… in the open layout's tab menu (the picker's while the layouts fold into it), then waits for the mode's bar (`layoutEditBar`).
- `finishLayoutEdit` presses Done: one undo step, its write landed.
- `editLayout(page, edit)` does both around an edit.
- `wsCard` is a card's surface: a press drags the card, a click selects it.
- `wsPanelHandle` is a multi-tab card's header room, pressed by its point.
- `openCellLayoutMenu` opens a card's ⋯ menu, `Cell layout`.
- `pickCellMenu` picks in its Insert, Merge with, Move to or Swap with submenu. `pickSplit` picks Insert ▸ New cell above, left, right or below.
- `wsGhost` is the drop ghost. `edges` and `expectSameEdges` compare a ghost with the cell it made, within 2px.

### Drags

- `drag(page, from, to, { lifted, during })` is a trusted-mouse drag. It crosses dnd-kit's 5 px activation distance and ends in `releaseDrag`.
- `releaseDrag` lets go, then waits out dnd-kit's 50 ms click stop after a drag, so the next click is not swallowed.
- `clicksGetThrough` is that wait, after a drag ends or is cancelled. `releaseDrag` uses it.

### Waiting for a layout edit

Every layout edit is saved at once, so a spec waits for the write before a reload or a stored-row read.

- `expectLayoutStored(page)` waits until the open layout's writes have landed (`data-layout-writing` off the layout controls) and none failed (no `layout-write-failed`).
- `expectLayoutStep(page, name?)` checks an edit's undo snackbar (named, with Undo), then that it is stored.
- `expectDividerStep` checks a divider's Alt-drag of part of a line: stored, the newest undo step `Moved divider` (`newestUndoStep`), no snackbar.
- `watchSnackbar` records everything the snackbar says from then on.
- `workspace-table.spec` uses both for a divider's move: the move says nothing, Ctrl+Z puts every cell back, redo moves it again, and a reload keeps each.

### Edit list and Settings

A list's filter is edited in Edit list; the list's filter line reads it in words ([lists](features/lists.md)).

- `openListFilterEditor(page, scope)` clicks the line's words in `scope` (a list widget) and returns the open Edit list.
- `closeListFilterEditor` finishes it: its Save while it has changes (written for good, one undo step), else its ×.
- `editListSave(page)` is its Save button.
- `editListNow(page, name, changes)` writes a list edit as that Save would (`list-definition-store.editList`), without the dialog.
- `gotoSettingsDeepLink` and `openSettings` open the Settings modal without racing the `#/settings` deep link's effect.

### The top bar's filter

Specs reach the top bar's [screen filter](features/screen-filter.md) through `e2e/fixtures/filters.ts`:

- the tray, the field, the Filter button and its menu: `openFilterMenu`, `openFilterPicker(page, field)`, `openFilterPickerByKeyboard`, and `openFieldPicker`, which opens the same picker from the menu;
- the field's pills (`filterPills`);
- `setShowCompleted` and `clearAllFilters`;
- `expectPeopleLoaded`, the readiness probe before a first `@`: the person store has loaded.

## The Open larger tests

What the widget popup's tests cover. How Open larger behaves is in [widget-chrome](features/widget-chrome.md).

### Specs

`e2e/widget-popup.spec.ts`:

- A List, a Calendar and a Neglect map open larger from the cell's button, from the ⋯ menu (in its widget section, before Name and icon…) and from the palette's Open Widget Larger.
- The popup's size and centering, the same data, and an edit inside (a task completed) shown in the cell.
- Esc, × and a press on the scrim close it, the focus back on the opener.
- Its ⋯ holds the widget's own entries only.

`e2e/widget-faces.spec.ts`:

- A small face's click and its keyboard opener open the popup.
- The popup stays open as the face grows.
- A plain Number's small face has no opener and opens its tasks.
- A row editor opens over the popup.

`dialogs.spec` holds the dialog contract: Esc focused or not, the focus trap, the backdrop press, and the task editor over the popup owning Esc.

### Unit tests

- `src/test/services/widget-popup.test.ts`: the store's popup state and the editor-leave question (`services/widget-popup`); the popup review's filter kept through the gone-tabs pruning, and its sort kept in memory.
- `widget-popup.test`: the host closing when its tab goes.
- `src/test/utils/widget-face.test.ts`: the Number rule (`tabOpensLarger`).

### One live widget per tab

`widget-popup.test` renders the cells and the popup's host in one `DndContext` and reads dnd-kit's registry:

- a list's rows, and a calendar's days and entries, registered again after the popup closes;
- no cell grip registered outside the layout edit mode;
- the placeholder per kind, and its face after a resize;
- the popup's `list` kind: the followed list beside that list's own tab; its zoom, wheel and details divider;
- a data replace with the popup open;
- the shown zoom after a close.

`widget-popup.spec` drags in a real browser:

- after the popup closed: a reorder, a row onto a calendar day, an entry's move;
- inside the open popup: a row dragged, with one landing slot and one order write.

On the phone, `mobile-workspace-view.test` covers the placeholder and a collapsed Number's Expand row, and `workspace-mobile.spec` the Expand row in a real browser.

## The Planner's tests

What each Planner test file covers. The rules are in [planner](features/planner.md); the widget's faces, rows, menus and drag feedback are in [planner-widget](features/planner-widget.md).

### The rules: `planner.test`

- **The window**: whole weeks, never before this week.
- **A task's natural day**: both dates; a tie is the due date's; a late date lands on today; the last day is inclusive; a date past the window; a plan does not move it.
- **What the Planner holds.**
- **Where a task sits**, in every plan state:
  - held, also when its dates move;
  - a planned day passed → Delayed; in the window; beyond it → not shown;
  - no plan → its natural day; a Focus task with none → Unplanned;
  - completed.
- **Conflicts**: a plan's conflicts with the due date and the follow-up, and their fixes.
- **The order**, in the trays too.
- **The view**: its groups, trays and tiles.
  - Every later day is listed, the empty ones too.
  - The rows' count.
  - A tile's marks: the real dates as solid ticks, then the plans as hollow ones, eight then `+N`.
  - The real dates and plans are marked wherever the task is planned; late dates mark today.
  - The shifted window: Today and the trays kept, all seven days listed, a task between tomorrow and the window in no group.
- **The drop rule**, as a table:
  - on a day: planned; cleared on its natural day; nothing where it sits; refused before today;
  - on Unplanned: held (a planned task with no date and not in Focus too, so Unplan never takes a task out of the Planner); a Focus task's plan cleared; nothing; refused;
  - on Delayed: no drop;
  - a completed task;
  - what each writes;
  - a task planned for its own day keeps its plan where it sits; another task's own day is tested before where it sits.
- **A plan on a real date's day**: placed, a tile mark, Delayed once past, planned later past the window.
- **A task planned later**: on its natural day, placed, in conflict; `plannerShows`; in the view, the tiles and Reset plan's counts; Snooze from its planned day.
- **A row's tag**: a Delayed row's planned day; a held row's natural day; a conflict with every fix once; its words and tooltip; the day in words.
- The dates drawn late.
- **A Move date fix** that puts the task on its planned day by its own dates (the plan cleared), and ones that do not (another, earlier date; past the window).
- **Snooze, Unplan and Unplan all Delayed**: each task is in Unplanned afterwards.
- **Reset plan**: its scopes and counts, and the week scope's name (This week, or the shifted window's range).
- **The labels**: a tile's name with its marks; a placed row's state in words.
- **Daylight saving** (`pinTimeZone`): the same over both changes, for the window, a plan across the change, conflict days and Snooze.

### The window: `planner-store.test` and the hook

`planner-store.test`: shift, reset, nothing picked, the key (a layout and a tab), `keep` (a layout's windows cut to its Planner tabs, the other layouts' kept), and the store back at its start in the next test.

`src/test/hooks/use-planner-window.test.tsx`, on the real workspace store and database:

- A duplicated layout keeps its tabs' ids; its Planner starts on this week while the original keeps its week.
- Change widget away and back, an undo and its redo, and a closed tab each drop the window.
- A view change does not.

### The stored tab: `planner-layout-shape.test`

- A new tab passes unchanged.
- A hand order is kept; its non-strings and repeats are dropped; it is cut at 1000.
- A stray key or config is a fix.
- The trays dock's share (0.1–0.9) and fold (`true`) are kept; anything else is dropped, a fix.
- A key stored as `undefined` reads as absent.

### The widget: `planner-widget.test`

JSDOM, with the body's size mocked.

- **The large face**: two panes, the days in one list and the trays, with their groups, counts and rows. The rows are the list's draggable occurrences, with no `data-list-widget`.
- An empty day is a quiet heading that is still a group. Today and Unplanned say when they hold nothing.
- The hand order and the screen filter.
- **The strip**:
  - its names;
  - its marks: solid ticks for real dates wherever the task is planned or held, hollow ones for plans, eight then `+N`;
  - the week rule: a Monday and a Sunday first day of the week, none in a window that starts on it.
- **A tile's click** scrolls the day list and picks nothing. The pane's `scrollTo` and boxes are stood in for: smooth, at once under reduced motion, nothing where the list does not scroll, a shifted window.
- The week arrows, and the window kept across a remount.
- The top line's range and badge.
- Today's foot: `N done`, and no Add task row.
- **The trays**:
  - a passed plan in Delayed, above Unplanned and never in Today;
  - the Unplan button between them, and its one write;
  - a held dated row in Unplanned;
  - the trays kept while the window is shifted, and in one column.
- A completed row and a repeating occurrence linger, then leave.
- The rows' zoom: one grid per pane.
- The medium and small faces, and the phone.
- **The portrait layout**:
  - the days over the trays dock in a tall, narrow cell, and one column elsewhere (short, squarish, wide);
  - the stored share drawn;
  - the arrows in the top line when the Planner is alone in its cell, on the strip in a cell of tabs;
  - ↑ / ↓ on the grip saving 16px steps, and a double-click clearing the share;
  - the chevron folding the dock, and the folded bar (Delayed left out while empty) unfolding.

`planner-dock.test`: `clampDockShare` (each side's minimum, the stored bounds, unmeasured).

### The rows: `planner-rows.test`

JSDOM.

- **The corner flag**: on placed rows only (Rows, Stacked, Lines, the phone); around the row, not in it.
- **Each tag**: a Delayed row's day; a held row's; a conflict's words, as a button. It sits after the title's text, leads a Stacked row's details, and is on a line.
- **The fix menu**: its entries for a due date, a follow-up and both; a pick's write (the date edited, the plan cleared; the plan moved); Esc handing the focus back.
- The passed date is drawn late, and no other.
- **The hover buttons**:
  - Snooze and Unplan on a row of a day or of Delayed;
  - in Unplanned: Today, and on a held row Remove or Clear;
  - none on a Lines row or the phone;
  - their writes and tooltips.
- **Reset plan**:
  - the top line's button and its three choices with their counts, inert at 0;
  - each choice asks, then is one `setPlan` with the snackbar;
  - the first is named for the shown range while the window is shifted;
  - the ⋯ menu's Reset plan › for a cell of tabs;
  - the report they read, `planner-store.resets`: one per change of a count, the action reading the view of the moment, none for a Planner that is not drawn, another cell's menu hook not run again by a task change.
- **A row planned later**: on its date's day, flagged, `planned Fri, Nov 27` as a button with the fixes, its date late, Snooze from the planned day.
- The flag's words in the row's accessible description: a checkbox, a line, the phone row.
- **The focus follows a row moved from the keyboard**: Snooze, Unplan, Today, Remove, a fix; the row that took its place; the group's heading; a pointer's press moves none.
- **A row outside a Planner**:
  - a desktop row, a stacked row, a line and a phone row draw the same markup with no provider as with one that adds nothing;
  - a list widget's row has no flag, tag or buttons, and its dates are as late as they are whatever plan the task has;
  - the extras reach a row only through the provider;
  - the drag overlay's copy takes none.

### The faces in a real browser

The faces follow `ResizeObserver`, so specs test them.

`widget-faces.spec`:

- **Large**: seven tiles of one width between the arrows; their marks; the two panes' geometry and groups; a tile's click picking nothing; a row dragged onto a tile, lifting and landing on that day with its tag; the week arrows and the range's way back.
- Today has no Add task row.
- **Medium**: one column; Stacked rows at Auto (the seed's `rowDensity: null`); the arrows around the range when too narrow.
- **Small**: its count; a click opens it larger; the week kept across the popup.
- **The phone**: seven tiles inside the screen, phone rows, the empty days left out.

`widget-kinds.spec` adds the Planner, switches to it, closes it, and shows it with every other kind.

### The plan write: `task-plan.test`

`src/test/stores/task-plan.test.ts` runs `setPlan` and `setPlans` on the real store and database:

- each plan state, both fields in the task's one write;
- one undo step restoring both;
- no stamp on the write, its undo or its redo;
- no history event, and no real date written;
- nothing written when nothing changes;
- a failed write rolled back, reported and resolved `false`, never a rejection;
- two overlapping failed writes never leaving a planned day beside `unplanned`, and the tasks read back as stored;
- a repeating completion clearing the plan state: checkbox and bulk, undo and redo, a failed write;
- Duplicate and Make subtask of… leaving it behind.

### The drops, the hand order and the row menu

`planner-drop-plan.test`:

- `plannerReorder`: inside a group; at a group's end; into another group; a row not shown yet; an empty group; each task once; a bad place; the cap (the tasks not shown go first, the earliest first, then the group dropped into is kept whole).
- Its merge into the stored order:
  - a task the screen filter hides and a day outside a shifted window keep their places;
  - only the dropped row moves among the stored ones;
  - every shown task is given a place;
  - only the tasks that no longer exist are dropped;
  - the same with the two trays' rows in the sequence.
- `plannerMovePlan`: each decision with and without a place; a reorder with no write (in a day, in Unplanned, in Delayed); a row dropped where it is; a refused drop; the window it is read against.

`dispatch-planner.test`, the dispatcher's Planner branch:

- one `planner.drop` with the droppable's data, for a tile, a group and each tray;
- whatever is dragged: that Planner's row, a list's, another Planner's, a calendar entry;
- never the calendar's ops or its chooser;
- made in the drop's own turn, and awaited;
- unhandled without `planner` ops, without a task, or for malformed data.

`planner-drop.test` runs the real stores and database as the page drives them (dispatcher → plan → write). It counts the task writes that reach the database, those touching a real date, and the view-state writes.

- **A drop on a day**:
  - a row there by its follow-up or its due date is planned for the day, its date untouched: no stamp, no history event, one undo step and its undo;
  - a planned or held row moved, both fields in the one write;
  - the plan cleared on the task's own date's day;
  - nothing on the row's own day.
- **Unplanned**: holding a dated row; holding a planned task with no date that is not in Focus, and its undo; clearing a Focus row's plan.
- **Delayed** takes no drop but its own reorder. A completed task is refused.
- **Rows from elsewhere**: a list's row and a calendar entry by the same rule; the task as stored, not as dragged; a task gone.
- **The order**:
  - in-group: no task write, no undo step, the other Planner's untouched;
  - cross-group: one of each write;
  - written before the task, and synchronously;
  - the place only from that group's preview;
  - a tile keeping it; a no-op;
  - a filter-hidden task and a shifted-out day keeping their places;
  - only deleted tasks leaving the order (a completed one stays);
  - the cap.
- **Plan for day ›**'s writes.
- **Snooze**: the next day; tomorrow from a tray; the plan cleared on the natural day.
- **Unplan.**
- **Unplan all Delayed and Reset plan's three scopes**: each one write and one undo step with the snackbar, its undo and redo; the step is named for the shown range in a shifted window. Reset plan asks first.
- **Snooze past the window**:
  - no date: out of view, the snackbar `Planned for Fri, Nov 27` and its undo;
  - a date in the window: the row stays, planned later, no snackbar.
- **A failed plan write**: the user told, the plan as it was, the hand order back to the one stored before.
- **A conflict's fixes**:
  - Move due date / follow-up is a real edit: the day at local midnight, stamped, a history event, the plan cleared in the same undo step when the task's dates then put it on its planned day;
  - the plan is kept while another, earlier date still puts the task elsewhere; the second fix then clears it;
  - Plan for that date's day goes through the drop rule.
- **A row planned later**: Plan for its date's day; Move date to the planned day takes it out of view, with the snackbar `Moved the due date to …`.

`planner-drag.test` (JSDOM, the store's preview set by hand):

- the target's tile and group marked, with no tone;
- nothing for a refused drop (the not-allowed cursor) or a no-write one;
- another Planner's preview ignored;
- the drop slot at each place, in a tray, in an empty day, and in place of Today's empty line;
- the label's texts and absence, and its place above the row at the window's foot;
- Plan for day ›, Snooze and Unplan in a row's menu, and their writes (the plan only).

`planner-drag-hook.test` is isolated: dnd-kit's monitor is stood in for, and the drag's events are sent by hand over mocked boxes.

- an own row, or a task from elsewhere; a drag with no task ignored;
- the preview over a tile and over a group: the place by the pointer among the rows without the task's own, for a list's row too;
- no place for a refused drop;
- a planned task with no date held, with a place in Unplanned;
- the trays;
- the preview dropped off its targets, at the end, on cancel and on unmount;
- another Planner's left alone.

`planner-menu.test`:

- Plan for day ›'s submenu: the line saying a pick plans the task, the days, the checked day, where the row is, a shifted window;
- Snooze's day;
- Unplan off, with its reason, in Unplanned;
- none for a completed task;
- their place in the task menu.

### The spec: `e2e/planner.spec.ts`

Trusted-mouse drags. Dates are read from the database as days from today and a time of day.

**The drops**

- A follow-up row on a later tile: the neutral mark, the label, a planned day, the follow-up and the stamp untouched.
- A due row on a tile: a planned day, the due date kept, no stamp; its undo and redo.
- A row dropped on the day its own date puts it loses its plan.
- A dated row held in Unplanned across a reload.
- A Focus row planned and unplanned.
- A passed plan in Delayed, not Today. Delayed refuses a drop: the not-allowed cursor, nothing written, no undo step.
- A reorder inside Today kept across a reload: the stored order, no task touched.
- Reorders leave the rows they cannot see in place: one the screen filter hides, a day the shifted window leaves out.
- A drop into another day's group at its place, then at the top of Today.
- A list widget's row on a tile and into a group; the list's row and order untouched.
- A Planner row on a list (nothing) and on a calendar day (the calendar's due date, the plan kept).
- Snooze, Unplan and Plan for day › from the keyboard: Shift+F10, the arrows, Enter. Unplan is off, with its reason, in Unplanned.
- The medium face's one column.
- A Planner under the widget popup takes no drop.
- Esc cancels a drag over a group.

**The portrait layout**

- The days over the dock, the top line's arrows, the tiles' ticks, the days-in-view line following a scroll.
- The dock's edge dragged: live, stored, kept across a reload. Then ↓ and a double-click.
- Folded, and kept across a reload. A dated row dropped on the bar is held in Unplanned with its date kept (the bar marked, the label `Unplan`). A click unfolds it.

**The layout and the rows' marks**

- The large face: the days' seven groups on the left with their quiet headings; Delayed, the Unplan button and Unplanned top to bottom on the right, on a darker ground; the tiles' solid and hollow ticks and their one width; the week rule.
- In a short Planner:
  - a tile's click scrolls the day list to its day (a near day to the pane's top, a late one as far as the list goes) and picks nothing;
  - a day's group scrolled out behind the strip takes no drop (the tile's instead);
  - a tray's row dropped on an empty day's quiet heading.
- Hover Snooze: a Today row to tomorrow, its flag and tag, the due date kept.
- Hover Unplan: held, the tag of the day it came off. There the row has only a Today button, and hover Today brings it back.
- Unplan keeps a planned task with no date and no Focus in Unplanned across a reload.
- The ↓ Unplan button: the Delayed rows' tags, its tooltip, both tasks held in one step, the snackbar's Undo.
- Reset plan › This week from the top line: the counts, the question it asks first, every plan cleared and no date, the snackbar's Undo, a choice inert at 0. Today only from a tabbed cell's ⋯ menu.
- A row planned after its due date:
  - the tag; the date drawn late (bold, banded); the tag in view and pressable under the hover buttons; its menu's two fixes; Esc back to the tag; Enter from the keyboard;
  - Move due date to …: the date edited and stamped; the plan, flag and tag gone; one undo step;
  - Plan for …: the plan cleared on the date's day, the date untouched.
- Panes narrow enough for Stacked rows: the flag at the row's corner, taking no press and staying on the lifted row's slot; the tag leading the details; the late date; the hover buttons; the fixes.
- The phone's one column: the groups in order, flags and tags, no hover buttons, a tile's tap, the Unplan button.

**The keyboard**

Enter on a row's Snooze, Space on its Unplan, and Enter through a tag's menu. The focus is on the row at its new place each time, and on its group's heading once the row is snoozed out of view.

**A plan past the days shown**

- Snooze from the last day:
  - a dated row stays, tagged with the planned day, its date late, with its fixes;
  - one with no date leaves, the snackbar naming the day; the next week shows it; Undo brings it back.
- An overdue row dragged onto next week's tile is still in Today on this week, counted by the tile, the badge and Reset plan.
