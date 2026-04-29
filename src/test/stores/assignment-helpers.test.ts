import { describe, it, expect } from 'vitest'
import { createAssignmentActions } from '../../stores/assignment-helpers'

interface E { id?: number; name: string }

/**
 * Race regression for `triage-2026-04-28 P4` — QuickAdd `@person` chip
 * not appearing on the new task row. The trigger is a TOCTOU between
 * `loadAssignments` (fired from ListView when `todosVersion` bumps) and
 * `assignPerson` (fired from `applyNlpMetadata` immediately after
 * `todoStore.add`):
 *
 *   1. ListView calls `loadAssignments([newId])`. It snapshots the map,
 *      starts `await repo.getForTodos([newId])`.
 *   2. `assignPerson(newId, alice)` runs in parallel: optimistic write
 *      sets `map[newId] = [alice]`, then `await repo.assign`.
 *   3. `getForTodos` resolves first (its read started before the assign
 *      committed) and returns `{}` for the newly-created task.
 *   4. The buggy code rebuilt `merged` from the pre-await snapshot and
 *      called `setMap(merged)`, clobbering the optimistic entry.
 *
 * The fix re-reads the map after the await and prefers the latest entry
 * over the (possibly stale) DB result.
 */
function defer<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve: resolve! }
}

function makeActions(initialEntities: E[] = []) {
  const fetchGate = defer<Map<number, E[]>>()
  const assignGate = defer<void>()
  let map = new Map<number, E[]>()
  const repo = {
    async assign(_todoId: number, _entityId: number) {
      await assignGate.promise
    },
    async unassign() { /* unused */ },
    async getForTodos(_todoIds: number[]) {
      return fetchGate.promise
    },
  }
  const actions = createAssignmentActions<E>(
    { repo, label: 'test', getName: (e) => e.name },
    () => initialEntities,
    () => map,
    (m) => { map = m },
    (() => {}) as never,
  )
  return {
    actions,
    fetchGate,
    assignGate,
    getMap: () => map,
  }
}

describe('createAssignmentActions.loadAssignments', () => {
  it('preserves optimistic assignments that land during the DB fetch (P4 race)', async () => {
    const alice: E = { id: 1, name: 'Alice' }
    const ctx = makeActions([alice])

    // Step 1: ListView-style load fires for the new todo id 42.
    const loadPromise = ctx.actions.loadAssignments([42])

    // Step 2: applyNlpMetadata-style assign fires before loadAssignments
    // resolves. The optimistic write happens synchronously inside
    // `optimistic(...)`, before `repo.assign` awaits.
    const assignPromise = ctx.actions.assign(42, 1)
    // Yield once so the optimistic update inside `optimistic.apply()` runs
    // before we resolve the fetch gate.
    await Promise.resolve()
    expect(ctx.getMap().get(42)).toEqual([alice])

    // Step 3: DB read resolves with an empty result — its snapshot
    // predates the assign's DB commit. Buggy implementation would now
    // rebuild merged from the pre-await snapshot and clobber map[42].
    ctx.fetchGate.resolve(new Map())
    await loadPromise

    // After loadAssignments completes, the optimistic entry must
    // survive — the rebuild must re-read latest map state, not the
    // pre-await snapshot.
    expect(ctx.getMap().get(42)).toEqual([alice])

    ctx.assignGate.resolve()
    await assignPromise
    expect(ctx.getMap().get(42)).toEqual([alice])
  })

  it('records empty arrays for ids with no assignments (memoization contract)', async () => {
    const ctx = makeActions([])
    const loadPromise = ctx.actions.loadAssignments([7, 9])
    ctx.fetchGate.resolve(new Map())
    await loadPromise
    // Both ids should now be in the map with empty arrays so subsequent
    // loadAssignments calls short-circuit instead of refetching.
    expect(ctx.getMap().has(7)).toBe(true)
    expect(ctx.getMap().has(9)).toBe(true)
    expect(ctx.getMap().get(7)).toEqual([])
    expect(ctx.getMap().get(9)).toEqual([])
  })

  it('uses fetched data for ids that had no optimistic write', async () => {
    const alice: E = { id: 1, name: 'Alice' }
    const ctx = makeActions([alice])
    const loadPromise = ctx.actions.loadAssignments([42])
    ctx.fetchGate.resolve(new Map([[42, [alice]]]))
    await loadPromise
    expect(ctx.getMap().get(42)).toEqual([alice])
  })

  it('prunes stale entries that are no longer in todoIds', async () => {
    const alice: E = { id: 1, name: 'Alice' }
    const ctx = makeActions([alice])
    // Pre-populate map[99] = [alice]; load only id 42 — 99 should drop.
    const loadFirst = ctx.actions.loadAssignments([99])
    ctx.fetchGate.resolve(new Map([[99, [alice]]]))
    await loadFirst
    expect(ctx.getMap().get(99)).toEqual([alice])

    const ctx2 = makeActions([alice])
    // Reuse map state from ctx into ctx2 isn't possible; instead, set up a
    // fresh ctx with an existing pre-populated entry directly via assign.
    ctx2.assignGate.resolve()
    await ctx2.actions.assign(99, 1)
    expect(ctx2.getMap().get(99)).toEqual([alice])

    const load2 = ctx2.actions.loadAssignments([42])
    ctx2.fetchGate.resolve(new Map())
    await load2
    expect(ctx2.getMap().has(99)).toBe(false)
    expect(ctx2.getMap().has(42)).toBe(true)
  })
})
