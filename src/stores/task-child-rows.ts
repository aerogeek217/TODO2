import type { TaskChildRepository } from '../data/task-child-repository'
import { registerModuleReset } from '../utils/module-reset'
import { loadFresh, trackWrite } from './store-helpers'
import { notifyTasksTouched } from './task-hooks'

/** Task id → its rows, in the store's order. */
export type RowsByTodo<Stored> = ReadonlyMap<number, readonly Stored[]>

/** The state a store of task-owned rows keeps (status updates, subtasks). */
export interface TaskChildRowsState<Stored> {
  byTodo: RowsByTodo<Stored>
  loaded: boolean
}

/**
 * `byTodo` with `rows` added (or replaced, by id) — a row whose task changed
 * leaves its old one; each task touched sorted again by `compare`.
 */
export function withRows<Stored extends { id: number; todoId: number }>(
  byTodo: RowsByTodo<Stored>,
  rows: readonly Stored[],
  compare: (a: Stored, b: Stored) => number,
): Map<number, readonly Stored[]> {
  const ids = new Set(rows.map((r) => r.id))
  const next = withoutRows(byTodo, ids)
  for (const todoId of new Set(rows.map((r) => r.todoId))) {
    next.set(todoId, [...(next.get(todoId) ?? []), ...rows.filter((r) => r.todoId === todoId)].sort(compare))
  }
  return next
}

/** `byTodo` without the rows `ids` (a task left with none drops out). */
export function withoutRows<Stored extends { id: number }>(
  byTodo: RowsByTodo<Stored>,
  ids: ReadonlySet<number>,
): Map<number, readonly Stored[]> {
  const next = new Map(byTodo)
  for (const [todoId, rows] of byTodo) {
    if (!rows.some((r) => ids.has(r.id))) continue
    const kept = rows.filter((r) => !ids.has(r.id))
    if (kept.length > 0) next.set(todoId, kept)
    else next.delete(todoId)
  }
  return next
}

/** The row `id` in `byTodo`, or undefined. */
export function findRow<Stored extends { id: number }>(byTodo: RowsByTodo<Stored>, id: number): Stored | undefined {
  for (const rows of byTodo.values()) {
    const hit = rows.find((r) => r.id === id)
    if (hit) return hit
  }
  return undefined
}

/** How one store of task-owned rows reads, stores and orders them. */
export interface TaskChildRowsConfig<Row extends { todoId: number }, Stored extends Row & { id: number }> {
  repository: TaskChildRepository<Row, Stored>
  /** The order of one task's rows. */
  compare: (a: Stored, b: Stored) => number
  /** A row as it is stored (its text as one trimmed line), or null when it can't be (blank). */
  normalize: (row: Row) => Row | null
  /** Names the rows in a failed load's notice (`the subtasks`). */
  label: string
  get: () => TaskChildRowsState<Stored>
  set: (partial: Partial<TaskChildRowsState<Stored>>) => void
}

/**
 * The part every store of task-owned rows shares (`status-update-store`,
 * `subtask-store`): the load (single-flight, its in-flight load reset for
 * tests), rows written whole (`addRows`, through `normalize`), put back
 * (`restoreRows` / `putBack`), taken out (`take`) and forgotten with their
 * task (`forgetTodos`). Every write is a tracked write; one that is activity
 * on a task stamps it (`notifyTasksTouched`). Each store adds its own
 * actions over `find` / `put` / `putBack` / `take`.
 */
export function taskChildRows<Row extends { todoId: number }, Stored extends Row & { id: number }>(
  config: TaskChildRowsConfig<Row, Stored>,
) {
  const { repository, compare, normalize, label, get, set } = config
  let inflight: Promise<void> | null = null
  // A load dropped by the reset finishes on its own; the next call reads again.
  registerModuleReset(() => { inflight = null })

  const find = (id: number): Stored | undefined => findRow(get().byTodo, id)

  /** `rows` into the store (added, or replaced by id). */
  const put = (rows: readonly Stored[]): void => {
    if (rows.length > 0) set({ byTodo: withRows(get().byTodo, rows, compare) })
  }

  /** Puts `rows` back in the database and the store; `touch`: stamp their tasks (an undo / redo of a write). The rows put back. */
  const putBack = async (rows: readonly Stored[], touch: boolean): Promise<Stored[]> => {
    const at = new Date()
    const restored = await repository.restore(rows, touch ? at : undefined)
    put(restored)
    if (touch) notifyTasksTouched(restored.map((r) => r.todoId), at)
    return restored
  }

  /** Deletes the rows `ids` from the database and the store, stamping their tasks. */
  const take = async (ids: readonly number[]): Promise<void> => {
    const idSet = new Set(ids)
    const rows = [...get().byTodo.values()].flatMap((list) => list.filter((r) => idSet.has(r.id)))
    const at = new Date()
    await repository.deleteMany(ids, at)
    set({ byTodo: withoutRows(get().byTodo, idSet) })
    notifyTasksTouched(rows.map((r) => r.todoId), at)
  }

  const actions = {
    async load(): Promise<void> {
      // Never rejects (a refresh of every store waits on it): a failed read is reported, the rows kept.
      const rows = await loadFresh(() => repository.getAll(), label)
      if (rows) set({ byTodo: withRows(new Map(), rows, compare), loaded: true })
    },

    ensureLoaded(): Promise<void> {
      if (get().loaded) return Promise.resolve()
      // A failed load leaves `loaded` false: reported, and retried next time.
      if (inflight) return inflight
      const run: Promise<void> = actions.load()
        .finally(() => { if (inflight === run) inflight = null })
      inflight = run
      return run
    },

    async addRows(given: readonly Row[]): Promise<Stored[]> {
      // The one choke point for rows written whole: each stored as the store's own add stores it, a blank one dropped.
      const rows = given.flatMap((r) => normalize(r) ?? [])
      if (rows.length === 0) return []
      return trackWrite(async () => {
        const added = await repository.addMany(rows)
        put(added)
        return added
      })
    },

    async restoreRows(rows: readonly Stored[]): Promise<void> {
      if (rows.length === 0) return
      await trackWrite(() => putBack(rows, false))
    },

    forgetTodos(todoIds: readonly number[]): void {
      const byTodo = get().byTodo
      const gone = todoIds.filter((id) => byTodo.has(id))
      if (gone.length === 0) return
      const next = new Map(byTodo)
      for (const id of gone) next.delete(id)
      set({ byTodo: next })
    },
  }

  return { find, put, putBack, take, actions }
}
