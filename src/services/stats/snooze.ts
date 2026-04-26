import type { TodoEvent, PersistedTodoItem } from '../../models'

export interface SnoozedTask {
  todo: PersistedTodoItem
  /** Count of future-shift `scheduled` events (`toValue > fromValue`). */
  count: number
  /**
   * The earliest scheduled `toValue` (in event-timestamp order) — i.e. the
   * date the user first scheduled this task for. `null` when the first
   * scheduled event has no resolvable `toValue` (fuzzy / unset).
   */
  oldestScheduled: Date | null
}

export interface MostDeferredInput {
  events: readonly TodoEvent[]
  todos: readonly PersistedTodoItem[]
  limit?: number
}

const DEFAULT_LIMIT = 5

/**
 * Top N most-rescheduled open todos. Counts only `scheduled` events whose
 * `toValue > fromValue` (a future-shift = a snooze); same-day or earlier
 * shifts don't count. Joins the resulting `todoId` set against `todos`,
 * dropping any closed (completed) row, and sorts by count desc with id as a
 * stable tiebreaker. `oldestScheduled` carries the first scheduled event's
 * `toValue` so the UI can render a "since {date}" label.
 *
 * Fuzzy `toValue` (`'fuzzy:<token>'`) doesn't compare meaningfully against an
 * ISO `fromValue` — those events are skipped from the snooze count. The first
 * fuzzy event still seeds `oldestScheduled = null` (caller renders without
 * the "since" label).
 */
export function selectMostDeferred(input: MostDeferredInput): SnoozedTask[] {
  const { events, todos } = input
  const limit = input.limit ?? DEFAULT_LIMIT

  const todoById = new Map<number, PersistedTodoItem>()
  for (const t of todos) {
    if (t.id != null && !t.isCompleted) todoById.set(t.id, t)
  }

  const snoozeCount = new Map<number, number>()
  const firstScheduled = new Map<number, TodoEvent>()

  for (const e of events) {
    if (e.type !== 'scheduled') continue
    if (!todoById.has(e.todoId)) continue

    const prev = firstScheduled.get(e.todoId)
    if (!prev || e.timestamp < prev.timestamp) firstScheduled.set(e.todoId, e)

    if (isFutureShift(e.fromValue, e.toValue)) {
      snoozeCount.set(e.todoId, (snoozeCount.get(e.todoId) ?? 0) + 1)
    }
  }

  const ranked: SnoozedTask[] = []
  for (const [todoId, count] of snoozeCount) {
    if (count <= 0) continue
    const todo = todoById.get(todoId)
    if (!todo) continue
    const fse = firstScheduled.get(todoId)
    ranked.push({
      todo,
      count,
      oldestScheduled: fse ? parseToValueDate(fse.toValue) : null,
    })
  }

  ranked.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return a.todo.id - b.todo.id
  })

  return ranked.slice(0, limit)
}

function isFutureShift(
  from: TodoEvent['fromValue'],
  to: TodoEvent['toValue'],
): boolean {
  if (typeof from !== 'string' || typeof to !== 'string') return false
  if (from.startsWith('fuzzy:') || to.startsWith('fuzzy:')) return false
  return to > from
}

function parseToValueDate(v: TodoEvent['toValue']): Date | null {
  if (typeof v !== 'string') return null
  if (v.startsWith('fuzzy:')) return null
  const t = Date.parse(v)
  return isNaN(t) ? null : new Date(t)
}
