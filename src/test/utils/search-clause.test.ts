import { describe, it, expect } from 'vitest'
import { sameSearchField, searchFieldValue, withSearchClause, withSearchFieldValue } from '../../utils/search-clause'
import type { FilterCriteria } from '../../utils/filter-criteria'

const empty: FilterCriteria = {
  showCompleted: false,
  personIds: null,
  statusIds: null,
  searchText: '',
  dates: {},
  markers: null,
  tags: null,
}

describe('search-clause', () => {
  it('an id joins its field (OR)', () => {
    const one = withSearchClause(empty, { field: 'personIds', id: 1 })
    const two = withSearchClause(one, { field: 'personIds', id: 2 })
    expect(two.personIds).toEqual(new Set([1, 2]))
  })

  it('an "is not" field becomes "is" the token', () => {
    const f: FilterCriteria = { ...empty, tags: new Set([5]), negate: { tags: true } }
    const next = withSearchClause(f, { field: 'tags', id: 6 })
    expect(next.tags).toEqual(new Set([6]))
    expect(next.negate?.tags).toBeUndefined()
  })

  it('markers join; Hot replaces them; a marker replaces Hot', () => {
    const urgent = withSearchClause(empty, { field: 'markers', marker: 'urgent' })
    expect(withSearchClause(urgent, { field: 'markers', marker: 'focus' }).markers).toEqual({ urgent: true, focus: true })
    const hot = withSearchClause(urgent, { field: 'markers', marker: 'hot' })
    expect(hot.markers).toBe('hot')
    expect(withSearchClause(hot, { field: 'markers', marker: 'important' }).markers).toEqual({ important: true })
  })

  it('a date replaces that type\'s clause only', () => {
    const f: FilterCriteria = { ...empty, dates: { deadline: { match: 'set' }, followup: { match: 'set' } } }
    const next = withSearchClause(f, { field: 'deadline', match: { match: 'unset' } })
    expect(next.dates).toEqual({ deadline: { match: 'unset' }, followup: { match: 'set' } })
  })

  it('done turns Show completed on', () => {
    expect(withSearchClause(empty, { field: 'showCompleted' }).showCompleted).toBe(true)
  })

  it('a field\'s snapshot puts it back', () => {
    const f: FilterCriteria = { ...empty, statusIds: new Set([3]), negate: { statusIds: true } }
    const snapshot = searchFieldValue(f, 'statusIds')
    const changed = withSearchClause(f, { field: 'statusIds', id: 4 })
    const back = withSearchFieldValue(changed, snapshot)
    expect(back.statusIds).toEqual(new Set([3]))
    expect(back.negate?.statusIds).toBe(true)
    expect(sameSearchField(back, f, 'statusIds')).toBe(true)
    expect(sameSearchField(changed, f, 'statusIds')).toBe(false)
  })
})
