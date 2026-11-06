/**
 * A task's `modifiedAt` across undo / redo (cr32): **an undo puts back the
 * stamp the task had before the step, a redo the stamp the step wrote** —
 * each only where the task still holds the stamp the other left (nothing
 * touched the task since; a newer stamp stays). The same rule for every
 * undoable task write — a field edit, a completion, a follow-up, a status
 * update, a subtask, an assignment.
 *
 * A step keeps the `StampChanges` its own write made (each task's stamp
 * before → after); its undo writes them inverted (`undoStamps`), its redo as
 * they are, both as a guarded `Stamp` (`stampAfter`), in the database (in the
 * write's transaction) and in the store alike.
 */

/** One task's `modifiedAt` before a write and after it. */
export interface StampChange {
  readonly before: Date
  readonly after: Date
}

/** Task id → the stamp change a write made on it. */
export type StampChanges = ReadonlyMap<number, StampChange>

/**
 * How a write moves its tasks' `modifiedAt`. A `Date`: a new write — every
 * task it touches gets that stamp. A `StampChanges`: an undo / redo putting
 * back a step's stamps — each task listed moves from `before` to `after`
 * only while it still holds `before`; every other task keeps its own.
 */
export type Stamp = Date | StampChanges

const sameTime = (a: Date | undefined, b: Date | undefined): boolean => a?.getTime() === b?.getTime()

/** The `modifiedAt` task `todoId` holds after a write with `stamp`, given the one it holds now (`current`, returned when unchanged). */
export function stampAfter(stamp: Stamp, todoId: number, current: Date): Date {
  if (stamp instanceof Date) return stamp
  const change = stamp.get(todoId)
  return change && sameTime(change.before, current) ? change.after : current
}

/** What an undo of the step that made `step` writes: each task back from `after` to `before`. */
export function undoStamps(step: StampChanges): Map<number, StampChange> {
  const inverted = new Map<number, StampChange>()
  for (const [id, { before, after }] of step) inverted.set(id, { before: after, after: before })
  return inverted
}
