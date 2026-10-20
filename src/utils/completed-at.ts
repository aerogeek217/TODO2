import type { TodoItem } from '../models'

type CompletionFields = Pick<TodoItem, 'isCompleted' | 'completedAt'>

/**
 * The `completedAt` a todo should carry after a write. Shared by
 * `todoRepository` (persisted value) and `useTodoStore` (optimistic state) so
 * both converge:
 *
 * - not completed → `undefined` (reopen clears it);
 * - completed and `next.completedAt` given → that value (undo restoring a
 *   snapshot keeps the original completion time);
 * - completed and already completed before → the prior value (re-saving a
 *   completed task doesn't move its clock);
 * - newly completed → `now`.
 */
export function resolveCompletedAt(
  prior: CompletionFields | undefined,
  next: CompletionFields,
  now: Date,
): Date | undefined {
  if (!next.isCompleted) return undefined
  if (next.completedAt != null) return next.completedAt
  if (prior?.isCompleted && prior.completedAt != null) return prior.completedAt
  return now
}

/**
 * Whether a completed todo is past the retention cutoff. Keys on
 * `completedAt`; `modifiedAt` is only a fallback for a completed row that
 * somehow lacks it (the v51 upgrade backfills every completed task).
 */
export function isExpiredCompleted(
  todo: Pick<TodoItem, 'isCompleted' | 'completedAt' | 'modifiedAt'>,
  cutoff: Date,
): boolean {
  if (!todo.isCompleted) return false
  const ms = new Date(todo.completedAt ?? todo.modifiedAt).getTime()
  return Number.isFinite(ms) && ms < cutoff.getTime()
}

/** `now` minus `days` calendar days (local time), the retention cutoff. */
export function retentionCutoff(days: number, now: Date = new Date()): Date {
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - days)
  return cutoff
}

/**
 * The completed todos past `retentionDays` — what the launch prompt
 * and Settings cleanup offer to delete. Order is preserved.
 */
export function selectExpiredCompleted<T extends Pick<TodoItem, 'isCompleted' | 'completedAt' | 'modifiedAt'>>(
  todos: readonly T[],
  retentionDays: number,
  now: Date = new Date(),
): T[] {
  const cutoff = retentionCutoff(retentionDays, now)
  return todos.filter((t) => isExpiredCompleted(t, cutoff))
}

/** The fewest days between two launch prompts about deleting old completed tasks, by default. */
export const DEFAULT_PURGE_PROMPT_INTERVAL_DAYS = 7

/** The longest wait between two launch prompts the setting takes, in days. */
export const PURGE_PROMPT_INTERVAL_MAX_DAYS = 365

/** Whether `n` is a prompt interval the setting takes: a whole number of days, 1–365. */
export function isPurgePromptIntervalDays(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= PURGE_PROMPT_INTERVAL_MAX_DAYS
}

/** The stored prompt interval (a whole number 1–365, as text); `undefined` when it isn't one. */
export function parsePurgePromptIntervalDays(value: string): number | undefined {
  if (!/^[1-9]\d{0,2}$/.test(value)) return undefined
  const n = Number(value)
  return isPurgePromptIntervalDays(n) ? n : undefined
}
