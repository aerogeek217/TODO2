# Review

A review steps through a queue of open tasks one card at a time. It always happens in a **Review widget** (kind `review`, `components/workspace/review/ReviewWidget`): one on the open layout, or the popup review. Every Review button jumps there with a filter (`services/review-jump`, `services/review`). The rail, card and footer live in `components/review`; the card's body is the task layout the task editor shares (`task/TaskDetailsBody`).

## Jumping to a review

Every Review button calls `services/review-jump.jumpToReview` with a filter.

**A Review widget on the open layout**, its first in reading order (`reviewWidgetTarget` in `services/review-widget`):

- Its filter is set (`services/review-widget.setReviewWidgetFilter`). The filter is temporary, kept in `list-widget-store.reviewFilters`.
- Its tab is shown (`services/workspace-tabs.showTab`): it becomes its cell's active tab and its rows expand.
- The focus moves into it: the card's update line, else its field.
- An open editor with changes asks Save / Discard / Keep editing first, but only when showing the widget would hide another tab of its cell or close the widget popup. Keep editing cancels the jump. See [Popovers and editors](popovers-and-editors.md).
- The widget popup closes unless it shows that very widget.

**Otherwise the popup review**: a Review widget in the widget popup ([Open larger](widget-chrome.md)) tied to no layout tab (`REVIEW_POPUP_TAB_ID`, `services/widget-popup.openReviewPopup`), opened with that filter.

- Another layout is never switched to.
- An editor with changes asks first, as the popup asks.

Either way:

- The task dialog and the filtered-tasks panel close.
- A jump replaces whatever the widget was reviewing, without asking. A different filter starts the review over (the first card, no marks). The same filter sent again resumes where it stood.
- A jump **saves nothing** of the review: no layout edit, no undo step. Showing the tab changes only view state (the cell's active tab, its expanded rows).

## What each Review button sends

**The buttons always show**, the phone's too. Only a dialog the task dialog can't show above leaves them out (`useEntityMenuOffers`). Each sends a filter built as a tree of ids, never as text (`services/review`).

- **A list tab**: its ⋯ menu › **Review these N tasks**, the editable `R` shortcut and the palette's **Review List**. They send the list's whole filter as it shows:
  - its chips or expression as one expression (`wholeExpression`);
  - its prompt pick taking that field's place, as the list applies it (`applyRuntimeFilter`);
  - a list that narrows by nothing sends an `and` of nothing: every open task;
  - its manual order and group dividers don't carry over;
  - N is the open tasks it shows.
- **A person or a tag**: the right-click menu's **Review with X** / **Review #tag tasks**, the person task dialog's **Review** and the palette's **Review With ›**. They send `@X` / `#tag`.
- **The top bar's People filter** sends `@A or @B`.
- **A Breakdown row's Review icon** sends the Breakdown's own filter AND the row (`breakdownRowTerm`):
  - a person, tag or status;
  - a people or tags row under picks on both the Breakdown and the top bar also gets `not` the ones every pick names, so the review keeps what the row counts;
  - a priority group as the Priority sort's exclusive groups (`/urgent and /important and not /focus`, …);
  - a due or age bucket as a day-offset range of the due or created date;
  - the none row: Unassigned / No tags / No status / No priority / No due date.
- **A Breakdown count column's count** sends the same, AND that column's filter.
- **The filtered-tasks panel's Review these N tasks** sends the top bar's chips and its text search as one expression.

Two Breakdown cases open the task dialog instead of a review:

- A row no filter says. Every split's rows are expressible.
- Every row and count of a Breakdown whose filter lets completed tasks through (Show completed, a Completed range), since a review takes open tasks only (`breakdownReviews`).

See [Glance widgets](glance-widgets.md), [Lists](lists.md) and [Screen filter](screen-filter.md).

## The review's parts

The parts (`components/review`) are shared by the widget's faces.

### The rail

The rail (`ReviewRail`) lists the queue. It is 300px wide, giving way to 220px in a small cell.

**Under 820px wide it folds away** (`utils/widget-face.reviewQueueFolds`). A **Queue** button before the widget's progress then opens it as a popover (`ReviewQueueButton`: the rail with its sort). A pick or Esc closes the popover.

### The sort

The rail has a sort at its top: `Sort: Priority ▾` by default. The choices are **Queue order**, **Due**, **Next follow-up**, **Last follow-up**, **Priority** and **Title** (`services/review-queue.reviewOrder`: the keys a list sorts by, ties in queue order).

- The order is taken when the sort is picked. It doesn't move while the review edits tasks.
- A task that joins a live queue takes its sorted place among the rest, which stay where they are (`review-queue.joinOrder`).
- Back / Skip step in this order.
- Picking a sort keeps the current card.
- ← / → on a row are Back / Skip.

### Rows

Each row is **two lines**:

- First the mark, the box with the priority ring, and the whole title.
- Under the title, the next follow-up after a small flag and the due date after a small clock, in words and the rows' colors.
- The current row has the accent's tint and a 2px accent edge.

The box is **a checkbox**:

- It sits beside the row's button, never inside it, and is a tab stop after its row.
- It completes or reopens the task where it is, with the store's undo, without picking the row.
- A completed task leaves the live queue. The current one stays, checked, until the review moves on.
- The focus goes to the checkbox of the row that takes its place.

### Marks

- **✓ on every task followed up today**: its last follow-up is today, in this review or anywhere else. An undo takes it away. Its title is dimmed.
- **–** on a task skipped here and not followed up today.

## The task layout

The review card and the task editor share one layout (`task/TaskDetailsBody`): the **fact band**, then **two columns**. Each host puts its own title row above it and its own footer below it.

### The fact band

Labeled cells in one row on a slightly darker ground, with thin dividers between them, wrapping when narrow.

- Each cell's width is set by the band's width, never by its value. A change to one fact moves no other cell, and the band wraps by its width alone.
- The 920px editor holds all five cells on one line. People's and Tags' pills wrap inside their cells.
- Each fact sits under the standard section label: 11px bold caps, muted, no color and no icon.

The cells, in order:

- **Priority**: Focus · Urgent · Important.
- **Status**.
- **People** and **Tags**: each value a pill with its own ×, then a dashed round **+**, always shown, that opens the picker.
- **Due**: its date with the repeat under it. The repeat's lines are kept without a date.

The repeat is typed (`task/RepeatField`): `Repeat every [2w]`, read back as `Every 2 weeks · next Mon, Dec 7`.

- ⏎ or a blur writes it, one undo step.
- Esc puts it back.
- A text that doesn't read says how and isn't written.

### The two columns

On the left, Subtasks, then Notes:

- Notes is always a box: one line with its placeholder while empty, growing with its text to 300px, and never taking the card's spare room.
- Its toolbar is on the NOTES line, shown while Notes has the focus.
- Notes are flushed before any other write.

On the right, [Status updates](status-updates-and-subtasks.md), oldest first and anchored to the bottom. In a review the update line comes last.

### The review card

The card (`ReviewCard`) has the queue on its left. Every edit on it is made in place, each its own undo step, on one task only (never the selection).

Its title row:

- The box and the title. The title is a field edited in place as the editor's (`ReviewTitleField`): ⏎ or a blur writes it, one undo step, never blank; Esc puts it back. It wraps and grows; on the medium face it is one line.
- `Created … · Modified …`, gone while the card is under 560px wide.
- A ⋯ with the editor header's actions: **Open in editor**, **Duplicate** (the copy opens in the editor), **Make subtask of…**, **Plan for day ›** ([Planner](planner.md)) and **Delete**. A task that goes leaves the live queue, and the review moves on.

Its **footer**:

- ‹ **Back** and **Skip** › are at its left end. They write nothing.
- At its right are the follow-up fields, then **Mark followed up ›**.
- **Last** is a field: a date, never in the future. ⏎ / Tab / blur write it after the notes, as its own undo step. ⏎ hands the focus back to the update line. Esc reverts.
- **Next** comes with the quick intervals. Its × clears it; there is no None.
- **Mark followed up ›** is also ⏎ in the update line. Its tooltip says what it will do, and the field it reads is right beside it. It follows the follow-up popover's rules (the typed update and the follow-up as one undo step), then the next card opens.
- In the DOM the fields and Mark followed up come before Back and Skip. So from the update line, Tab reaches Last, then (after Last's calendar) Next.
- As the footer narrows, the quick intervals go first, then the fields' relative words, then the labels.

Typed update and Next-date drafts are kept per task in the widget's session. A new filter keeps them; a data replace clears them.

### The task editor

**The task editor** (`TaskEditPopup`, 920px wide) has the same band and columns.

- Its header holds the box, the title, the muted `Created … · Modified …`, ⋯ and ×.
- Its footer is `Last · Next [quick] · Mark followed up · Done`.
- In create mode the footer is `Last · Next [quick] · Cancel · Create task`. A draft has no Last.
- It is **as tall as its content**: the taller column sets its height, so few updates make a short popup. It grows up to 82% of the window, then the columns scroll inside.
- On a phone it is one column and the footer wraps, the fields on their own line.

### The Mark followed up button

There is one **Mark followed up** button (`shared/followup/MarkFollowedUpButton`): follow-up yellow, the flag-check icon, never a changed label. It is the editor footer's (after the follow-up fields, before Done; edit mode only), the follow-up popover's and the review footer's.

## The Review widget

The Review widget (kind `review`, under Tasks after Calendar; `components/workspace/review/ReviewWidget`) is the review in a cell: its rail, card, footer and stepping (`components/review`), over a review session of its own (`stores/review-session.reviewWidgetSession`).

**No settings**: its config is empty (`ReviewTabConfig`), with no kind of review to choose.

### The filter field

What it reviews is **a filter typed into its field** (`ReviewFilterField`).

- It takes what a list's Expression filter takes (`@person`, `#tag`, `!status`, `/urgent`, date words, `and` / `or` / `not`, parentheses) except `done` and Completed dates. A review takes open tasks only: the field refuses them, saying so. See [Filters](filters.md).
- The text is tinted as typed (`hooks/use-expression-field`).
- The filter is **temporary**: kept by tab id in memory (`list-widget-store.reviewFilters`) as the last text that read, as an expression. It is never layout config, never view state, and gone with a reload.
- A text that doesn't read shows the expression field's error under the field and is never written. The queue keeps the last filter that read.
- Esc puts its text back. With nothing to put back, Esc leaves the field.
- A × clears it. A filter that narrows by nothing (a jump from such a list) reads `Every open task` there, with the ×.

### The list and picks

- A click on the field lists people, tags and statuses under their headings, each with its open tasks under the widget's screen filter, the most counted first. So do a focus while it is empty and the empty state's **Pick**.
- Bare letters where a term may go match all three at once (no `@` first). ⏎ takes the first.
- `@ # ! /` still open the expression popup.
- The list comes from `services/review-field.reviewFieldAutocomplete` and is drawn by the shared `NlpPopup` with its `mixed` marks, counts and section headings.

A pick writes the name's token (`@"Marcus Chen"`, quoted as the printer quotes it).

- After a whole term it joins the filter as chips combine: the names of one sort `or` together, the sorts `and`. Aisha, Ben, then q4 is `(@Aisha or @Ben) and #q4` (`reviewFieldPick` → `withPick`). It is text, so the words can be changed.
- After an operator or a parenthesis it goes in as it is.

### Pills at rest

**At rest** (the field not focused, its text the filter's) each term is a pill with its own × (`filter-expression.printPieces`: the printed text in pieces, the joining words muted between the pills).

- A press on a pill's × takes that term out of the filter, written at once (`withoutAtom`: the term goes with a `not` over it, and a group left with one term loses its parentheses).
- The `done` pill's × turns Show completed off.
- A press anywhere else goes to the text field under the pills, which shows as typed text again.

### Check-in and Paste reply

Two buttons sit at the field's end while the filter names only people (`@A`, `@A or @B`; `peopleOnly`), and only on desktop:

- **Check-in** opens the [check-in dialog](check-ins.md) for those people, the first selected.
- **Paste reply** opens the reply import (`openCheckinImport`), which reads the person from the reply.

### Top line and progress

- Alone in its cell, its top line reads `Review`, then `2 followed up` (with a filter) and the cell's ⋯. The field's row is under it.
- At the large face the progress reads `All 12 reviewed · 2 followed up` once every task has a mark.
- In a cell of several widgets, and in the widget popup, there is no top line. The field's row is its first row and ends with the progress.
- `N followed up` also counts the tasks followed up in this review that left the queue since.

### The live queue

Its queue is **live** (`hooks/use-review-widget-queue`): the open tasks the filter keeps under the screen filter, in `sortOrder`.

- A task leaving the filter leaves the rail.
- The current one stays until the review moves on (`review-queue.keepPlace`).
- **A double-click on a row of the rail beside the card opens the task in its editor.** A single click shows its card.

### Where it stands

Where it stands (the current task, the – marks) is never saved.

- It lasts as long as the filter (the tab's session, `filterKey`): a different filter starts a new review, the same one again resumes.
- It is cleared with the filter, and with every review's typed text on a data replace.

Only the rail's sort is view state, saved at once: **Priority** where the tab stores none (`DEFAULT_REVIEW_WIDGET_SORT`). The layout repair checks the stored sort (`data/layout-shape`, see [Models and data](../models-and-data.md)). The popup review has no layout tab, so its sort is kept in memory (`ui-store.popupReviewView`).

### Faces

`utils/widget-face.reviewFaceFor` picks the face ([Widget chrome](widget-chrome.md) covers faces in general).

| Face | When |
|------|------|
| Small | As every widget's |
| Medium | The body is at most 640px wide (the card's two columns) or at most 320px tall |
| Large | Otherwise, also in a short cell |

**Large**: the rail beside the card (`ReviewCard`), the footer under both. The card fills its cell and its columns scroll inside.

- The queue narrows and folds as [The rail](#the-rail) says.
- In a short cell both panes scroll. The queue scrolls under its sort.
- While the card is under 390px tall, too short for its columns to scroll inside, its band and columns scroll as one under its title. Each column is then as tall as it is, its log held to four entries (`Review.module.css`, the `review-card` size container).

**Medium**: `ReviewCompactCard`.

- The title.
- A one-line facts summary. Last is there; it is edited through Open card ↗.
- The updates dock: the Status updates heading, the latest two entries, the update line (⏎ follows up) and the Next row (the field and the quick intervals, which give way in a narrow card).
- The footer with **Open card ↗** (the editor).

**Small**: `Review · <filter>` (`Review · Pick who or what` with none) and `N left · M followed up`. A click opens the whole widget in the widget popup, where its field is usable.

**No filter**: `Pick who or what to review`, `Click the field, or type @person, #tag, !status or any filter. It is temporary and isn’t saved.` and a **Pick** button that focuses the field.

### Writes, focus and the phone

- Every write is the card's (`useReviewFollowUp`, the card's fields), each its own undo step.
- A card opening takes the focus only while the user is working in the widget, never from the field's row (the filter is typed there).
- On a phone it shows its medium face, as the popup review does. A phone's Review buttons open the popup review unless the open layout has a Review widget.
