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
 * - `bulkUpdateField` — shared bulk field update with undo
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
import { useUndoStore } from './undo-store'
import { registerModuleReset } from '../utils/module-reset'

export type SetFn = (partial: Record<string, unknown>) => void

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

/** Test hook: forgets writes left in flight by a previous test file. */
export function resetWriteTracking(): void {
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
    /** The snackbar's second line (`UndoEntry.detail`). */
    detail?: string
  },
): Promise<void> {
  return trackWrite(async () => {
    apply()
    try {
      await persist()
      if (undo) {
        undoable(undo.description, undo.redo, undo.undo, undo.showSnackbar, undo.detail)
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

/**
 * Bulk update a single field on multiple todos, with undo support.
 * Uses optimistic update: state changes immediately, DB write follows.
 * Only the tasks whose field changes are written (and get a new
 * `modifiedAt`); when none does, nothing is written and no undo step added.
 */
export async function bulkUpdateField<K extends keyof PersistedTodoItem>(
  ids: number[],
  field: K,
  value: PersistedTodoItem[K],
  label: string,
  get: () => { todos: PersistedTodoItem[] },
  set: SetFn,
  opts: { showSnackbar?: boolean } = {},
): Promise<void> {
  const idSet = new Set(ids)
  const prevValues = get().todos
    .filter((t) => idSet.has(t.id) && !sameFieldValue(t[field], value))
    .map((t) => ({ id: t.id, prev: t[field], modifiedAt: t.modifiedAt }))
  if (prevValues.length === 0) return
  const changedIds = new Set(prevValues.map((s) => s.id))
  // One timestamp for the store and the database write.
  const now = new Date()
  /** The tasks back to `prevValues` — the `modifiedAt` too, where no later write stamped it. */
  const revert = (keepNewerStamp: boolean) => {
    const prevMap = new Map(prevValues.map((s) => [s.id, s]))
    set({
      todos: get().todos.map((t) => {
        const saved = prevMap.get(t.id)
        if (!saved) return t
        const stamp = !keepNewerStamp || t.modifiedAt === now ? { modifiedAt: saved.modifiedAt } : {}
        return { ...t, [field]: saved.prev, ...stamp }
      }),
    })
  }

  await optimistic(
    () => {
      set({
        todos: get().todos.map((t) =>
          changedIds.has(t.id) ? { ...t, [field]: value, modifiedAt: now } : t,
        ),
      })
    },
    () => todoRepository.bulkUpdate([...changedIds].map((id) => ({ todoId: id, changes: { [field]: value } })), now),
    () => revert(true),
    label,
    {
      description: label,
      redo: () => bulkUpdateField(ids, field, value, label, get, set, opts),
      undo: async () => {
        // The rows the edit changed get their value and modifiedAt back, in
        // the database and the store alike; the others are left as they are.
        await todoRepository.bulkUpdate(prevValues.map((s) => ({ todoId: s.id, changes: { [field]: s.prev, modifiedAt: s.modifiedAt } })))
        revert(false)
      },
      showSnackbar: opts.showSnackbar,
    },
  )
}
