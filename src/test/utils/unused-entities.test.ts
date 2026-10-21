import { describe, it, expect } from 'vitest'
import { emptyPredicate, type ListDefinition, type Person, type TodoPredicate } from '../../models'
import {
  entityTaskUse,
  filterReferences,
  findUnused,
  removeConfirmLines,
  removeEntitiesDescription,
  unusedEntryNote,
  type FilterSources,
  type UnusedEntry,
} from '../../utils/unused-entities'

const ann: Person = { id: 1, name: 'Ann', initials: 'AN' }
const bob: Person = { id: 2, name: 'Bob', initials: 'BO' }
const cal: Person = { id: 3, name: 'Cal', initials: 'CA' }

function list(id: number, predicate: Partial<TodoPredicate>, owner: ListDefinition['owner'] = { layoutId: 1 }): ListDefinition {
  return {
    id,
    name: `List ${id}`,
    sortOrder: id,
    membership: { kind: 'custom', predicate: { ...emptyPredicate(), ...predicate } },
    sort: 'manual',
    grouping: 'none',
    owner,
  }
}

function sources(over: Partial<FilterSources> = {}): FilterSources {
  return { lists: [], panes: {}, checkinFilter: emptyPredicate(), ...over }
}

describe('entityTaskUse', () => {
  it('counts open tasks and lists completed ones per entity', () => {
    const todos = [{ id: 1, isCompleted: false }, { id: 2, isCompleted: true }, { id: 3, isCompleted: true }]
    const map = new Map<number, Person[]>([[1, [ann]], [2, [ann, bob]], [3, [bob]]])
    const use = entityTaskUse(todos, map)
    expect(use.get(1)).toEqual({ open: 1, completedTodoIds: [2] })
    expect(use.get(2)).toEqual({ open: 0, completedTodoIds: [2, 3] })
    expect(use.has(3)).toBe(false)
  })

  it('a task no longer there (deleted meanwhile) counts for nothing, even if the map still holds it', () => {
    const map = new Map<number, Person[]>([[1, [ann]], [99, [bob]]])
    const use = entityTaskUse([{ id: 1, isCompleted: false }], map)
    expect(use.has(2)).toBe(false)
  })
})

describe('findUnused', () => {
  const todos = [{ id: 1, isCompleted: false }, { id: 2, isCompleted: true }]
  const use = entityTaskUse(todos, new Map<number, Person[]>([[1, [ann]], [2, [bob]]]))

  it('lists the people no task carries, by name', () => {
    const out = findUnused([cal, ann, bob], use, new Map(), false)
    expect(out.map((e) => e.entity.name)).toEqual(['Cal'])
  })

  it('ignoring completed tasks also lists those only completed tasks carry, with those tasks', () => {
    const out = findUnused([cal, ann, bob], use, new Map(), true)
    expect(out.map((e) => [e.entity.name, e.completedTodoIds])).toEqual([['Bob', [2]], ['Cal', []]])
  })
})

describe('filterReferences', () => {
  it('finds people in a list filter, "is" or "is not", the Eisenhower’s own list included, ignoring the unassigned sentinel', () => {
    const refs = filterReferences(sources({
      lists: [
        list(1, { personIds: [1, 0] }),
        list(2, { personIds: [1, 2], negate: { personIds: true } }),
        list(3, { personIds: [3] }, { eisenhower: true }),
      ],
    }), 'person')
    expect(refs.get(1)).toEqual({ lists: 2, panes: 0, checkin: false })
    expect(refs.get(2)).toEqual({ lists: 1, panes: 0, checkin: false })
    expect(refs.get(3)).toEqual({ lists: 1, panes: 0, checkin: false })
    expect(refs.has(0)).toBe(false)
  })

  it('a list counts once whether its saved filter or its unsaved edit names the entry', () => {
    const saved = list(1, { tags: [10] })
    const draft = list(1, { tags: [10, 11] })
    const refs = filterReferences(sources({ lists: [saved], drafts: { 1: draft } }), 'tag')
    expect(refs.get(10)?.lists).toBe(1)
    expect(refs.get(11)?.lists).toBe(1)
  })

  it('finds tags in Eisenhower pane filters and the check-in filter', () => {
    const refs = filterReferences(sources({
      panes: {
        do: { filter: { ...emptyPredicate(), tags: [10] } },
        drop: { filter: { ...emptyPredicate(), tags: [10], negate: { tags: true } } },
        schedule: { name: 'Later' },
      },
      checkinFilter: { ...emptyPredicate(), tags: [11] },
    }), 'tag')
    expect(refs.get(10)).toEqual({ lists: 0, panes: 2, checkin: false })
    expect(refs.get(11)).toEqual({ lists: 0, panes: 0, checkin: true })
  })

  it('a people filter names no tag, and the other way round', () => {
    const s = sources({ lists: [list(1, { personIds: [10] })] })
    expect(filterReferences(s, 'tag').size).toBe(0)
  })
})

describe('notes and the confirm', () => {
  const entry = (id: number, completedTodoIds: number[] = [], refs?: UnusedEntry<unknown>['refs']): UnusedEntry<unknown> =>
    ({ id, entity: null, completedTodoIds, ...(refs ? { refs } : {}) })

  it('a row’s note names its completed tasks and the filters naming it', () => {
    expect(unusedEntryNote(entry(1))).toBe('')
    expect(unusedEntryNote(entry(1, [5]))).toBe('on 1 completed task')
    expect(unusedEntryNote(entry(1, [5, 6], { lists: 2, panes: 1, checkin: true })))
      .toBe('on 2 completed tasks · in 2 list filters · in an Eisenhower pane · in the check-in filter')
    expect(unusedEntryNote(entry(1, [], { lists: 1, panes: 2, checkin: false }))).toBe('in a list filter · in 2 Eisenhower panes')
  })

  it('the undo step names what goes', () => {
    expect(removeEntitiesDescription(3, 2)).toBe('Remove 3 people and 2 tags')
    expect(removeEntitiesDescription(1, 0)).toBe('Remove 1 person')
    expect(removeEntitiesDescription(0, 1)).toBe('Remove 1 tag')
  })

  it('the confirm counts distinct completed tasks and the entries filters name', () => {
    const lines = removeConfirmLines(
      [entry(1, [5, 6], { lists: 1, panes: 0, checkin: false }), entry(2)],
      [entry(10, [6, 7], { lists: 0, panes: 1, checkin: false })],
    )
    expect(lines).toEqual({
      question: 'Remove 2 people and 1 tag?',
      completed: 'They’re removed from 3 completed tasks.',
      filters: '2 are named in filters, which will stop matching them.',
      undo: 'You can undo this.',
    })
    const one = removeConfirmLines([entry(1, [5], { lists: 1, panes: 0, checkin: false })], [])
    expect(one.completed).toBe('It’s removed from 1 completed task.')
    expect(one.filters).toBe('1 is named in filters, which will stop matching it.')
    const plain = removeConfirmLines([], [entry(10)])
    expect(plain.completed).toBeNull()
    expect(plain.filters).toBeNull()
  })
})
