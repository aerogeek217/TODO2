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
}

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
 * meanwhile. Under reduced motion nothing lingers: the row leaves at once.
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
    const clear = (id: number) => {
      for (const t of timers.get(id) ?? []) window.clearTimeout(t)
      timers.delete(id)
    }
    const remove = (id: number) => {
      clear(id)
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
      const started: PersistedTodoItem[] = []
      for (const t of state.todos) {
        const was = before.get(t.id)
        if (was?.isCompleted === false && t.isCompleted && isShownRef.current(t.id)) started.push(was)
        else if (was?.isCompleted === true && !t.isCompleted && timers.has(t.id)) remove(t.id)
      }
      if (started.length === 0 || prefersReducedMotion()) return
      setLeaving((cur) => {
        const next = new Map(cur)
        for (const t of started) next.set(t.id, { phase: 'stay', before: t })
        return next
      })
      for (const { id } of started) {
        clear(id)
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
 * `todos` with each leaving task that is completed now as it was just
 * before its completion (open, its `modifiedAt` unmoved) — what keeps its
 * row in place while it lingers. `only` limits it to those ids (the ones a
 * surface would otherwise drop).
 */
export function restoreLeaving(
  todos: readonly PersistedTodoItem[],
  leaving: LeavingRows,
  only?: ReadonlySet<number>,
): PersistedTodoItem[] {
  return todos.map((t) => {
    const row = t.isCompleted && (!only || only.has(t.id)) ? leaving.get(t.id) : undefined
    return row ? row.before : t
  })
}

/** The task as it is now behind each kept row: a kept row is built as it was, and shows as it is (completed). */
export function useKeptTodos(kept: ReadonlySet<number>): ReadonlyMap<number, PersistedTodoItem> | null {
  const todos = useTodoStore((s) => s.todos)
  return useMemo(
    () => (kept.size > 0 ? new Map(todos.filter((t) => kept.has(t.id)).map((t) => [t.id, t])) : null),
    [kept, todos],
  )
}
