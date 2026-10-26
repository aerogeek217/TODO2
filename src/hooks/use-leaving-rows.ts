import { useEffect, useMemo, useRef, useState } from 'react'
import type { PersistedTodoItem } from '../models'
import { useTodoStore } from '../stores/todo-store'
import { prefersReducedMotion } from '../utils/motion'

/** How long a just-completed row stays put before it folds away (D19). */
export const LEAVE_DELAY_MS = 500
/** How long the fold takes; the row drops out of the list when it ends. */
export const FOLD_MS = 180

/** A leaving row: still shown (`stay`), then folding to nothing (`fold`). */
export type LeavingPhase = 'stay' | 'fold'

export interface LeavingRow {
  phase: LeavingPhase
  /** The task as it was just before it was completed — what keeps its row in place. */
  before: PersistedTodoItem
  /**
   * A recurring task's occurrence was done: the task is open with its next
   * date, and the row lingers as the finished occurrence (`before`, shown
   * completed) before the next one takes its place.
   */
  advanced?: boolean
}

/** What a leaving row shows while it lingers: the task as it is, or a finished occurrence. */
export function leavingShownAs(todo: PersistedTodoItem, row: LeavingRow | undefined): PersistedTodoItem {
  return row?.advanced ? { ...row.before, isCompleted: true } : todo
}

const time = (d: Date | undefined | null): number => (d ? new Date(d).getTime() : 0)

export type LeavingRows = ReadonlyMap<number, LeavingRow>

const NONE: LeavingRows = new Map()

/**
 * The completion's "leaving" set (D19): a task this list shows that gets
 * completed stays where it is for `LEAVE_DELAY_MS` (the check draws, the
 * strike sweeps), then folds over `FOLD_MS` before it drops out — the list
 * keeps it (`useBuiltList`'s `leaving`) only where it would otherwise drop
 * it, built from the task as it was before the completion (`before`), so
 * neither its completion nor the `modifiedAt` the completion moved can
 * re-sort or drop the row meanwhile. Taken back if the task is reopened
 * meanwhile. A recurring task's occurrence done (its due date advanced,
 * the task still open) lingers the same way, shown as the finished
 * occurrence (`advanced`), and the next occurrence takes its place after
 * the fold; an undo that puts the date back takes it back. Under reduced
 * motion nothing lingers: the row leaves at once.
 *
 * `isShown` tells whether a task is a row of this list now (read when a
 * completion arrives, not on every render).
 */
export function useLeavingRows(isShown: (todoId: number) => boolean): LeavingRows {
  const [leaving, setLeaving] = useState<LeavingRows>(NONE)
  const isShownRef = useRef(isShown)
  useEffect(() => { isShownRef.current = isShown })

  useEffect(() => {
    const timers = new Map<number, number[]>()
    /** The rows lingering now (the effect's own copy of the state, for the take-back checks). */
    const rows = new Map<number, LeavingRow>()
    const clear = (id: number) => {
      for (const t of timers.get(id) ?? []) window.clearTimeout(t)
      timers.delete(id)
    }
    const remove = (id: number) => {
      clear(id)
      rows.delete(id)
      setLeaving((cur) => {
        if (!cur.has(id)) return cur
        const next = new Map(cur)
        next.delete(id)
        return next.size ? next : NONE
      })
    }
    const unsubscribe = useTodoStore.subscribe((state, prev) => {
      if (state.todos === prev.todos) return
      const before = new Map(prev.todos.map((t) => [t.id, t]))
      const started: LeavingRow[] = []
      for (const t of state.todos) {
        const was = before.get(t.id)
        if (!was) continue
        if (!was.isCompleted && t.isCompleted) {
          if (isShownRef.current(t.id)) started.push({ phase: 'stay', before: was })
        } else if (was.isCompleted && !t.isCompleted) {
          if (timers.has(t.id)) remove(t.id)
        } else if (!t.isCompleted && was.recurrenceRule && time(t.dueDate) !== time(was.dueDate)) {
          // A recurring task's date moved: its occurrence was done (forward),
          // or that was undone (back to where the lingering row started).
          const row = rows.get(t.id)
          if (row?.advanced && time(t.dueDate) === time(row.before.dueDate)) remove(t.id)
          else if (time(t.dueDate) > time(was.dueDate) && isShownRef.current(t.id)) started.push({ phase: 'stay', before: was, advanced: true })
        }
      }
      if (started.length === 0 || prefersReducedMotion()) return
      setLeaving((cur) => {
        const next = new Map(cur)
        for (const row of started) next.set(row.before.id, row)
        return next
      })
      for (const row of started) {
        const id = row.before.id
        clear(id)
        rows.set(id, row)
        const fold = (cur: LeavingRows) => {
          const row = cur.get(id)
          return row?.phase === 'stay' ? new Map(cur).set(id, { ...row, phase: 'fold' }) : cur
        }
        timers.set(id, [
          window.setTimeout(() => setLeaving(fold), LEAVE_DELAY_MS),
          window.setTimeout(() => remove(id), LEAVE_DELAY_MS + FOLD_MS),
        ])
      }
    })
    return () => {
      unsubscribe()
      for (const id of [...timers.keys()]) clear(id)
    }
  }, [])

  return leaving
}

/**
 * `todos` with each leaving task that is completed now (or whose occurrence
 * was done, `advanced`) as it was just before (open, its date and
 * `modifiedAt` unmoved) — what keeps its row in place while it lingers.
 * `only` limits it to those ids (the ones a surface would otherwise drop or
 * move).
 */
export function restoreLeaving(
  todos: readonly PersistedTodoItem[],
  leaving: LeavingRows,
  only?: ReadonlySet<number>,
): PersistedTodoItem[] {
  return todos.map((t) => {
    const row = !only || only.has(t.id) ? leaving.get(t.id) : undefined
    return row && (row.advanced || t.isCompleted) ? row.before : t
  })
}

/**
 * Which of the `leaving` tasks a surface keeps as they were: those it would
 * otherwise drop (`shown` lacks them), and every finished occurrence (its
 * task is open with the next date, which would move the row).
 */
export function keptOf(leaving: LeavingRows, shown: ReadonlySet<number>): Set<number> {
  const kept = new Set<number>()
  for (const [id, row] of leaving) if (row.advanced || !shown.has(id)) kept.add(id)
  return kept
}

/**
 * What each kept row shows: a kept row is built as it was, and shows as it
 * is (completed) — or, for a finished occurrence, as that occurrence done
 * (`leavingShownAs`).
 */
export function useKeptTodos(kept: ReadonlySet<number>, leaving?: LeavingRows): ReadonlyMap<number, PersistedTodoItem> | null {
  const todos = useTodoStore((s) => s.todos)
  return useMemo(() => {
    if (kept.size === 0) return null
    const shown = new Map<number, PersistedTodoItem>()
    for (const t of todos) if (kept.has(t.id)) shown.set(t.id, leavingShownAs(t, leaving?.get(t.id)))
    return shown
  }, [kept, leaving, todos])
}
