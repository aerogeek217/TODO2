/**
 * A task date a filter can test: `deadline` → `dueDate`, `followup` →
 * `nextFollowupAt`, `lastFollowup` → `lastFollowupAt`, `completed` →
 * `completedAt` (completed tasks only), `created` → `createdAt`, `modified`
 * → `modifiedAt`.
 */
export type DateField = 'deadline' | 'followup' | 'lastFollowup' | 'completed' | 'created' | 'modified'

/**
 * The date types in reading order (D22 board B: Due · Next follow-up · Last
 * follow-up / Completed · Created · Modified) — the date panel's tab order,
 * the chips' order and the order stored clauses are written in.
 */
export const DATE_FIELD_VALUES: readonly DateField[] = ['deadline', 'followup', 'lastFollowup', 'completed', 'created', 'modified']
