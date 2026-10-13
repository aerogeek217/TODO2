/**
 * Shared helpers for Zustand store patterns:
 * - `trackWrite` / `readFresh` — keep a `load()` from overwriting an edit made
 *   while its read was in flight
 * - `loadWithState` — loading / error boilerplate around a fresh read
 * - `mutate` / `optimistic` — tracked store writes with error state
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
import { undoable } from '../services/undoable'

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

/**
 * Execute a data-fetching function with loading/error state management.
 * The read goes through `readFresh`. Returns the fetched data, or undefined
 * on error.
 */
export async function loadWithState<T>(
  set: SetFn,
  fetcher: () => Promise<T>,
  label: string,
): Promise<T | undefined> {
  set({ loading: true, error: null })
  try {
    const data = await readFresh(fetcher)
    return data
  } catch (e) {
    console.error(`Failed to load ${label}:`, e)
    set({ error: `Failed to load ${label}` })
    return undefined
  } finally {
    set({ loading: false })
  }
}

/**
 * Memoize a `load()` so callers (pages, widgets) can fire
 * `ensureLoaded()` on every mount without re-hitting IndexedDB. Concurrent
 * callers share the same in-flight promise; once the first load resolves,
 * subsequent calls are a no-op until `resetLoaded()` is invoked (e.g. after
 * an import / DB reset).
 *
 * Usage: keep one instance per store (`const ensure = makeEnsureLoaded(load)`)
 * and expose `ensure` as the store action; expose `resetLoaded()` for paths
 * that need to force a re-fetch.
 */
export function makeEnsureLoaded(load: () => Promise<void>): {
  ensureLoaded: () => Promise<void>
  resetLoaded: () => void
} {
  let loaded = false
  let inflight: Promise<void> | null = null
  return {
    ensureLoaded() {
      if (loaded) return Promise.resolve()
      if (inflight) return inflight
      const p = load()
        .then(() => { loaded = true; inflight = null })
        .catch((err) => { inflight = null; throw err })
      inflight = p
      return p
    },
    resetLoaded() {
      loaded = false
      inflight = null
    },
  }
}

/**
 * Wrap a store mutation with error handling: clears previous error, catches failures,
 * logs them, sets error state, and re-throws so callers can handle if needed.
 * The mutation is a tracked write (`trackWrite`).
 */
export function mutate<T>(
  set: SetFn,
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  return trackWrite(async () => {
    set({ error: null })
    try {
      return await fn()
    } catch (e) {
      console.error(`${label}:`, e)
      set({ error: label })
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
  set: SetFn,
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
    set({ error: null })
    apply()
    try {
      await persist()
      if (undo) {
        undoable(undo.description, undo.redo, undo.undo, undo.showSnackbar)
      }
    } catch (e) {
      console.error(`${label}:`, e)
      rollback()
      set({ error: label })
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

/**
 * Bulk update a single field on multiple todos, with undo support.
 * Uses optimistic update: state changes immediately, DB write follows.
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
  const prevValues = get().todos
    .filter((t) => ids.includes(t.id))
    .map((t) => ({ id: t.id, prev: t[field], modifiedAt: t.modifiedAt }))
  const idSet = new Set(ids)

  await optimistic(
    set,
    () => {
      const now = new Date()
      set({
        todos: get().todos.map((t) =>
          idSet.has(t.id) ? { ...t, [field]: value, modifiedAt: now } : t,
        ),
      })
    },
    () => todoRepository.bulkUpdate(ids.map((id) => ({ todoId: id, changes: { [field]: value } }))),
    () => {
      const prevMap = new Map(prevValues.map((s) => [s.id, { prev: s.prev, modifiedAt: s.modifiedAt }]))
      set({
        todos: get().todos.map((t) => {
          const saved = prevMap.get(t.id)
          return saved ? { ...t, [field]: saved.prev, modifiedAt: saved.modifiedAt } : t
        }),
      })
    },
    label,
    {
      description: label,
      redo: () => bulkUpdateField(ids, field, value, label, get, set, opts),
      undo: async () => {
        const mutations = prevValues
          .filter((s) => s.prev !== value)
          .map((s) => ({ todoId: s.id, changes: { [field]: s.prev, modifiedAt: s.modifiedAt } }))
        if (mutations.length > 0) {
          await todoRepository.bulkUpdate(mutations)
          const prevMap = new Map(prevValues.map((s) => [s.id, { prev: s.prev, modifiedAt: s.modifiedAt }]))
          set({
            todos: get().todos.map((t) => {
              const saved = prevMap.get(t.id)
              return saved ? { ...t, [field]: saved.prev, modifiedAt: saved.modifiedAt } : t
            }),
          })
        }
      },
      showSnackbar: opts.showSnackbar,
    },
  )
}
