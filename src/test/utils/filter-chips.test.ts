import { describe, it, expect } from 'vitest'
import type { Person, Status, Tag } from '../../models'
import { emptyPredicate } from '../../models'
import { predicateToCriteria } from '../../utils/filter-criteria'
import {
  clearChipField,
  describeAnchor,
  describeFilters,
  describeRange,
  filterChips,
  hasNarrowingFilters,
  type FilterChipNames,
} from '../../utils/filter-chips'
import { choicesWith, listOptionsSummary } from '../../utils/list-options'

const people: Person[] = [{ id: 1, name: 'Alice', initials: 'A' }, { id: 2, name: 'Bob', initials: 'B' }, { id: 3, name: 'Cy', initials: 'C' }]
const tags: Tag[] = [{ id: 1, name: 'q4', color: '#36c' }, { id: 2, name: 'home', color: '#c84' }]
const statuses: Status[] = [{ id: 1, name: 'Waiting', color: '#aa0', sortOrder: 0 }]
const names: FilterChipNames = { people, tags, statuses }

describe('filterChips', () => {
  it('no filter → no chips', () => {
    expect(filterChips(emptyPredicate(), names)).toEqual([])
    expect(hasNarrowingFilters({ ...emptyPredicate(), showCompleted: true })).toBe(false)
  })

  it('one chip per field, in chip order (Markers, Tags, People, Dates, Status, Text), with value text', () => {
    const p = {
      ...emptyPredicate(),
      searchText: ' invoice ',
      statusIds: [1],
      personIds: [1, 2, 3],
      markers: { important: true as const },
      tags: [1],
      dates: { deadline: { match: 'range' as const, start: { kind: 'relative' as const, token: 'today' as const }, end: { kind: 'offset' as const, days: 14 } } },
    }
    expect(filterChips(p, names)).toEqual([
      { field: 'markers', label: 'Priority', value: 'Important' },
      { field: 'tags', label: 'Tags', value: '#q4' },
      { field: 'people', label: 'People', value: 'Alice +2' },
      { field: 'dates', label: 'Due', value: 'within 14 days' },
      { field: 'status', label: 'Status', value: 'Waiting' },
      { field: 'text', label: 'Text', value: '“invoice”' },
    ])
    expect(hasNarrowingFilters(p)).toBe(true)
  })

  it('names sentinels and empty picks', () => {
    const p = { ...emptyPredicate(), personIds: [0, 2], statusIds: [] as number[] }
    const chips = filterChips(p, names)
    expect(chips[0]!.value).toBe('Unassigned +1')
    expect(chips[1]!.value).toBe('none')
    const zeros = filterChips({ ...emptyPredicate(), tags: [0, 1], statusIds: [0] }, names)
    expect(zeros.map((c) => c.value)).toEqual(['Untagged +1', 'No status'])
  })

  it('screen criteria take the same path; completed shows only when asked', () => {
    const c = predicateToCriteria({ ...emptyPredicate(), showCompleted: true, tags: [2] })
    expect(filterChips(c, names)).toEqual([{ field: 'tags', label: 'Tags', value: '#home' }])
    expect(filterChips(c, names, true).map((x) => x.field)).toEqual(['tags', 'completed'])
  })

  it('one date type reads as its name and clause; several as Dates and each type’s clause', () => {
    expect(filterChips({ ...emptyPredicate(), dates: { followup: { match: 'unset' } } }, names)).toEqual([
      { field: 'dates', label: 'Follow-up', value: 'no date' },
    ])
    expect(filterChips({ ...emptyPredicate(), dates: { deadline: { match: 'set' } } }, names)).toEqual([
      { field: 'dates', label: 'Due', value: 'has a date' },
    ])
    const week = { kind: 'offset' as const, days: 7 }
    const today = { kind: 'offset' as const, days: 0 }
    expect(filterChips({ ...emptyPredicate(), dates: { deadline: { match: 'range', start: today, end: week, includeNoDate: true } } }, names)).toEqual([
      { field: 'dates', label: 'Due', value: 'within 7 days, or none' },
    ])
    expect(filterChips({
      ...emptyPredicate(),
      dates: { created: { match: 'range', start: { kind: 'relative', token: 'start-of-month' }, end: null }, deadline: { match: 'range', start: today, end: week } },
    }, names)).toEqual([
      { field: 'dates', label: 'Dates', value: 'Due within 7 days, Created from start of month' },
    ])
    // A range with no end filters nothing: no chip.
    expect(filterChips({ ...emptyPredicate(), dates: { deadline: { match: 'range', start: null, end: null } } }, names)).toEqual([])
    expect(hasNarrowingFilters({ ...emptyPredicate(), dates: { deadline: { match: 'range', start: null, end: null } } })).toBe(false)
  })

  it('a Markers clause reads the first marker (+N), first among the chips', () => {
    expect(filterChips({ ...emptyPredicate(), markers: { focus: true } }, names)).toEqual([
      { field: 'markers', label: 'Priority', value: 'Focus' },
    ])
    expect(filterChips({ ...emptyPredicate(), markers: { focus: true, urgent: true }, searchText: 'x', statusIds: [1] }, names).map((c) => c.field))
      .toEqual(['markers', 'status', 'text'])
    // Display order is Focus › Urgent › Important, whatever the stored order.
    expect(filterChips({ ...emptyPredicate(), markers: { focus: true, urgent: true } }, names)[0]!.value).toBe('Focus +1')
    expect(hasNarrowingFilters({ ...emptyPredicate(), markers: { important: true } })).toBe(true)
    expect(hasNarrowingFilters({ ...emptyPredicate(), markers: {} })).toBe(false)
    expect(filterChips({ ...emptyPredicate(), markers: {} }, names)).toEqual([])
  })

  it('a Hot Markers clause reads Hot and narrows', () => {
    expect(filterChips({ ...emptyPredicate(), markers: 'hot' }, names)).toEqual([
      { field: 'markers', label: 'Priority', value: 'Hot' },
    ])
    expect(hasNarrowingFilters({ ...emptyPredicate(), markers: 'hot' })).toBe(true)
    expect(clearChipField({ ...emptyPredicate(), markers: 'hot' }, 'markers')).toMatchObject({ markers: null })
  })

  it('describeFilters joins chips in words', () => {
    const p = { ...emptyPredicate(), statusIds: [1], dates: { followup: { match: 'range' as const, start: null, end: { kind: 'relative' as const, token: 'end-of-week' as const } } } }
    expect(describeFilters(filterChips(p, names))).toBe('Follow-up by end of week · Status Waiting')
  })
})

describe('describeAnchor / describeRange', () => {
  it('words each anchor kind', () => {
    expect(describeAnchor({ kind: 'offset', days: 0 })).toBe('today')
    expect(describeAnchor({ kind: 'offset', days: 1 })).toBe('in 1 day')
    expect(describeAnchor({ kind: 'offset', days: -3 })).toBe('3 days ago')
    expect(describeAnchor({ kind: 'relative', token: 'start-of-next-week' })).toBe('start of next week')
    expect(describeAnchor({ kind: 'fixed', iso: new Date(2026, 9, 15).toISOString() })).toBe('Oct 15')
  })

  it('words ranges', () => {
    expect(describeRange({ kind: 'offset', days: 0 }, { kind: 'offset', days: 7 })).toBe('within 7 days')
    expect(describeRange(null, { kind: 'relative', token: 'today' })).toBe('by today')
    expect(describeRange({ kind: 'relative', token: 'tomorrow' }, null)).toBe('from tomorrow')
    expect(describeRange({ kind: 'relative', token: 'start-of-week' }, { kind: 'relative', token: 'end-of-week' })).toBe('start of week – end of week')
    expect(describeRange(null, null)).toBe('')
  })
})

describe('clearChipField', () => {
  it('clears exactly the chip’s clauses', () => {
    const p = {
      ...emptyPredicate(),
      personIds: [1], tags: [2], statusIds: [1], searchText: 'x',
      dates: { deadline: { match: 'range' as const, start: { kind: 'offset' as const, days: 0 }, end: null, includeNoDate: true }, followup: { match: 'unset' as const } },
      markers: { urgent: true as const },
    }
    expect(clearChipField(p, 'people').personIds).toBeNull()
    expect(clearChipField(p, 'tags').tags).toBeNull()
    expect(clearChipField(p, 'status').statusIds).toBeNull()
    expect(clearChipField(p, 'text').searchText).toBe('')
    expect(clearChipField(p, 'markers')).toMatchObject({ markers: null, personIds: [1] })
    const dates = clearChipField(p, 'dates')
    expect(dates).toMatchObject({ dates: {}, personIds: [1], markers: { urgent: true } })
  })
})

describe('list options helpers', () => {
  it('choicesWith keeps a stored value that is no longer offered', () => {
    expect(choicesWith(['a', 'b'], 'b')).toEqual(['a', 'b'])
    expect(choicesWith(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
  })

  it('summarises group and sort', () => {
    expect(listOptionsSummary('people', 'deadline')).toBe('People · Due date')
    expect(listOptionsSummary('none', 'manual')).toBe('No groups · Manual')
  })
})
