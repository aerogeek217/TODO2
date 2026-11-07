import { describe, expect, it } from 'vitest'
import type { Person, Tag } from '../../../models'
import { numberBreakdown } from '../../../services/stats/number-breakdown'

const ana: Person = { id: 1, name: 'Ana', initials: 'AN', color: '#a00' }
const ben: Person = { id: 2, name: 'Ben', initials: 'BE' }
const q4: Tag = { id: 7, name: 'q4', color: '#0a0' }
const home: Tag = { id: 8, name: 'home', color: '#00a' }

const ctx = {
  assignedPeopleMap: new Map<number, readonly Person[]>([[1, [ana]], [2, [ana, ben]], [3, [ben]], [4, []]]),
  assignedTagsMap: new Map<number, readonly Tag[]>([[1, [q4, home]], [3, [q4]]]),
}

describe('numberBreakdown', () => {
  it('none: nothing', () => {
    expect(numberBreakdown([1, 2, 3], 'none', ctx)).toEqual([])
  })

  it('by person: most first, ties by name, a task with two people in both; Unassigned last', () => {
    expect(numberBreakdown([1, 2, 3, 4, 5], 'people', ctx)).toEqual([
      { key: '1', label: 'Ana', color: '#a00', ids: [1, 2] },
      { key: '2', label: 'Ben', ids: [2, 3] },
      { key: 'none', label: 'Unassigned', ids: [4, 5] },
    ])
  })

  it('by tag: `#name` in the tag’s colour; No tag last, only when there is one', () => {
    expect(numberBreakdown([1, 2, 3], 'tags', ctx)).toEqual([
      { key: '7', label: '#q4', color: '#0a0', ids: [1, 3] },
      { key: '8', label: '#home', color: '#00a', ids: [1] },
      { key: 'none', label: 'No tag', ids: [2] },
    ])
    expect(numberBreakdown([1, 3], 'tags', ctx).map((e) => e.key)).toEqual(['7', '8'])
  })

  it('no tasks: nothing', () => {
    expect(numberBreakdown([], 'people', ctx)).toEqual([])
  })
})
