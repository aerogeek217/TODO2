# Check-ins

A check-in is a message listing one person's open tasks, with a box per task for their update. It is copied, never sent, and the reply comes back by paste. The message is built in `services/checkin-email`, a reply is read in `services/checkin-reply`, and the two dialogs are in `components/checkin` (`CheckinDialog`, `CheckinImportDialog`).

## The message

`services/checkin-email` builds each person's message from their open tasks under the saved check-in filter:

- A subject: `Task check-in: 3 open tasks`.
- A body with a `Ref` per task.
- Each task's box: Completed, Status (its newest status update, `(MM/DD) text`) and Notes.
- The footer line `Check-in for <name> · sent <date>`, which the reply import reads.

## The check-in dialog

The Review widget's **Check-in** button opens the check-in dialog (`CheckinDialog`, `ui-store.openCheckinDialog(personIds)`) for the people its filter names. The button shows while that filter names only people, on desktop (see [Review](review.md)).

On the left:

- The people, as a single-select list (↑ / ↓): every person with open tasks plus the ones the dialog was opened for. Those come first, and the first of them is selected.
- Each person shows their count, and `Copied ✓` once copied.
- **Which tasks**: the saved check-in filter, written at once.
- **Include**: task notes, other people (dialog state).

On the right:

- The selected person's subject with **Copy subject**.
- The message in a sandboxed `srcdoc` frame.
- **Copy**, which puts the body on the clipboard as rich HTML + plain text (`person-checkin.copyCheckinMessage`).

In a window 760px wide or narrower the dialog is one column.

## Rules

- Nothing is sent and **copying records nothing**: no follow-up, no undo entry.
- Nothing about mail is stored: a person has no email.
- Check-in and Paste reply live **only on the Review widget's field**. The check-in dialog's footer also has **Paste a reply…**, which opens the reply import.

## The reply

A reply comes back by paste, in the import dialog (`CheckinImportDialog`), which reads the person from the reply. `checkin-reply` parses it, diffs it against the tasks, and applies the ticked changes as one undo group:

- A changed Status, read without its `(MM/DD)`, adds a [status update](status-updates-and-subtasks.md) dated today.
- A reply never removes a status update.
- **Record a follow-up**, on by default, is where a check-in round records its follow-up.
