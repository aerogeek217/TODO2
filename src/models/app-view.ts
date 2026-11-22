/**
 * A task date a filter can test: `deadline` → `dueDate`, `planned` →
 * `doDate` (the Planner's planned day), `followup` → `nextFollowupAt`,
 * `lastFollowup` → `lastFollowupAt`, `completed` → `completedAt` (completed
 * tasks only), `created` → `createdAt`, `modified` → `modifiedAt`.
 */
export type DateField = 'deadline' | 'planned' | 'followup' | 'lastFollowup' | 'completed' | 'created' | 'modified'

/**
 * The date types in reading order (Due · Planned · Next follow-up · Last
 * follow-up · Completed · Created · Modified) — the chips' order and the
 * order stored clauses are written in.
 */
export const DATE_FIELD_VALUES: readonly DateField[] = ['deadline', 'planned', 'followup', 'lastFollowup', 'completed', 'created', 'modified']
