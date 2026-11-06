import { describe, expect, it } from 'vitest'
import type { PersistedListDefinition } from '../../../models/list-definition'
import type { TodoPredicate } from '../../../models'
import type { FilterCriteria } from '../../../utils/filter-criteria'
import { computeListTileCounts, isListTileEligible } from '../../../services/stats/list-tiles'
import { emptyFilterCriteria, makePerson, makeTodo, lookupsFor } from '../../helpers'

const today = new Date(2026, 9, 10)
const alice = makePerson({ id: 1, name: 'Alice' })
const bob = makePerson({ id: 2, name: 'Bob' })
const NONE: FilterCriteria = { ...emptyFilterCriteria, markers: null }

const basePredicate: TodoPredicate = {
  showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null,
}

function list(id: number, predicate: Partial<TodoPredicate>, extra: Partial<PersistedListDefinition> = {}): PersistedListDefinition {
  return {
    id, name: `List ${id}`, sortOrder: id, sort: 'manual', grouping: 'none', 
    membership: { kind: 'custom', predicate: { ...basePredicate, ...predicate } },
    ...extra,
  }
}

const tasks = [
  makeTodo({ id: 1 }),
  makeTodo({ id: 2, urgent: true, important: true }),
  makeTodo({ id: 3, isCompleted: true }),
  makeTodo({ id: 4, dueDate: new Date(2026, 9, 11), important: true }),
]
const lookups = lookupsFor({ assignedPeopleMap: new Map([[1, [alice, bob]], [2, [alice]], [3, [alice]]]) })
const opts = (screen?: FilterCriteria, urgentRange: number | null = 3) => ({
  screen, lookups, today, weekStartsOn: 1 as const, markerSettings: { urgentRange },
})

describe('computeListTileCounts', () => {
  it('counts members by the list filter alone without a screen filter; skips prompted lists; keeps tile order', () => {
    const defs = [list(2, { personIds: [1] }), list(1, {}), list(3, {}, { runtimeFilter: { field: 'person' } })]
    expect(computeListTileCounts(defs, tasks, opts()).map((c) => [c.id, c.shown, c.total])).toEqual([[2, 2, 2], [1, 3, 3]])
    expect(isListTileEligible(defs[2]!)).toBe(false)
    expect(isListTileEligible(defs[0]!)).toBe(true)
  })

  it('composes the screen filter strictly: screen @Bob + list @Alice = tasks assigned to both', () => {
    const counts = computeListTileCounts([list(1, { personIds: [1] })], tasks, opts({ ...NONE, personIds: new Set([2]) }))
    expect(counts).toEqual([{ id: 1, name: 'List 1', shown: 1, total: 2 }])
  })

  it('the screen’s Show completed brings the list’s completed members in, as the list widget shows them (cr31 filters F2)', () => {
    const screen = { ...NONE, showCompleted: true }
    expect(computeListTileCounts([list(1, {})], tasks, opts(screen))[0]).toMatchObject({ shown: 4, total: 4 })
    expect(computeListTileCounts([list(1, { showCompleted: true })], tasks, opts(screen))[0]).toMatchObject({ shown: 4, total: 4 })
    // No screen filter: the list's own Show completed alone.
    expect(computeListTileCounts([list(1, {})], tasks, opts(NONE))[0]).toMatchObject({ shown: 3, total: 3 })
  })

  it('a Completed range on the screen (a "Done this week" lens or chip) counts the completed members it keeps, of every member it lets through', () => {
    const done = [
      makeTodo({ id: 1 }),
      makeTodo({ id: 2 }),
      makeTodo({ id: 3, isCompleted: true, completedAt: new Date(2026, 9, 9) }),
      makeTodo({ id: 4, isCompleted: true, completedAt: new Date(2026, 8, 1) }),
    ]
    const thisWeek = { match: 'range' as const, start: { kind: 'relative' as const, token: 'start-of-week' as const }, end: { kind: 'relative' as const, token: 'today' as const } }
    const screen = { ...NONE, dates: { completed: thisWeek } }
    expect(computeListTileCounts([list(1, {})], done, opts(screen))[0]).toMatchObject({ shown: 1, total: 4 })
  })

  it('an "is not" list counts the tasks without the ticked values, composed with an "is not" screen filter', () => {
    // People is not Bob: 2 (Alice) and 4 (nobody).
    const notBob = list(1, { personIds: [2], negate: { personIds: true } })
    expect(computeListTileCounts([notBob], tasks, opts())[0]).toMatchObject({ shown: 2, total: 2 })
    // Screen: People is not Unassigned (has someone) — leaves 2.
    const screen = { ...NONE, personIds: new Set([0]), negate: { personIds: true as const } }
    expect(computeListTileCounts([notBob], tasks, opts(screen))[0]).toMatchObject({ shown: 1, total: 2 })
  })

  it('Priority clauses use the given settings (the urgent range)', () => {
    const hot = list(1, { markers: [{ values: ['focus' as const, 'urgent' as const] }, { values: ['focus' as const, 'important' as const] }] })
    expect(computeListTileCounts([hot], tasks, opts(undefined, 3))[0]).toMatchObject({ total: 2 })
    expect(computeListTileCounts([hot], tasks, opts(undefined, null))[0]).toMatchObject({ total: 1 })
  })

  it('a Priority No counts the tasks without that marker (Urgent No: not urgent by flag or by due date)', () => {
    // Open tasks: 1 (none), 2 (urgent + important), 4 (important, due tomorrow).
    expect(computeListTileCounts([list(1, { markers: [{ values: ['important' as const], not: true as const }] })], tasks, opts())[0]).toMatchObject({ total: 1 })
    expect(computeListTileCounts([list(1, { markers: [{ values: ['urgent' as const], not: true as const }] })], tasks, opts(undefined, 3))[0]).toMatchObject({ total: 1 })
    expect(computeListTileCounts([list(1, { markers: [{ values: ['urgent' as const], not: true as const }] })], tasks, opts(undefined, null))[0]).toMatchObject({ total: 2 })
    // Screen Important Yes + list Urgent No: task 4 only while it isn't urgent by its due date.
    const screen = { ...NONE, markers: [{ values: ['important' as const] }] }
    expect(computeListTileCounts([list(1, { markers: [{ values: ['urgent' as const], not: true as const }] })], tasks, opts(screen, null))[0]).toMatchObject({ shown: 1, total: 2 })
  })

  it('no lists, or no tasks, gives no / zero counts', () => {
    expect(computeListTileCounts([], tasks, opts())).toEqual([])
    expect(computeListTileCounts([list(1, {})], [], opts(NONE))[0]).toMatchObject({ shown: 0, total: 0 })
  })
})
