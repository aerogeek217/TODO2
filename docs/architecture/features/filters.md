# Filters

One filter model serves lists, Numbers, charts, the check-in, the Review widget's field and the top bar. A filter is a `TodoPredicate` (`models/filter-predicate`): either **Graphical** (chips, ANDed) or a typed **expression** (`TodoPredicate.expression`, `models/filter-expression`). The logic is in `utils/filter-criteria`, `utils/filter-expression` and `utils/predicate-expression`; the pickers and fields are in `components/shared/filters/`.

The top bar's filter is in [The screen filter](screen-filter.md); a list's own is in [Lists](lists.md).

## Date clauses

A filter keys a date clause by one of six dates: Due, Next follow-up, Last follow-up, Completed, Created, Modified. They are the date panel's two rows of three (`DateFilterPanel`).

### Entering a range

The panel's **Show** row picks how a range is entered:

- **Calendar**: each end is a date, with **Set to…** presets.
- **Relative**: each end is typed as an interval from today, in the app's one interval grammar: `+2w`, `-1m`, `+3d`, `today` or a rolling day's words.
  - The end is written once the text reads. When it doesn't, nothing is written and the field shows its hint.
  - It is stored as an offset anchor with a `w` / `m` / `y` `unit` beside `days` (calendar months for `m` / `y`).
  - The field's chevron keeps the rolling days and the open end (**No start** / **No end**).
  - Under the field is its day today (`Thu, Dec 3`).
  - A new range opens in Relative.
- **Any** / **None**, on the optional dates only.

Switching between Calendar and Relative converts the ends. The mode itself is not stored: it is read from the ends.

### Rules per date

- Due, Next follow-up and Last follow-up are the optional dates. They offer **Any** / **None** and "also tasks with no date" (for Last follow-up, "also tasks never followed up").
- A range may be **is not**: the date is outside the range, and a task without the date is kept ("Last follow-up is not 1 week ago – Today"). Completed has no is not.
- Completed is a range only.
- **A Completed range lets completed tasks through as Show completed would** (`filter-criteria.admitsCompleted`). This holds for a range among the chips or as a top-level `and` term of an expression, in a list's filter or in the top bar's chips. The range then keeps only the tasks completed in it.

## Graphical or an expression

A filter is one or the other:

- **Graphical**: its chips, ANDed, one per field. Priority alone may repeat (see [Priority filters](#priority-filters)).
- **An expression**: typed text, stored as `TodoPredicate.expression`. The chips' clauses are then empty.

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

- `markers` is a list of conditions (`MarkerClause`), a chip each (`FilterChip.markerIndex`, as a date chip has its `dateField`).
- Priority alone may repeat in Graphical. Its chips AND: Urgent and Important.
- The top bar holds one Priority chip. A second typed Priority term is held in its expression.
- For a new task, a one-value `is` seeds that flag and an `is not` clears its flags (`markerConditions`). Several values or `No priority` imply nothing, as Status's.

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
