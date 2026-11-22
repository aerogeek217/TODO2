# The screen filter

The screen filter is the top bar's chips and the expression typed beside them (`FilterCriteria.expression`, ANDed with the chips). There is one for every layout, and it is never saved. It is held in `filter-store`, and every widget reads it through `stores/screen-filter`. The top bar's parts are in `components/layout/` and `components/shared/filters/`.

The filter model and the expression grammar it shares with lists are in [Filters](filters.md).

## Where it applies

Wherever it applies, a task must pass it: lists, the glance widgets, the Neglect map, the calendar, the filtered-tasks panel and its counts.

- The tray turns red while a filter applies.
- Clear all clears the chips and the expression. It is the field's × at its right end, or the Filter menu's last item.
- The screen-filter hooks hand the widgets the filter deferred (`useDeferredValue`). So a clear, pause or resume paints the top bar in the click's frame, and the widgets follow.

## Pausing it

**The funnel pauses it** (`filter-store.paused`, in memory only).

- The chips, the expression, the text and Show completed stay, but nothing applies them. `stores/screen-filter` (its hooks and `currentScreenFilter`) gives no filter. So every list, glance widget, the calendar, the Neglect map, the counts and the filtered-tasks panel show every task.
- The tray loses its red. The pills dim and are struck through. The counter reads `109 open · paused`; the phone's pill does too, and a tap on it resumes the filter.
- A click on the funnel again resumes it.
- So does any edit of the filter: typing it, a pill's ×, a Filter menu pick. Every write goes through `commit`.
- Clear all and a reload end the pause.
- The palette's **Pause / Resume Filter** and the editable `pause-filter` shortcut (no keys by default) toggle it.

## The Filter button

The chips are set from the top bar's one **Filter** button and from the field.

- Its menu lists Priority, Tags, People, Dates and Status. Each opens its picker beside the menu.
- Then come Completed and, while any filter is on, Clear all filters.
- `F` opens the menu.
- The button's name counts what is on.

## The typed filter

The field is `components/layout/TopBarFilterField`, with the placeholder `@person #tag due fri`.

### What it reads

- The list Expression grammar (see [Filters](filters.md#expression-grammar)).
- The search box's forms (`parseExpression`'s `searchForms`):
  - Terms side by side are an `and`. But side-by-side names of one kind, or priorities, are an `or`: `@a @b #q4` is `(@a or @b) and #q4`.
  - `completed` alone is `done`.
  - `/due ⟨day⟩` and `/followup ⟨day | none⟩`.
- The text is tinted as typed, with the `@ # ! /` popup (`useExpressionField`, its input a one-line box).

### Applying it

- A text that reads is applied once typing rests, on ⏎ and on blur (`filter-store.applyExpression`).
  - Each top-level `and` term a chip can say becomes that chip (`splitTopLevel`): one per field, one Priority chip. The pickers then show it.
  - The other terms are held as the screen filter's `expression`.
- A text that doesn't read is never applied. Its error shows under the field (not while the popup shows), and the tasks keep the last filter that read.
- Esc puts the filter's text back. With nothing to put back, Esc leaves the field; over the filtered-tasks panel, the panel takes it.

### At rest

- **At rest** each term is a pill with its own × (`shared/filters/ExpressionPills`, the Review widget field's too: `printPieces`, `withoutAtom`). Joining words and brackets are muted between the pills.
- Too long, the pills fade at the field's end with `+N more` (the top-level terms not shown), and the tooltip holds the whole filter.
- A press anywhere else in the field shows the whole filter as text. The chips are printed as their terms, in the order typed while the filter is still as the field wrote it (`filter-store.fieldFilter`). What is written there is split again.
- The text search's words list their matches under the field (`TopBarSearchResults`) while the popup is closed.

## The phone

- The phone keeps its chip sheet and its own field (`services/search-tokens` → `filter-store.applySearchTokens`). Each token becomes a chip as it completes. Backspace in the empty box takes the last one back.
- A typed expression shows there read-only, in words, with a × that clears it (`shared/filters/ScreenExpression`).

## The counter

- The counter `61 of 109` says what the chips keep of every open task.
- While the chips let completed tasks through, it also counts the completed ones they admit. Show completed admits every one; a chips' Completed range admits the ones in it. So `of N` never grows with the whole history.
- The counter, and the phone's pill, carry a list tab's badge over the tasks the screen filter shows, in the app's ranges (see [Lists](lists.md#tab-badges)).
