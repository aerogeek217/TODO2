import type { DataRow, DataSet } from '../../schema-upgrades'

/**
 * v84 — a repeat is any interval (typed intervals, 2026-11-19): every
 * `todos` row's `recurrenceRule` `{ type, originalDayOfMonth? }` becomes
 * `{ every: { count, unit }, originalDayOfMonth? }` (`models/recurrence`) —
 * daily 1d, weekly 1w, biweekly 2w, monthly 1m, quarterly 3m, yearly 1y. The
 * kept day of the month stays as it was (a month or year interval reads it,
 * so a repeat never drifts); a day or week rule never had one.
 *
 * Nothing else on the task moves — its `modifiedAt` neither: a conversion
 * is not an edit. A rule with a type this build never wrote is left as it is,
 * for validation to refuse (a hand-made file).
 *
 * Follows the transform contract (`schema-upgrades`): pure, idempotent (a
 * rule already `{ every }` is left as it is), tolerant of missing tables and
 * malformed rows; a table it leaves alone comes back as the same array.
 */

/** The six fixed repeats before v84, each as its interval. */
const EVERY: Readonly<Record<string, { count: number; unit: 'd' | 'w' | 'm' | 'y' }>> = {
  daily: { count: 1, unit: 'd' },
  weekly: { count: 1, unit: 'w' },
  biweekly: { count: 2, unit: 'w' },
  monthly: { count: 1, unit: 'm' },
  quarterly: { count: 3, unit: 'm' },
  yearly: { count: 1, unit: 'y' },
}

function isRecord(v: unknown): v is DataRow {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** The rule's interval when it is an old typed rule this step converts, else null. */
function everyOf(rule: unknown): { count: number; unit: 'd' | 'w' | 'm' | 'y' } | null {
  if (!isRecord(rule) || 'every' in rule || typeof rule.type !== 'string') return null
  return Object.hasOwn(EVERY, rule.type) ? EVERY[rule.type] ?? null : null
}

export function upgradeV84(data: DataSet): DataSet {
  const todos = data.todos
  if (!todos || !todos.some((row) => isRecord(row) && everyOf(row.recurrenceRule) != null)) return data
  return {
    ...data,
    todos: todos.map((row) => {
      if (!isRecord(row)) return row
      const every = everyOf(row.recurrenceRule)
      if (every == null || !isRecord(row.recurrenceRule)) return row
      const { type: _type, ...rest } = row.recurrenceRule
      void _type
      return { ...row, recurrenceRule: { ...rest, every: { ...every } } }
    }),
  }
}
