# Filters

One filter model serves lists, Numbers, charts, the check-in, the Review widget's field and the top bar. A filter is a `TodoPredicate` (`models/filter-predicate`): either **Graphical** (chips, ANDed) or a typed **expression** (`TodoPredicate.expression`, `models/filter-expression`). At evaluation time it is a `FilterCriteria`. The logic is in `utils/filter-criteria`, `utils/filter-match`, `utils/filter-expression` and `utils/predicate-expression`; the pickers and fields are in `components/shared/filters/`.

The top bar's filter is in [The screen filter](screen-filter.md); a list's own is in [Lists](lists.md).

## The stored filter and the runtime filter

### Stored: `TodoPredicate`

A `TodoPredicate` is serializable: number arrays and `DateAnchor`s, no Sets and no Dates. A list keeps its filter in its `ListMembership` (`{ kind: 'custom', predicate }`).

- `showCompleted`: completed tasks pass too (see [Completed tasks](#completed-tasks)).
- `personIds`: plain membership over the task's assigned people. `0` is unassigned.
- `statusIds`.
- `tags`: tag ids, ORed. Optional on read.
- `searchText`.
- `dates` (`DateFilters`): see [How a clause is stored](#how-a-clause-is-stored).
- `markers`: the Priority filter (see [Priority filters](#priority-filters)).
- `negate`, optional: the "is not" switches (see [Is not](#is-not)).
- `expression`, optional: see [Graphical or an expression](#graphical-or-an-expression).

Around it:

- `emptyPredicate()` sets no clause, so it keeps every open task. A new list starts from it.
- `FilterClauses` is the narrowing fields: `personIds`, `statusIds`, `tags`, `searchText`, `dates`, `markers`, `negate`. It is what a chip can be. A predicate is one, so the clause helpers work on both. `emptyFilterClauses()` is none.
- In stored form (`utils/filter-clauses.normalizeClauses`) every field is present, `negate` only while a field reads "is not".
- How a stored predicate is checked and rebuilt on read (`data/predicate-shape`) is in [models-and-data](../models-and-data.md).

### Runtime: `FilterCriteria`

`FilterCriteria` (`utils/filter-criteria`) has the same fields, with `personIds`, `statusIds` and `tags` each `null` or a `Set` of ids.

- `predicateToCriteria` converts a stored predicate at evaluation time, and `criteriaToPredicate` converts back.
- `predicateToCriteria`:
  - reads the date clauses through `utils/date-filters.readDateFilters` (each anchor through `readDateAnchor`; a clause that filters nothing is left out);
  - builds an id Set only from an array (anything else is no filter);
  - normalizes the Priority filter (no condition left is `null`).
- Both converters carry `expression` over as it is.
- `countActiveFilters(f)` counts one per control: people, status, tags, dates (once, however many dates filter), Priority, Show completed and search. It counts one more for an expression (the screen filter's typed one). It drives the phone's Filters badge.

A task must pass every clause, and the expression on top of them. The evaluators are in `utils/filter-match` (see [state](../state.md)).

## Date clauses

A filter keys a date clause by one of six dates: Due, Next follow-up, Last follow-up, Completed, Created, Modified. They are the date panel's two rows of three (`DateFilterPanel`). A task must pass every date clause (`utils/filter-match.matchesDateMatch`).

### Entering a range

The panel's **Show** row picks how a range is entered:

- **Calendar**: each end is a date, with **Set to…** presets.
- **Relative**: each end is typed as an interval from today, in the app's one interval grammar: `+2w`, `-1m`, `+3d`, `today` or a rolling day's words.
  - The end is written once the text reads. When it doesn't, nothing is written and the field shows its hint.
  - It is stored as an `offset` anchor (see [How a clause is stored](#how-a-clause-is-stored)).
  - The field's chevron keeps the rolling days and the open end (**No start** / **No end**).
  - Under the field is its day today (`Thu, Dec 3`).
  - A new range opens in Relative.
- **Any** / **None**, on the optional dates only.

Switching between Calendar and Relative converts the ends. The mode itself is not stored: it is read from the ends.

### Rules per date

- Due, Next follow-up and Last follow-up are the optional dates (`OPTIONAL_DATE_FIELDS`). They offer **Any** / **None** and "also tasks with no date" (for Last follow-up, "also tasks never followed up").
- A range may be **is not**: the date, as a day, is outside the range, and a task without the date is kept ("Last follow-up is not 1 week ago – Today"). Every date but Completed has it (`NEGATABLE_DATE_FIELDS`).
- Completed is a range only. Its range lets completed tasks through (see [Completed tasks](#completed-tasks)).

### How a clause is stored

`dates` is a `DateFilters`: one clause (`DateMatch`) per date that filters. An absent key means that date does not filter, and `{}` is no date filter.

| Key | Date |
|-----|------|
| `deadline` | Due |
| `followup` | Next follow-up |
| `lastFollowup` | Last follow-up |
| `completed` | Completed: a completed task's `completedAt` |
| `created` | Created |
| `modified` | Modified |

A clause is one of:

- `{ match: 'range', start, end, includeNoDate?, not? }`.
  - Each end is a `DateAnchor`, or open. A range with neither end is not stored.
  - `includeNoDate` is "also tasks with no date". It is stored only when true, and only on the optional dates.
  - `not` is "is not". It is stored only when true, never on Completed, and with no `includeNoDate` beside it.
- `{ match: 'set' }` / `{ match: 'unset' }`: **Any** / **None**, on the optional dates only.

A `DateAnchor` is resolved at evaluation time. It is one of:

- `fixed`: an ISO date. `fixedAnchor(d)` wraps a `Date` as one, and the screen filter's `setDateRange` sets its due-date range so.
- `relative`: a token of `RELATIVE_DATE_TOKENS`: yesterday, today, tomorrow; the start and end of this, next and last week and month; the end of month + 3.
- `offset`: a signed count of `days` from today or, with a `unit` of `w` / `m` / `y`, of weeks, calendar months or years.

## Completed tasks

A completed task passes a filter only through **the completion gate** (`filter-criteria.admitsCompleted`). The gate is open when:

- `showCompleted` is on, or
- a Completed date range is among the clauses, or among the expression's top-level `and` terms.

The range then keeps only the tasks completed in it: an open task has no completion date. So a "Done this week" list needs no Show completed.

- This holds in a list's filter and in the top bar's chips.
- A Completed range inside an `or` or a `not` is a plain date clause and does not open the gate: the `or` would keep open tasks by its other terms.
- In an expression, Show completed stays the predicate's flag. The text says it as `and done`.
- A recurring task's completed occurrence does not count. Completing it advances the task to its next occurrence, which is open and has no `completedAt`, so a Completed range never lists it.

The same gate decides what else counts completed tasks:

- The top bar counter's total, and its `tasks` / `open tasks` words (`ScreenTaskCounts.withCompleted`; see [The screen filter](screen-filter.md#the-counter)).
- The filtered-tasks panel's description.
- The calendar's hidden count.

The glance widgets take the screen filter with completed tasks always let in (`statsFilter`), and each widget's own filter decides completion (see [Glance widgets](glance-widgets.md)). Under a screen filter's Completed range, a widget that counts open tasks has none left; the completion trend (Created vs completed) still counts.

## The screen filter and a list's filter together

`composeScreenFilter(screen, list)` gives the two stages a task must both pass:

- **Narrowing clauses AND**, strictly, even on the same field: screen `@Alice` with list `@Bob` keeps the tasks assigned to both.
- **Each side keeps its own "is not" switches**: screen `Status is not Waiting` with list `Status is Waiting, Done` keeps Done.
- **Completion ORs into both stages**: `admitsCompleted` of either side. A list's Completed range lets completed tasks past the screen stage too, and the chips' past the list's.

## Graphical or an expression

A filter is one or the other:

- **Graphical**: its chips, ANDed, one per field. Priority alone may repeat (see [Priority filters](#priority-filters)).
- **An expression**: typed text, stored as `TodoPredicate.expression` (a `FilterExpr`). The chips' clauses are then empty, and a task must pass the expression. A read folds any clause left beside an expression into it (`pickPredicate`; see [models-and-data](../models-and-data.md)).

A predicate without `expression` is Graphical. Any stored filter may hold one. The screen filter holds one beside its chips (see [The screen filter](screen-filter.md)).

### Chips

- Everywhere, a chip's picker opens as a popover under the row.
- **+ Filter** adds a chip. In an editor that already has a row it reads **+ Another filter (AND)**.
- The editors (Edit list, the check-in) stack one chip per row, in the order they were added: a new filter goes last. A chip's text wraps to the block's width.
- A chip with several values reads them with `or` (`Aisha or Ben`).

### The Graphical / Expression switch

An editor shows a **Graphical / Expression** switch over the filter (`PredicateChips`; its ⓘ explains).

- **Expression** turns the chips into the text that filters the same.
- **Graphical** over an expression turns a plain `and` of one-per-field terms back into chips. Anything else is locked, with **Edit expression** and **Clear and use Graphical**.

### Expression grammar

The grammar is in `utils/filter-expression` (parse, print, convert, tree). Terms are joined by `and` / `or` / `not` and parentheses.

| Term | Forms |
|------|-------|
| Person, tag, status | `@person`, `#tag`, `!status` |
| Priority | `/urgent` · `/important` · `/focus` |
| None or any | `no` / `any` person · tag · status · priority |
| Text contains | a quoted phrase (bare words are quoted when the field settles) |
| Date | a date word (`due`, `followup`, `followed`, `created`, `modified`, `completed`) with what follows it, below |
| Shortcuts | `overdue`, `followup late`, `never followed` |

After a date word comes one of:

- **A day**: `fri`, `11/30`; `+3d` / `-30d` (days from today); `+2w` / `-3m` / `+1y` (weeks, calendar months or years, printed back in the unit stored). `in 2 weeks`, `3 months ago` and `within 2 weeks` read too.
- **A period.**
- **A comparison with a day**:
  - `<=` / `>=`: the day included, as printed (`due <= +7d`, `followup >= +7d`, `created <= -30d`).
  - `<` / `>`: the day before / after. A week or month edge steps onto its neighbor: `< start of week` = `<= end of last week`.
  - `=`: a day, or a period.
  - The older `before` / `by` / `after` / `from` still read, and settle as comparisons.
- **A range** `a..b` (`due -3d..+7d`). Two dates, or two days from today, that end before they start are an error.
- `any` / `none`.

### The expression field

`ExpressionField` (`hooks/use-expression-field`) edits an expression:

- It tints the tokens.
- It autocompletes names after `@` `#` `!` `/` (`services/filter-expression-field`).
- It writes once the text reads: after a pause, on blur or on Enter. It never writes a text that doesn't read; an error line says where, with its hint in a tooltip.
- Esc puts the written text back.
- Settling prints the text canonically.
- Under the field, **Reads as** lists what is kept and dropped as chips, and **Syntax…** opens the cheat sheet.

Its hosts:

- The check-in's filter refuses people: each check-in is one person's ([Check-ins](check-ins.md)).
- The top bar takes the same expressions. What chips can say becomes chips, and the rest is held beside them ([The screen filter](screen-filter.md)).
- The Review widget's field is in [Review](review.md).

## A filter read back in words

On a list's filter line the filter is **read back in words** (`utils/filter-expression/words` → `ExpressionWords`). An expression reads as itself; a Graphical filter reads as the expression that filters the same.

- Names are chips, styled as the Graphical chips.
- Other terms are word terms; a date reads as its chip words it.
- Joining words are muted:
  - The top-level `and`'s terms are joined by ` · `.
  - A top-level `or` is joined by `, or`.
  - An `or` elsewhere is bracketed.
  - An `and`'s `not` terms come after `but not`.
  - Examples: `(Aisha or Ben) · not #Ops`, `Aisha, or #q4 but not Waiting`.
- Too long, the line fades at its end with `+N more`: the top-level terms not shown.
- Its tooltip is the exact expression, and a click opens Edit list.

Every summary in words reads an expression in the same words, as plain text (`LineItem.words`): Copy from's list hints, a Number's description, a list's empty state.

## Priority filters

**Priority filters read as Status's**: is / is not, several values OR, and `No priority` (a task with no marker; effective Urgent counts as a marker).

- `markers` is a `MarkersFilter` or `null`: a list of conditions (`MarkerClause`, `{ values, not? }`), a chip each (`FilterChip.markerIndex`, as a date chip has its `dateField`).
- A condition keeps a task that is any of its `values` or, with `not`, none of them (`utils/markers.matchesMarkerClause`). A value (`MarkerValue`) is a marker, or `NO_PRIORITY` for no marker.
- Urgent is effective urgent, against the `urgentDueWithinDays` setting.
- Priority alone may repeat in Graphical. Its chips AND: Urgent and Important. A filter holds at most `MARKER_CLAUSES_MAX` (10) conditions.
- The top bar holds one Priority chip. A second typed Priority term is held in its expression.
- For a new task, a one-value `is` seeds that flag and an `is not` clears its flags (`markerConditions`). Several values or `No priority` imply nothing, as Status's. What a filter implies so is a `MarkerConditions` (`{ urgent?, important?, focus? }`, `false` = off), which is never stored.

## Is not

People, Status and Tags filters each have an "is not" switch (`utils/filter-negation`).

- The switches are the filter's `negate` (`FilterNegation`): `true` only, and kept only on a field that filters.
- Without `negate`, every field reads "is".
- A date range's "is not" is in [Rules per date](#rules-per-date), and a Priority condition's in [Priority filters](#priority-filters).

## The "none" choices

- People, Status and Tags filters each have a "none" choice, id `0`: Unassigned, No status, No tags. See [Task writes, people and tags](tasks.md).
- Priority's is `No priority`.
- The optional dates have **None**.
- An expression says them with `no`, and their opposites with `any`.

## What a new task reads from a filter

Three readers take only the top-level `and` terms of an expression that a chip could say:

- **A new task's seeds.** `predicate-expression.topLevelPredicate` gives the filter's own clauses, or an expression's top-level terms as chips.
- **A Prompt for pick.** It takes the place of the filter's top-level terms on its field (`build-list.applyRuntimeFilter`).
- **The People / Tag group restriction** (`build-list.groupRestrictions`; see [Lists](lists.md#people-and-tag-groups)).

A list whose filter is an expression still offers **Add task** (see [Lists](lists.md#add-task)).
