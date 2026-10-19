import { describe, it, expect } from 'vitest'
import type { Person, Status, Tag } from '../../models'
import type { ListDefinition } from '../../models/list-definition'
import { emptyPredicate } from '../../models'
import { expectWithin } from '../timing'
import { predicateToCriteria } from '../../utils/filter-criteria'
import {
  chipKey,
  clearChipField,
  datesSpokenValue,
  datesTooltip,
  datesValue,
  describeAnchor,
  describeFilters,
  describeRange,
  filterChips,
  hasNarrowingFilters,
  type FilterChipNames,
} from '../../utils/filter-chips'
import { choicesWith, groupSortSummary, sortOrderWords, withListSort, withSortDirection } from '../../utils/list-options'

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
      { field: 'dates', dateField: 'deadline', label: 'Due', value: 'within 14 days' },
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

  it('one chip per date type that filters, in tab order (Due · Follow-up · Created · Modified)', () => {
    expect(filterChips({ ...emptyPredicate(), dates: { followup: { match: 'unset' } } }, names)).toEqual([
      { field: 'dates', dateField: 'followup', label: 'Follow-up', value: 'no date' },
    ])
    expect(filterChips({ ...emptyPredicate(), dates: { deadline: { match: 'set' } } }, names)).toEqual([
      { field: 'dates', dateField: 'deadline', label: 'Due', value: 'has a date' },
    ])
    const week = { kind: 'offset' as const, days: 7 }
    const today = { kind: 'offset' as const, days: 0 }
    expect(filterChips({ ...emptyPredicate(), dates: { deadline: { match: 'range', start: today, end: week, includeNoDate: true } } }, names)).toEqual([
      { field: 'dates', dateField: 'deadline', label: 'Due', value: 'within 7 days, or none' },
    ])
    expect(filterChips({
      ...emptyPredicate(),
      statusIds: [1],
      tags: [1],
      dates: {
        modified: { match: 'range', start: null, end: { kind: 'relative', token: 'today' } },
        created: { match: 'range', start: { kind: 'relative', token: 'start-of-month' }, end: null },
        deadline: { match: 'range', start: today, end: week },
      },
    }, names)).toEqual([
      { field: 'tags', label: 'Tags', value: '#q4' },
      { field: 'dates', dateField: 'deadline', label: 'Due', value: 'within 7 days' },
      { field: 'dates', dateField: 'created', label: 'Created', value: 'from start of month' },
      { field: 'dates', dateField: 'modified', label: 'Modified', value: 'by today' },
      { field: 'status', label: 'Status', value: 'Waiting' },
    ])
    // A range with no end filters nothing: no chip.
    expect(filterChips({ ...emptyPredicate(), dates: { deadline: { match: 'range', start: null, end: null } } }, names)).toEqual([])
    expect(hasNarrowingFilters({ ...emptyPredicate(), dates: { deadline: { match: 'range', start: null, end: null } } })).toBe(false)
  })

  it('a chip’s key is unique per date type', () => {
    const chips = filterChips({ ...emptyPredicate(), personIds: [1], dates: { deadline: { match: 'set' }, followup: { match: 'unset' } } }, names)
    expect(chips.map(chipKey)).toEqual(['people', 'dates:deadline', 'dates:followup'])
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
    const two = { ...emptyPredicate(), dates: { deadline: { match: 'set' as const }, created: { match: 'range' as const, start: { kind: 'relative' as const, token: 'start-of-month' as const }, end: null } } }
    expect(describeFilters(filterChips(two, names))).toBe('Due has a date · Created from start of month')
  })
})

describe('filterChips on a list with many ids', () => {
  const many = (n: number): Person[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, initials: 'P' }))

  it('an "is not" tooltip spells out ten names and counts the rest', () => {
    const crowd = many(25)
    const [chip] = filterChips(
      { ...emptyPredicate(), personIds: crowd.map((p) => p.id!), negate: { personIds: true } },
      { people: crowd, tags: [], statuses: [] },
    )
    expect(chip?.value).toBe('not P1 +24')
    expect(chip?.tooltip).toBe('People: not P1, P2, P3, P4, P5, P6, P7, P8, P9, P10 and 15 more\nHides tasks assigned to any of them')
  })

  it('stays fast: 20,000 ids against 20,000 people (one lookup map, not a scan per id)', () => {
    const crowd = many(20_000)
    // Ids of nobody make every scan go to the end.
    const ids = crowd.map((p) => p.id! + 20_000)
    expectWithin(500, () => {
      const [chip] = filterChips({ ...emptyPredicate(), personIds: ids, negate: { personIds: true } }, { people: crowd, tags: [], statuses: [] })
      expect(chip?.value).toBe('not none')
    })
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

  it('a date chip clears only its date type', () => {
    const p = {
      ...emptyPredicate(),
      personIds: [1],
      dates: { deadline: { match: 'set' as const }, followup: { match: 'unset' as const }, created: { match: 'range' as const, start: { kind: 'offset' as const, days: -7 }, end: null } },
    }
    expect(clearChipField(p, 'dates', 'followup')).toMatchObject({
      personIds: [1],
      dates: { deadline: { match: 'set' }, created: { match: 'range', start: { kind: 'offset', days: -7 }, end: null } },
    })
    expect(clearChipField(p, 'dates', 'followup').dates).not.toHaveProperty('followup')
    expect(clearChipField(p, 'dates', 'modified').dates).toEqual(p.dates)
  })
})

describe('the Dates value (top-bar button, Filters menu, phone sheet)', () => {
  const today = { kind: 'relative' as const, token: 'today' as const }
  const nextWeek = { kind: 'relative' as const, token: 'end-of-next-week' as const }
  const due = { match: 'range' as const, start: today, end: nextWeek }
  const created = { match: 'range' as const, start: { kind: 'relative' as const, token: 'start-of-month' as const }, end: null }

  it('is null when no date type filters', () => {
    expect(datesValue({})).toBeNull()
    expect(datesValue({ deadline: { match: 'range', start: null, end: null } })).toBeNull()
    expect(datesTooltip({})).toBeNull()
  })

  it('one type → its clause in words', () => {
    expect(datesValue({ deadline: due })).toBe('Due today – end of next week')
    expect(datesValue({ followup: { match: 'unset' } })).toBe('Follow-up no date')
  })

  it('two types → their short names joined, in tab order', () => {
    expect(datesValue({ created, deadline: due })).toBe('Due + Created')
  })

  it('three or four → the first + N', () => {
    expect(datesValue({ created, deadline: due, modified: created })).toBe('Due + 2')
    expect(datesValue({ followup: { match: 'set' }, created, deadline: due, modified: created })).toBe('Due + 3')
  })

  it('the tooltip lists each type from two on, then how they combine', () => {
    expect(datesTooltip({ deadline: due })).toBeNull()
    expect(datesTooltip({ deadline: due, created })).toBe('Due: today – end of next week\nCreated: from start of month\nTasks must match both · × clears both')
    expect(datesTooltip({ deadline: due, created, followup: { match: 'set' } }))
      .toBe('Due: today – end of next week\nFollow-up: has a date\nCreated: from start of month\nTasks must match all · × clears all')
  })

  it('the spoken value lists every type', () => {
    expect(datesSpokenValue({ deadline: due, created })).toBe('Due today – end of next week; Created from start of month')
    expect(datesSpokenValue({})).toBeNull()
  })
})

describe('list choice helpers', () => {
  it('choicesWith keeps a stored value that is no longer offered', () => {
    expect(choicesWith(['a', 'b'], 'b')).toEqual(['a', 'b'])
    expect(choicesWith(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
  })

  it('summarises group and sort, never "None"', () => {
    expect(groupSortSummary('people', 'deadline')).toBe('People · Due date')
    expect(groupSortSummary('people', 'manual')).toBe('People · Manual')
    // No groups: just the sort (the drag order reads `Manual`).
    expect(groupSortSummary('none', 'priority')).toBe('Priority')
    expect(groupSortSummary('none', 'manual')).toBe('Manual')
  })

  it('a descending sort shows ↓; the natural order shows no arrow; manual never does', () => {
    expect(groupSortSummary('people', 'deadline', 'desc')).toBe('People · Due date ↓')
    expect(groupSortSummary('none', 'name', 'desc')).toBe('Name ↓')
    expect(groupSortSummary('none', 'name', 'asc')).toBe('Name')
    expect(groupSortSummary('none', 'manual', 'desc')).toBe('Manual')
  })

  it('names each sort direction in words', () => {
    expect(sortOrderWords('deadline', 'asc')).toBe('Soonest first')
    expect(sortOrderWords('deadline', 'desc')).toBe('Latest first')
    expect(sortOrderWords('name', 'desc')).toBe('Z → A')
    expect(sortOrderWords('created', 'desc')).toBe('Newest first')
    expect(sortOrderWords('priority', 'desc')).toBe('Lowest priority first')
    expect(sortOrderWords('manual', 'desc')).toBeNull()
  })

  it('a direction carries over to another sort with one and is dropped for Manual; asc is stored as no field', () => {
    expect(withListSort({ sort: 'deadline', sortDirection: 'desc' }, 'name')).toEqual({ sort: 'name', sortDirection: 'desc' })
    expect(withListSort({ sort: 'deadline', sortDirection: 'desc' }, 'manual')).toEqual({ sort: 'manual' })
    const byName: Pick<ListDefinition, 'sort' | 'sortDirection'> = { sort: 'name' }
    expect(withSortDirection(byName, 'desc')).toEqual({ sort: 'name', sortDirection: 'desc' })
    expect(withSortDirection({ ...byName, sortDirection: 'desc' }, 'asc')).toEqual({ sort: 'name' })
  })
})
