import { describe, expect, it } from 'vitest'
import type { PersistedListDefinition } from '../../../models/list-definition'
import type { TodoPredicate } from '../../../models'
import type { FilterCriteria } from '../../../utils/filter-criteria'
import { computeListTileCounts, isListTileEligible } from '../../../services/stats/list-tiles'
import { DEFAULT_HOT_RULE } from '../../../utils/hot'
import { emptyFilterCriteria, makePerson, makeTodo } from '../../helpers'

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
const lookups = { assignedPeopleMap: new Map([[1, [alice, bob]], [2, [alice]], [3, [alice]]]) }
const opts = (screen?: FilterCriteria, urgentRange: number | null = 3) => ({
  screen, lookups, today, weekStartsOn: 1 as const, markerSettings: { urgentRange, hotRule: DEFAULT_HOT_RULE },
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

  it('the screen’s Show completed adds nothing; a list that shows completed tasks counts them', () => {
    const screen = { ...NONE, showCompleted: true }
    expect(computeListTileCounts([list(1, {})], tasks, opts(screen))[0]).toMatchObject({ shown: 3, total: 3 })
    expect(computeListTileCounts([list(1, { showCompleted: true })], tasks, opts(screen))[0]).toMatchObject({ shown: 4, total: 4 })
  })

  it('an "is not" list counts the tasks without the ticked values, composed with an "is not" screen filter', () => {
    // People is not Bob: 2 (Alice) and 4 (nobody).
    const notBob = list(1, { personIds: [2], negate: { personIds: true } })
    expect(computeListTileCounts([notBob], tasks, opts())[0]).toMatchObject({ shown: 2, total: 2 })
    // Screen: People is not Unassigned (has someone) — leaves 2.
    const screen = { ...NONE, personIds: new Set([0]), negate: { personIds: true as const } }
    expect(computeListTileCounts([notBob], tasks, opts(screen))[0]).toMatchObject({ shown: 1, total: 2 })
  })

  it('Markers clauses use the given settings (Hot list, urgent range)', () => {
    const hot = list(1, { markers: 'hot' })
    expect(computeListTileCounts([hot], tasks, opts(undefined, 3))[0]).toMatchObject({ total: 2 })
    expect(computeListTileCounts([hot], tasks, opts(undefined, null))[0]).toMatchObject({ total: 1 })
  })

  it('no lists, or no tasks, gives no / zero counts', () => {
    expect(computeListTileCounts([], tasks, opts())).toEqual([])
    expect(computeListTileCounts([list(1, {})], [], opts(NONE))[0]).toMatchObject({ shown: 0, total: 0 })
  })
})
