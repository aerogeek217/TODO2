/**
 * Shared helpers for Zustand store patterns:
 * - `trackWrite` / `readFresh` — keep a `load()` from overwriting an edit made
 *   while its read was in flight
 * - `loadFresh` / `reportLoadFailure` — a fresh read for a store load; a
 *   failed load is reported to the user
 * - `makeEnsureLoaded` — load once, retry after a failure
 * - `mutate` / `optimistic` — tracked store writes
 * - `updateEntityInMap` — refresh entity references in assignment maps
 * - `captureAssignments` — capture a task's people and tags for undo
 * - `bulkUpdateTasks` / `bulkUpdateField` — shared bulk field updates with undo
 * - `saveOrReport` — a tracked write that never rejects (the entry stores')
 *
 * Capture/restore for soft-delete undo lives in `data/join-helpers.ts`
 * (`captureJoinRows`) and the per-entity repositories' `restoreWithJoins`
 * methods (tag / person) — store-layer undo paths consume those
 * rather than reaching into `db.X.add` directly.
 */

import { personRepository } from '../data/person-repository'
import { tagRepository } from '../data/tag-repository'
import { todoRepository } from '../data'
import type { PersistedTodoItem } from '../models'
import { undoable } from './undoable'
import { guardTasks } from './task-undo-guard'
import { useUndoStore } from './undo-store'
import { registerModuleReset, registerModuleSettle } from '../utils/module-reset'
import { fieldsOf, withOrphanedRuleDropped } from '../utils/todo-changes'
import { stampAfter, undoStamps, type Stamp, type StampChanges } from '../utils/task-stamps'

type SetFn = (partial: Record<string, unknown>) => void

// ── Load vs. write ──────────────────────────────────────────────────────────
//
// A store's `load()` reads the database and then replaces its state with what
// it read. A write that lands while that read is in flight (an optimistic edit
// is already in the state, its database write may not be) would be wiped out
// by the stale result. So every store write runs through `trackWrite` (the
// `optimistic` / `mutate` helpers do it for their callers), and every load
// reads through `readFresh`, which waits for writes in flight to settle and
// reads again when a write started during its read.
//
// Rule: a tracked write must never await a `readFresh` load — the load would
// wait for the write that is waiting for it. (Assignment-map loads don't use
// `readFresh`; they merge with the latest map instead, so writes may call them.)

/** Bumped when a tracked write starts. */
let writesStarted = 0
const writesInFlight = new Set<Promise<unknown>>()

/** Reads in a row before `readFresh` gives up waiting for a quiet moment. */
const MAX_FRESH_READS = 5

/**
 * Runs a tracked write (`trackWrite`); on failure logs it, tells the user
 * `Couldn't <label>.` and resolves `fallback` — the status-update and
 * subtask stores' writes, which never reject.
 */
export async function saveOrReport<T>(write: () => Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await trackWrite(write)
  } catch (e) {
    console.error(`Failed to ${label}:`, e)
    useUndoStore.getState().notify(`Couldn't ${label}.`)
    return fallback
  }
}

/**
 * Runs a store write — its state change and its database write — so that
 * loads overlapping it read again once it has settled.
 */
export function trackWrite<T>(write: () => Promise<T>): Promise<T> {
  writesStarted++
  const p = write()
  writesInFlight.add(p)
  const done = () => { writesInFlight.delete(p) }
  p.then(done, done)
  return p
}

/**
 * Reads with `fetcher` once no tracked write is in flight, and reads again if
 * a write started meanwhile, so the result already holds every write the
 * store has applied. Use it for any read whose result replaces store state.
 */
export async function readFresh<T>(fetcher: () => Promise<T>): Promise<T> {
  for (let reads = 1; ; reads++) {
    while (writesInFlight.size > 0) await Promise.allSettled([...writesInFlight])
    // Same tick as the empty check: no write can slip in between.
    const started = writesStarted
    const data = await fetcher()
    if (writesStarted === started) return data
    if (reads >= MAX_FRESH_READS) {
      console.warn('[store] writes kept landing during a load; using the latest read')
      return data
    }
  }
}

/**
 * Test hook: resolves once no tracked write is in flight — what a store does
 * after a write's database write (an undo push, a rollback) has run by then.
 * The setup awaits it after every test (`settleModuleWork`).
 */
export async function settleWrites(): Promise<void> {
  while (writesInFlight.size > 0) await Promise.allSettled([...writesInFlight])
}
registerModuleSettle(settleWrites)

/**
 * Test hook: forgets writes still in flight — only those that never settled
 * (`settleWrites` ran after the test), e.g. under a test's fake timers.
 */
function resetWriteTracking(): void {
  writesInFlight.clear()
}
registerModuleReset(resetWriteTracking)

/**
 * A load failed: logs it and tells the user (the undo snackbar's notice), so
 * a store left empty by a transient storage error isn't silent.
 */
export function reportLoadFailure(label: string, error: unknown): void {
  console.error(`Failed to load ${label}:`, error)
  useUndoStore.getState().notify(`Couldn't load ${label}. Reload the page to try again.`)
}

/**
 * A store load's read: goes through `readFresh` and returns the fetched data,
 * or undefined on error (reported with `reportLoadFailure`).
 */
export async function loadFresh<T>(
  fetcher: () => Promise<T>,
  label: string,
): Promise<T | undefined> {
  try {
    return await readFresh(fetcher)
  } catch (e) {
    reportLoadFailure(label, e)
    return undefined
  }
}

/**
 * Memoize a `load()` so callers (pages, widgets) can fire `ensureLoaded()`
 * on every mount without re-hitting IndexedDB. Concurrent callers share the
 * same in-flight load; once `isLoaded()` (a store flag the load sets only
 * when its read succeeded) is true, calls are a no-op. A failed load leaves
 * the flag unset, so the next `ensureLoaded()` tries again. `load` reports
 * its own failure (`loadFresh`); the returned promise never rejects.
 */
export function makeEnsureLoaded(
  load: () => Promise<void>,
  isLoaded: () => boolean,
): () => Promise<void> {
  let inflight: Promise<void> | null = null
  // A load dropped by the reset finishes on its own; the next call reads again.
  registerModuleReset(() => { inflight = null })
  return () => {
    if (isLoaded()) return Promise.resolve()
    if (inflight) return inflight
    const run: Promise<void> = load()
      .catch((e: unknown) => { console.error('Load failed:', e) })
      .finally(() => { if (inflight === run) inflight = null })
    inflight = run
    return run
  }
}

/**
 * Wrap a store mutation: logs a failure and re-throws it so callers can
 * handle it. The mutation is a tracked write (`trackWrite`).
 */
export function mutate<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  return trackWrite(async () => {
    try {
      return await fn()
    } catch (e) {
      console.error(`${label}:`, e)
      throw e
    }
  })
}

/**
 * Optimistic mutation: update UI state immediately, persist async, rollback on failure.
 * Uses item-level rollback (caller patches only affected items) to prevent concurrent
 * rollbacks from stomping each other's state.
 *
 * Undo is only registered after successful persist. Failed operations never enter the
 * undo stack. `apply` runs synchronously, before this returns; the whole
 * update is a tracked write (`trackWrite`).
 */
export function optimistic(
  apply: () => void,
  persist: () => Promise<void>,
  rollback: () => void,
  label: string,
  undo?: {
    description: string
    redo: () => void | Promise<void>
    undo: () => void | Promise<void>
    showSnackbar?: boolean
  },
): Promise<void> {
  return trackWrite(async () => {
    apply()
    try {
      await persist()
      if (undo) {
        undoable(undo.description, undo.redo, undo.undo, undo.showSnackbar)
      }
    } catch (e) {
      console.error(`${label}:`, e)
      rollback()
      throw e
    }
  })
}


/**
 * Update an entity in an assignment map (Map<todoId, Entity[]>).
 * When an entity is edited, all references in the map must be refreshed.
 */
export function updateEntityInMap<E extends { id?: number }>(
  entity: E,
  map: Map<number, E[]>,
): Map<number, E[]> {
  const updated = new Map(map)
  for (const [key, list] of updated) {
    if (list.some((e) => e.id === entity.id)) {
      updated.set(key, list.map((e) => (e.id === entity.id ? { ...entity } : e)))
    }
  }
  return updated
}

/** A task's people and tags, captured before a delete so undo can put them back. */
export interface CapturedAssignments {
  personIds: number[]
  tagIds: number[]
}

/** Capture a task's person and tag assignment ids (for undo). */
export async function captureAssignments(todoId: number): Promise<CapturedAssignments> {
  const [captured] = await captureAssignmentsBulk([todoId])
  return { personIds: captured?.personIds ?? [], tagIds: captured?.tagIds ?? [] }
}

/** Capture person and tag assignment ids for several tasks at once. */
export async function captureAssignmentsBulk(todoIds: number[]): Promise<
  Array<{ todoId: number } & CapturedAssignments>
> {
  const [pMap, tMap] = await Promise.all([
    personRepository.getAssignedPeopleForTodos(todoIds),
    tagRepository.getAssignedTagsForTodos(todoIds),
  ])
  const ids = (rows: readonly { id?: number }[] | undefined) =>
    (rows ?? []).flatMap((r) => (r.id != null ? [r.id] : []))
  return todoIds.map((todoId) => ({
    todoId,
    personIds: ids(pMap.get(todoId)),
    tagIds: ids(tMap.get(todoId)),
  }))
}

/** Whether a task field already holds `value` (dates by their time). */
function sameFieldValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  return a === b
}

/** The fields a bulk write sets on one task (`undefined` removes a field). */
type TaskFields = Partial<Omit<PersistedTodoItem, 'id' | 'modifiedAt'>>

const valueOf = (row: object, key: string): unknown => (row as Record<string, unknown>)[key]

/**
 * Writes each task its own fields (`changes`: task id → the fields, all of
 * them in **one** database write and one undo step), with undo support.
 * Uses optimistic update: state changes immediately, DB write follows.
 * Only the tasks one of whose fields changes are written (and get a new
 * `modifiedAt`); when none does, nothing is written and no undo step added.
 * Undo puts back each task's earlier values and its earlier `modifiedAt`,
 * redo the ones this wrote (`opts.stamp`, `utils/task-stamps`) — each stamp
 * only where the task still holds the other. A caller's `opts.stamp` of
 * `KEEP_STAMPS` writes the fields and leaves every `modifiedAt` as it is, on
 * the write, its undo and its redo.
 */
export async function bulkUpdateTasks(
  changes: ReadonlyMap<number, TaskFields>,
  label: string,
  get: () => { todos: PersistedTodoItem[] },
  set: SetFn,
  opts: { showSnackbar?: boolean; stamp?: StampChanges } = {},
): Promise<void> {
  const saved = get().todos.flatMap((t) => {
    const next = changes.get(t.id)
    if (!next) return []
    const keys = Object.keys(next)
    if (keys.every((key) => sameFieldValue(valueOf(t, key), valueOf(next, key)))) return []
    return [{
      id: t.id,
      next,
      keys,
      prev: fieldsOf(t, next),
      modifiedAt: t.modifiedAt,
      // A rule this write leaves without a due date: the repository drops it
      // (`withOrphanedRuleDropped`); the store does the same, undo puts it back.
      droppedRule: !('recurrenceRule' in next) && 'recurrenceRule' in withOrphanedRuleDropped({ ...t, ...next }, next)
        ? t.recurrenceRule
        : undefined,
    }]
  })
  if (saved.length === 0) return
  const savedById = new Map(saved.map((s) => [s.id, s]))
  // One stamp for the store and the database write: now, or a redo's put back.
  const write: Stamp = opts.stamp ?? new Date()
  const stampOf = new Map(saved.map((s) => [s.id, stampAfter(write, s.id, s.modifiedAt)]))
  const step: StampChanges = new Map(saved.map((s) => [s.id, { before: s.modifiedAt, after: stampOf.get(s.id) ?? s.modifiedAt }]))
  /**
   * The tasks back to their earlier values. For a failed write (`onlyOwn`),
   * only the fields that still hold the value this write set — an edit of
   * one that landed meanwhile stays — and the `modifiedAt` only where no
   * later write stamped it. For an undo, the earlier `modifiedAt` as the
   * undo's database write puts it back (`back`).
   */
  const revert = (onlyOwn: boolean, back?: StampChanges) => {
    set({
      todos: get().todos.map((t) => {
        const s = savedById.get(t.id)
        if (!s) return t
        const keys = onlyOwn ? s.keys.filter((key) => sameFieldValue(valueOf(t, key), valueOf(s.next, key))) : s.keys
        if (keys.length === 0) return t
        const stamp = back
          ? { modifiedAt: stampAfter(back, t.id, t.modifiedAt) }
          : t.modifiedAt === stampOf.get(t.id) ? { modifiedAt: s.modifiedAt } : {}
        const rule = s.droppedRule != null && t.recurrenceRule == null ? { recurrenceRule: s.droppedRule } : {}
        return { ...t, ...Object.fromEntries(keys.map((key) => [key, valueOf(s.prev, key)])), ...rule, ...stamp }
      }),
    })
  }

  await optimistic(
    () => {
      set({
        todos: get().todos.map((t) => {
          const s = savedById.get(t.id)
          return s
            ? { ...t, ...s.next, ...(s.droppedRule != null ? { recurrenceRule: undefined } : {}), modifiedAt: stampOf.get(t.id) ?? t.modifiedAt }
            : t
        }),
      })
    },
    () => todoRepository.bulkUpdate(saved.map((s) => ({ todoId: s.id, changes: s.next })), write),
    () => revert(true),
    label,
    {
      description: label,
      redo: guardTasks(changes.keys(), (present) => bulkUpdateTasks(
        new Map(present.flatMap((id) => { const next = changes.get(id); return next ? [[id, next] as const] : [] })),
        label, get, set, { ...opts, stamp: step },
      )),
      undo: guardTasks(savedById.keys(), async () => {
        // The rows the edit changed get their values and modifiedAt back, in
        // the database and the store alike; the others are left as they are.
        const back = undoStamps(step)
        await todoRepository.bulkUpdate(saved.map((s) => ({
          todoId: s.id,
          changes: { ...s.prev, ...(s.droppedRule != null ? { recurrenceRule: s.droppedRule } : {}) },
        })), back)
        revert(false, back)
      }),
      showSnackbar: opts.showSnackbar,
    },
  )
}

/**
 * Bulk update a single field on multiple todos, with undo support: every
 * task in `ids` gets `value` (`bulkUpdateTasks`, which says what is written,
 * stamped and undone).
 */
export function bulkUpdateField<K extends keyof TaskFields>(
  ids: number[],
  field: K,
  value: PersistedTodoItem[K],
  label: string,
  get: () => { todos: PersistedTodoItem[] },
  set: SetFn,
  opts: { showSnackbar?: boolean; stamp?: StampChanges } = {},
): Promise<void> {
  const fields = { [field]: value } as TaskFields
  return bulkUpdateTasks(new Map(ids.map((id) => [id, fields])), label, get, set, opts)
}
