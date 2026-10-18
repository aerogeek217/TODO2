import type { PersistedTodoItem } from '../models'

/**
 * Manual list order: pure rank math over a list's ranks (todo id → rank,
 * see `models/list-order.ts`). Ranked tasks come first by rank; unranked
 * tasks follow, oldest first. A move writes the moved task's rank only,
 * unless a neighbour has no rank yet (the unranked tail is ranked first, in
 * the order it was shown) or there is no room left between two ranks (the
 * whole list is re-spaced).
 */

/** A task's rank in a list, to write. */
export interface RankWrite {
  todoId: number
  rank: number
}

/** Ranks of one list: todo id → rank. */
export type ListRanks = ReadonlyMap<number, number>

/** Gap between neighbouring ranks when ranks are assigned in a row. */
export const RANK_STEP = 1

function createdMs(t: PersistedTodoItem): number {
  const ms = t.createdAt instanceof Date ? t.createdAt.getTime() : new Date(t.createdAt).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/**
 * Manual-order comparator: ranked tasks by rank (ties by id), then unranked
 * tasks by `createdAt` (ties by id) — so a task that newly matches a list
 * shows at the bottom.
 */
export function manualOrderComparator(ranks: ListRanks): (a: PersistedTodoItem, b: PersistedTodoItem) => number {
  return (a, b) => {
    const ra = ranks.get(a.id)
    const rb = ranks.get(b.id)
    if (ra != null && rb != null) return ra - rb || a.id - b.id
    if (ra != null) return -1
    if (rb != null) return 1
    return createdMs(a) - createdMs(b) || a.id - b.id
  }
}

/**
 * Where a task lands: right after `prevId` / right before `nextId` (its new
 * neighbours in the group it was dropped in; `null` at either end).
 */
export interface MoveTarget {
  todoId: number
  prevId: number | null
  nextId: number | null
}

/** A rank strictly between `prev` and `next`, or `null` when there is no room. */
export function rankBetween(prev: number | undefined, next: number | undefined): number | null {
  if (prev == null && next == null) return 0
  if (prev == null) return (next as number) - RANK_STEP
  if (next == null) return prev + RANK_STEP
  const mid = prev + (next - prev) / 2
  return mid > prev && mid < next ? mid : null
}

/** `order` with `move.todoId` taken out and put back after `prevId` (else before `nextId`). */
export function placeInOrder(order: readonly number[], move: MoveTarget): number[] {
  const rest = order.filter((id) => id !== move.todoId)
  let at = rest.length
  if (move.prevId != null && rest.includes(move.prevId)) at = rest.indexOf(move.prevId) + 1
  else if (move.nextId != null && rest.includes(move.nextId)) at = rest.indexOf(move.nextId)
  else if (move.prevId == null && move.nextId == null) at = order.indexOf(move.todoId) === -1 ? rest.length : order.indexOf(move.todoId)
  rest.splice(at, 0, move.todoId)
  return rest
}

/** Ranks `RANK_STEP, 2·RANK_STEP, …` in `order`. */
export function ranksInOrder(order: readonly number[]): RankWrite[] {
  return order.map((todoId, i) => ({ todoId, rank: (i + 1) * RANK_STEP }))
}

/**
 * The rank writes for a move in a manual list.
 *
 * `order` is every task the list can show, in its current manual order
 * (`manualOrderComparator`), including the moved one. Writes only the moved
 * task's rank when its new neighbours are ranked and there is room between
 * them; ranks the unranked tail first (keeping its order) when a neighbour
 * is unranked; re-spaces the whole list when there is no room.
 */
export function planMove(order: readonly number[], ranks: ListRanks, move: MoveTarget): RankWrite[] {
  const effective = new Map(ranks)
  const writes = new Map<number, number>()
  const needsTail = (id: number | null) => id != null && !effective.has(id)
  if (needsTail(move.prevId) || needsTail(move.nextId)) {
    let max = 0
    for (const r of effective.values()) max = Math.max(max, r)
    const tail = order.filter((id) => !effective.has(id))
    for (const extra of [move.prevId, move.nextId]) {
      if (extra != null && !effective.has(extra) && !tail.includes(extra)) tail.push(extra)
    }
    for (const id of tail) {
      if (id === move.todoId) continue
      max += RANK_STEP
      effective.set(id, max)
      writes.set(id, max)
    }
  }

  const prevRank = move.prevId != null ? effective.get(move.prevId) : undefined
  const nextRank = move.nextId != null ? effective.get(move.nextId) : undefined
  let rank: number | null
  if (move.prevId == null && move.nextId == null) {
    rank = effective.get(move.todoId) ?? null
    if (rank == null) {
      let max = 0
      for (const r of effective.values()) max = Math.max(max, r)
      rank = max + RANK_STEP
    }
  } else {
    rank = rankBetween(prevRank, nextRank)
  }

  if (rank == null) {
    // No room: re-space every ranked task, the moved one in its new place.
    const ranked = [...effective.keys()]
      .filter((id) => id !== move.todoId)
      .sort((a, b) => (effective.get(a) ?? 0) - (effective.get(b) ?? 0) || a - b)
    const placed = placeInOrder(ranked, move)
    const out: RankWrite[] = []
    for (const w of ranksInOrder(placed)) {
      if (ranks.get(w.todoId) !== w.rank) out.push(w)
    }
    return out
  }

  writes.set(move.todoId, rank)
  const out: RankWrite[] = []
  for (const [todoId, r] of writes) {
    if (ranks.get(todoId) !== r) out.push({ todoId, rank: r })
  }
  return out
}

/**
 * Ranks that start a list's manual order from `order` (what the list shows
 * now, under its current sort), with `move` applied when given.
 */
export function seedRanks(order: readonly number[], move?: MoveTarget): RankWrite[] {
  return ranksInOrder(move ? placeInOrder(order, move) : order)
}
