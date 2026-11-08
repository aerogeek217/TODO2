import type { TaskDialogPayload } from '../../../stores/task-dialog-payload'

/**
 * The tasks a glance widget's number stands for — what clicking it opens in the
 * task dialog: the counted tasks, by id in dialog order or under headings.
 */
export type GlanceDrill = TaskDialogPayload

/** Opens the tasks behind a number; absent = numbers aren't clickable. */
export type OnGlanceDrill = (drill: GlanceDrill) => void
