/**
 * Email check-in settings: how a check-in email is handed to the mail app,
 * and which of a person's open tasks it covers. Both are remembered in the
 * `settings` table (`checkinOpenMethod`, `checkinTaskScope`).
 */

/**
 * `mailto`: open a `mailto:` link (To + Subject) and put the body on the
 * clipboard to paste. `eml`: download an unsent `.eml` draft.
 */
export type CheckinOpenMethod = 'mailto' | 'eml'

export const CHECKIN_OPEN_METHODS: readonly CheckinOpenMethod[] = ['mailto', 'eml']

export const DEFAULT_CHECKIN_OPEN_METHOD: CheckinOpenMethod = 'mailto'

export function isCheckinOpenMethod(value: unknown): value is CheckinOpenMethod {
  return (CHECKIN_OPEN_METHODS as readonly unknown[]).includes(value)
}

/**
 * Which open tasks of a person a check-in covers: all of them, overdue plus
 * the next two weeks, the hot ones, or the ones a saved list shows.
 */
export type CheckinTaskScope =
  | { kind: 'all' }
  | { kind: 'due-soon' }
  | { kind: 'hot' }
  | { kind: 'list'; listDefinitionId: number }

export const DEFAULT_CHECKIN_TASK_SCOPE: CheckinTaskScope = { kind: 'all' }

const LIST_PREFIX = 'list:'

/** Stored form: `all`, `due-soon`, `hot` or `list:<id>`. */
export function formatCheckinTaskScope(scope: CheckinTaskScope): string {
  return scope.kind === 'list' ? `${LIST_PREFIX}${scope.listDefinitionId}` : scope.kind
}

/** Reads the stored form; `undefined` when it isn't one. */
export function parseCheckinTaskScope(value: string): CheckinTaskScope | undefined {
  if (value === 'all' || value === 'due-soon' || value === 'hot') return { kind: value }
  if (!value.startsWith(LIST_PREFIX)) return undefined
  const digits = value.slice(LIST_PREFIX.length)
  if (!/^[1-9]\d{0,14}$/.test(digits)) return undefined
  return { kind: 'list', listDefinitionId: Number(digits) }
}

export function checkinTaskScopeEqual(a: CheckinTaskScope, b: CheckinTaskScope): boolean {
  return formatCheckinTaskScope(a) === formatCheckinTaskScope(b)
}

/**
 * The scope to use: a saved list that no longer exists falls back to all open
 * tasks. `listDefinitionIds` = the ids of the lists that exist now.
 */
export function resolveCheckinTaskScope(
  scope: CheckinTaskScope,
  listDefinitionIds: Iterable<number>,
): CheckinTaskScope {
  if (scope.kind !== 'list') return scope
  for (const id of listDefinitionIds) {
    if (id === scope.listDefinitionId) return scope
  }
  return DEFAULT_CHECKIN_TASK_SCOPE
}
