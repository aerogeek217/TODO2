import { describe, it, expect } from 'vitest'
import type { Person, Status, Tag } from '../../models'
import type { ListDefinition } from '../../models/list-definition'
import { emptyFilterClauses, emptyPredicate, OR_GROUPS_MAX, type TodoPredicate } from '../../models'
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
  describeDateMatch,
  describeRange,
  chipClauses,
  filterChips,
  hasNarrowingFilters,
  heldFields,
  orValue,
  predicateLineItems,
  removeChip,
  wrapChipInOrGroup,
  type FilterChipNames,
} from '../../utils/filter-chips'
import { choicesWith, groupSortSummary, sortOrderWords, withListSort, withSortDirection } from '../../utils/list-options'
import { isTodoSortBy, sortDirectionOnPick, sortHasDirection } from '../../models/todo-sort-group'

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
      { field: 'people', label: 'People', value: 'Alice, Bob or Cy', tooltip: 'People: Alice, Bob or Cy\nTasks with any of them' },
      { field: 'dates', dateField: 'deadline', label: 'Due', value: 'within the next 14 days' },
      { field: 'status', label: 'Status', value: 'Waiting' },
      { field: 'text', label: 'Text', value: '“invoice”' },
    ])
    expect(hasNarrowingFilters(p)).toBe(true)
  })

  it('names sentinels and empty picks', () => {
    const p = { ...emptyPredicate(), personIds: [0, 2], statusIds: [] as number[] }
    const chips = filterChips(p, names)
    expect(chips[0]!.value).toBe('Unassigned or Bob')
    expect(chips[1]!.value).toBe('none')
    const zeros = filterChips({ ...emptyPredicate(), tags: [0, 1], statusIds: [0] }, names)
    expect(zeros.map((c) => c.value)).toEqual(['No tags or #q4', 'No status'])
  })

  it('No tags: the tags sentinel; "is not No tags" alone reads "has a tag", with what each "is not" hides', () => {
    const [noTags] = filterChips({ ...emptyPredicate(), tags: [0] }, names)
    expect(noTags).toEqual({ field: 'tags', label: 'Tags', value: 'No tags' })
    const [hasTag] = filterChips({ ...emptyPredicate(), tags: [0], negate: { tags: true } }, names)
    expect(hasTag).toEqual({ field: 'tags', label: 'Tags', value: 'has a tag', negated: true, tooltip: 'Tags: has a tag\nHides untagged tasks' })
    const [mixed] = filterChips({ ...emptyPredicate(), tags: [0, 2], negate: { tags: true } }, names)
    expect(mixed!.value).toBe('not No tags or #home')
    expect(mixed!.tooltip).toBe('Tags: not No tags or #home\nHides untagged tasks and tasks with that tag')
  })

  it('screen criteria take the same path; completed shows only when asked', () => {
    const c = predicateToCriteria({ ...emptyPredicate(), showCompleted: true, tags: [2] })
    expect(filterChips(c, names)).toEqual([{ field: 'tags', label: 'Tags', value: '#home' }])
    expect(filterChips(c, names, true).map((x) => x.field)).toEqual(['tags', 'completed'])
  })

  it('one chip per date type that filters, in tab order (Due · Next follow-up · Last follow-up · Completed · Created · Modified)', () => {
    expect(filterChips({ ...emptyPredicate(), dates: { followup: { match: 'unset' } } }, names)).toEqual([
      { field: 'dates', dateField: 'followup', label: 'Next follow-up', value: 'none' },
    ])
    expect(filterChips({ ...emptyPredicate(), dates: { deadline: { match: 'set' } } }, names)).toEqual([
      { field: 'dates', dateField: 'deadline', label: 'Due', value: 'any date' },
    ])
    expect(filterChips({ ...emptyPredicate(), dates: { completed: { match: 'range', start: { kind: 'relative', token: 'start-of-week' }, end: null }, lastFollowup: { match: 'set' } } }, names)).toEqual([
      { field: 'dates', dateField: 'lastFollowup', label: 'Last follow-up', value: 'any date' },
      { field: 'dates', dateField: 'completed', label: 'Completed', value: 'on or after start of week' },
    ])
    const week = { kind: 'offset' as const, days: 7 }
    const today = { kind: 'offset' as const, days: 0 }
    expect(filterChips({ ...emptyPredicate(), dates: { deadline: { match: 'range', start: today, end: week, includeNoDate: true } } }, names)).toEqual([
      { field: 'dates', dateField: 'deadline', label: 'Due', value: 'within the next 7 days, or none' },
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
      { field: 'dates', dateField: 'deadline', label: 'Due', value: 'within the next 7 days' },
      { field: 'dates', dateField: 'created', label: 'Created', value: 'on or after start of month' },
      { field: 'dates', dateField: 'modified', label: 'Modified', value: 'today or earlier' },
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

  it('a Markers clause reads every tested marker, first among the chips', () => {
    expect(filterChips({ ...emptyPredicate(), markers: { focus: true } }, names)).toEqual([
      { field: 'markers', label: 'Priority', value: 'Focus' },
    ])
    expect(filterChips({ ...emptyPredicate(), markers: { focus: true, urgent: true }, searchText: 'x', statusIds: [1] }, names).map((c) => c.field))
      .toEqual(['markers', 'status', 'text'])
    // Display order is Focus › Urgent › Important, whatever the stored order.
    expect(filterChips({ ...emptyPredicate(), markers: { focus: true, urgent: true } }, names)[0]!.value).toBe('Focus, Urgent')
    // A No marker reads `not <marker>`, and the tooltip says what it hides.
    expect(filterChips({ ...emptyPredicate(), markers: { important: false, urgent: true } }, names)[0]).toEqual({
      field: 'markers', label: 'Priority', value: 'Urgent, not Important',
      tooltip: 'Priority: Urgent, not Important\nHides tasks that are Important',
    })
    expect(hasNarrowingFilters({ ...emptyPredicate(), markers: { important: false } })).toBe(true)
    expect(describeFilters(filterChips({ ...emptyPredicate(), markers: { urgent: true, important: false } }, names))).toBe('Priority Urgent, not Important')
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
    expect(describeFilters(filterChips(p, names))).toBe('Next follow-up on or before end of week · Status Waiting')
    const two = { ...emptyPredicate(), dates: { deadline: { match: 'set' as const }, created: { match: 'range' as const, start: { kind: 'relative' as const, token: 'start-of-month' as const }, end: null } } }
    expect(describeFilters(filterChips(two, names))).toBe('Due any date · Created on or after start of month')
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
    expect(chip?.value).toBe('not P1, P2 or 23 more')
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
    // One day either way is its name, as the tokens say it (P7–P8 review).
    expect(describeAnchor({ kind: 'offset', days: 1 })).toBe('tomorrow')
    expect(describeAnchor({ kind: 'offset', days: -1 })).toBe('yesterday')
    expect(describeAnchor({ kind: 'offset', days: 2 })).toBe('in 2 days')
    expect(describeAnchor({ kind: 'offset', days: -3 })).toBe('3 days ago')
    expect(describeAnchor({ kind: 'relative', token: 'start-of-next-week' })).toBe('start of next week')
    expect(describeAnchor({ kind: 'fixed', iso: new Date(2026, 9, 15).toISOString() })).toBe('Oct 15')
  })

  it('words ranges that can’t be misread (cr25 P7): never `up to`, `by` or a bare `from`', () => {
    const off = (days: number) => ({ kind: 'offset' as const, days })
    const tok = (token: 'yesterday' | 'today' | 'tomorrow' | 'start-of-week' | 'end-of-week' | 'start-of-month') => ({ kind: 'relative' as const, token })
    const oct26 = { kind: 'fixed' as const, iso: new Date(2026, 9, 26).toISOString() }
    const cases: [ReturnType<typeof off> | ReturnType<typeof tok> | typeof oct26 | null, ReturnType<typeof off> | ReturnType<typeof tok> | typeof oct26 | null, string][] = [
      // To alone: N or more days ago; yesterday; another day; a date or token.
      [null, off(-7), '7+ days ago'],
      [null, off(-2), '2+ days ago'],
      [null, off(-1), 'before today'],
      [null, tok('yesterday'), 'before today'],
      [null, off(0), 'today or earlier'],
      [null, tok('today'), 'today or earlier'],
      [null, tok('tomorrow'), 'tomorrow or earlier'],
      [null, off(1), 'tomorrow or earlier'],
      [null, off(14), 'in 14 days or earlier'],
      [null, oct26, 'on or before Oct 26'],
      [null, tok('end-of-week'), 'on or before end of week'],
      // From alone: N or more days ahead; tomorrow; another day; a date or token.
      [off(7), null, '7+ days ahead'],
      [off(2), null, '2+ days ahead'],
      [off(1), null, 'after today'],
      [tok('tomorrow'), null, 'after today'],
      [off(0), null, 'today or later'],
      [tok('today'), null, 'today or later'],
      [tok('yesterday'), null, 'yesterday or later'],
      [off(-1), null, 'yesterday or later'],
      [off(-30), null, '30 days ago or later'],
      [oct26, null, 'on or after Oct 26'],
      [tok('start-of-month'), null, 'on or after start of month'],
      // Today and a day offset: the direction said.
      [off(0), off(14), 'within the next 14 days'],
      [tok('today'), off(7), 'within the next 7 days'],
      [tok('today'), off(1), 'today or tomorrow'],
      [off(-7), tok('today'), 'within the last 7 days'],
      [off(-30), off(0), 'within the last 30 days'],
      [off(-1), tok('today'), 'yesterday or today'],
      // One day alone, however it's spelled.
      [tok('today'), tok('today'), 'today'],
      [tok('today'), off(0), 'today'],
      [oct26, oct26, 'Oct 26'],
      [tok('end-of-week'), tok('end-of-week'), 'end of week'],
      // Two other ends: A – B, both included.
      [off(-7), tok('yesterday'), '7 days ago – yesterday'],
      [off(-7), off(-1), '7 days ago – yesterday'],
      [off(-1), tok('yesterday'), 'yesterday'],
      [off(-1), off(-1), 'yesterday'],
      [off(1), off(3), 'tomorrow – in 3 days'],
      [off(2), off(9), 'in 2 days – in 9 days'],
      [tok('start-of-week'), tok('end-of-week'), 'start of week – end of week'],
      [tok('today'), tok('end-of-week'), 'today – end of week'],
      [off(-7), off(14), '7 days ago – in 14 days'],
      [null, null, ''],
    ]
    for (const [start, end, words] of cases) expect(describeRange(start, end), JSON.stringify([start, end])).toBe(words)
    for (const [start, end] of cases) expect(describeRange(start, end)).not.toMatch(/^(up to|by|from) /)
  })

  it('keeps the "or none" suffix (Last follow-up: "or never")', () => {
    expect(describeDateMatch({ match: 'range', start: null, end: { kind: 'offset', days: 30 }, includeNoDate: true }, 'deadline')).toBe('in 30 days or earlier, or none')
    expect(describeDateMatch({ match: 'range', start: null, end: { kind: 'offset', days: 30 }, includeNoDate: true }, 'followup')).toBe('in 30 days or earlier, or none')
    expect(describeDateMatch({ match: 'range', start: null, end: { kind: 'offset', days: -14 }, includeNoDate: true }, 'lastFollowup')).toBe('14+ days ago, or never')
  })

  it('Show Any / None: "any date" / "none" (Last follow-up: "never") — cr25 P8', () => {
    expect(describeDateMatch({ match: 'set' }, 'followup')).toBe('any date')
    expect(describeDateMatch({ match: 'unset' }, 'followup')).toBe('none')
    expect(describeDateMatch({ match: 'set' }, 'deadline')).toBe('any date')
    expect(describeDateMatch({ match: 'unset' }, 'deadline')).toBe('none')
    expect(describeDateMatch({ match: 'set' }, 'lastFollowup')).toBe('any date')
    expect(describeDateMatch({ match: 'unset' }, 'lastFollowup')).toBe('never')
  })
})

describe('a date range chip’s tooltip spells its exact days (cr25 P7)', () => {
  // Mon 2 Nov 2026; weeks start on Monday.
  const day = { today: new Date(2026, 10, 2), weekStartsOn: 1 as const }
  const withDay: FilterChipNames = { ...names, day }
  // A date's words are joined by no-break spaces (a tooltip never wraps inside one); compared as plain spaces.
  const plain = (s: string | null | undefined) => s?.replaceAll('\u00a0', ' ')
  const tip = (dates: TodoPredicate['dates']) => filterChips({ ...emptyPredicate(), dates }, withDay).map((c) => plain(c.tooltip))

  it('never wraps inside a date', () => {
    const [chip] = filterChips({ ...emptyPredicate(), dates: { deadline: { match: 'range', start: null, end: { kind: 'offset', days: -7 } } } }, withDay)
    expect(chip?.tooltip).toBe('Due: 7+ days ago\nDue on or before Mon\u00a026\u00a0Oct')
  })

  it('states the first and last day, by date type, with what happens to tasks without the date', () => {
    expect(tip({ lastFollowup: { match: 'range', start: null, end: { kind: 'offset', days: -7 }, includeNoDate: true } }))
      .toEqual(['Last follow-up: 7+ days ago, or never\nLast followed up on or before Mon 26 Oct, or never'])
    expect(tip({ deadline: { match: 'range', start: { kind: 'relative', token: 'today' }, end: { kind: 'offset', days: 14 } } }))
      .toEqual(['Due: within the next 14 days\nDue from Mon 2 Nov through Mon 16 Nov'])
    expect(tip({ followup: { match: 'range', start: { kind: 'offset', days: 7 }, end: null, includeNoDate: true } }))
      .toEqual(['Next follow-up: 7+ days ahead, or none\nNext follow-up on or after Mon 9 Nov, or no next follow-up'])
    expect(tip({ deadline: { match: 'range', start: null, end: { kind: 'offset', days: 0 }, includeNoDate: true } }))
      .toEqual(['Due: today or earlier, or none\nDue on or before Mon 2 Nov, or no due date'])
    expect(tip({ created: { match: 'range', start: { kind: 'relative', token: 'start-of-month' }, end: null } }))
      .toEqual(['Created: on or after start of month\nCreated on or after Sun 1 Nov'])
    expect(tip({ modified: { match: 'range', start: { kind: 'relative', token: 'today' }, end: { kind: 'relative', token: 'today' } } }))
      .toEqual(['Modified: today\nModified on Mon 2 Nov'])
    expect(tip({ completed: { match: 'range', start: { kind: 'relative', token: 'start-of-week' }, end: { kind: 'relative', token: 'end-of-week' } } }))
      .toEqual(['Completed: start of week – end of week\nCompleted from Mon 2 Nov through Sun 8 Nov'])
    // Another year shows it; a range that starts after it ends says it holds no day.
    expect(tip({ deadline: { match: 'range', start: null, end: { kind: 'fixed', iso: new Date(2027, 0, 5).toISOString() } } }))
      .toEqual(['Due: on or before Jan 5\nDue on or before Tue 5 Jan 2027'])
    expect(tip({ deadline: { match: 'range', start: { kind: 'offset', days: 3 }, end: { kind: 'offset', days: 1 } } }))
      .toEqual(['Due: in 3 days – tomorrow\nDue from Thu 5 Nov through Tue 3 Nov (no day: it starts after it ends)'])
  })

  it('the week start moves the week tokens’ days', () => {
    const sunday = filterChips({ ...emptyPredicate(), dates: { deadline: { match: 'range', start: null, end: { kind: 'relative', token: 'end-of-week' } } } }, { ...names, day: { ...day, weekStartsOn: 0 } })
    expect(plain(sunday[0]?.tooltip)).toBe('Due: on or before end of week\nDue on or before Sat 7 Nov')
  })

  it('an "is not" range says the days it hides', () => {
    expect(tip({ lastFollowup: { match: 'range', start: { kind: 'offset', days: -7 }, end: { kind: 'relative', token: 'today' }, not: true } }))
      .toEqual(['Last follow-up: not within the last 7 days\nHides tasks last followed up from Mon 26 Oct through Mon 2 Nov; tasks never followed up stay'])
    expect(tip({ created: { match: 'range', start: null, end: { kind: 'offset', days: -30 }, not: true } }))
      .toEqual(['Created: not 30+ days ago\nHides tasks created on or before Sat 3 Oct'])
  })

  it('Has a date / No date, and chips without a day, keep their tooltips as they were', () => {
    expect(tip({ deadline: { match: 'set' }, followup: { match: 'unset' } })).toEqual([undefined, undefined])
    expect(filterChips({ ...emptyPredicate(), dates: { deadline: { match: 'range', start: null, end: { kind: 'offset', days: 7 } } } }, names)[0]?.tooltip).toBeUndefined()
  })

  it('the Dates button: one type → the chip’s tooltip; from two on, each range’s days after a ·', () => {
    const due = { match: 'range' as const, start: { kind: 'relative' as const, token: 'today' as const }, end: { kind: 'offset' as const, days: 14 } }
    const notLastWeek = { match: 'range' as const, start: { kind: 'offset' as const, days: -7 }, end: { kind: 'relative' as const, token: 'today' as const }, not: true as const }
    expect(plain(datesTooltip({ deadline: due }, day))).toBe('Due: within the next 14 days\nDue from Mon 2 Nov through Mon 16 Nov')
    expect(datesTooltip({ deadline: { match: 'set' } }, day)).toBeNull()
    expect(datesTooltip({ deadline: due })).toBeNull()
    expect(plain(datesTooltip({ deadline: due, lastFollowup: notLastWeek, followup: { match: 'set' } }, day))).toBe([
      'Due: within the next 14 days · from Mon 2 Nov through Mon 16 Nov',
      'Next follow-up: any date',
      'Last follow-up: not within the last 7 days · not from Mon 26 Oct through Mon 2 Nov',
      'Tasks must match all · × clears all',
    ].join('\n'))
  })
})

describe('an "is not" date range in words (cr25 P4)', () => {
  const notLastWeek = { match: 'range' as const, start: { kind: 'offset' as const, days: -7 }, end: { kind: 'relative' as const, token: 'today' as const }, not: true as const }
  const notNext2Weeks = { match: 'range' as const, start: { kind: 'relative' as const, token: 'today' as const }, end: { kind: 'offset' as const, days: 14 }, not: true as const }

  it('reads the range words with `not` (never `, or none`)', () => {
    expect(describeDateMatch(notLastWeek, 'lastFollowup')).toBe('not within the last 7 days')
    expect(describeDateMatch(notNext2Weeks, 'followup')).toBe('not within the next 14 days')
    expect(describeDateMatch({ ...notNext2Weeks, includeNoDate: true }, 'followup')).toBe('not within the next 14 days')
    expect(describeDateMatch({ match: 'range', start: null, end: { kind: 'relative', token: 'yesterday' }, not: true }, 'deadline')).toBe('not before today')
    expect(describeDateMatch({ match: 'range', start: null, end: { kind: 'offset', days: -7 }, not: true }, 'created')).toBe('not 7+ days ago')
  })

  it('a chip marks it as an "is not" id chip does: `not …`, negated, a tooltip saying what it hides and keeps', () => {
    const p: TodoPredicate = { ...emptyPredicate(), dates: { followup: notNext2Weeks, created: notLastWeek, deadline: { match: 'range', start: null, end: { kind: 'offset', days: 7 } } } }
    expect(filterChips(p, names)).toEqual([
      { field: 'dates', dateField: 'deadline', label: 'Due', value: 'in 7 days or earlier' },
      {
        field: 'dates', dateField: 'followup', label: 'Next follow-up', value: 'not within the next 14 days', negated: true,
        tooltip: 'Next follow-up: not within the next 14 days\nHides tasks with a next follow-up in that range; tasks with none stay',
      },
      { field: 'dates', dateField: 'created', label: 'Created', value: 'not within the last 7 days', negated: true, tooltip: 'Created: not within the last 7 days\nHides tasks created in that range' },
    ])
  })

  it('every summary built from the chips says it: the line, the hint, the Dates button', () => {
    const p: TodoPredicate = { ...emptyPredicate(), orGroups: [{ ...emptyFilterClauses(), dates: { lastFollowup: notLastWeek, followup: notNext2Weeks } }] }
    expect(describeFilters(predicateLineItems(p, names))).toBe('Next follow-up not within the next 14 days or Last follow-up not within the last 7 days')
    expect(datesValue({ followup: notNext2Weeks })).toBe('Next follow-up not within the next 14 days')
    expect(datesTooltip({ lastFollowup: notLastWeek, followup: notNext2Weeks })).toBe(
      'Next follow-up: not within the next 14 days\nLast follow-up: not within the last 7 days\nTasks must match both · × clears both',
    )
    expect(datesSpokenValue({ followup: notNext2Weeks })).toBe('Next follow-up not within the next 14 days')
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
    expect(datesValue({ followup: { match: 'unset' } })).toBe('Next follow-up none')
    expect(datesValue({ lastFollowup: { match: 'range', start: null, end: { kind: 'offset', days: -14 }, includeNoDate: true } }))
      .toBe('Last follow-up 14+ days ago, or never')
    expect(datesValue({ completed: { match: 'range', start: { kind: 'relative', token: 'start-of-week' }, end: { kind: 'relative', token: 'today' } } }))
      .toBe('Completed start of week – today')
  })

  it('two types → their short names joined, in tab order', () => {
    expect(datesValue({ created, deadline: due })).toBe('Due + Created')
    expect(datesValue({ created, lastFollowup: { match: 'unset' } })).toBe('Last follow-up + Created')
    expect(datesValue({ completed: created, followup: { match: 'set' } })).toBe('Next follow-up + Completed')
  })

  it('three or four → the first + N', () => {
    expect(datesValue({ created, deadline: due, modified: created })).toBe('Due + 2')
    expect(datesValue({ followup: { match: 'set' }, created, deadline: due, modified: created })).toBe('Due + 3')
  })

  it('the tooltip lists each type from two on, then how they combine', () => {
    expect(datesTooltip({ deadline: due })).toBeNull()
    expect(datesTooltip({ deadline: due, created })).toBe('Due: today – end of next week\nCreated: on or after start of month\nTasks must match both · × clears both')
    expect(datesTooltip({ deadline: due, created, followup: { match: 'set' } }))
      .toBe('Due: today – end of next week\nNext follow-up: any date\nCreated: on or after start of month\nTasks must match all · × clears all')
  })

  it('the spoken value lists every type', () => {
    expect(datesSpokenValue({ deadline: due, created })).toBe('Due today – end of next week; Created on or after start of month')
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
    expect(sortOrderWords('lastFollowup', 'asc')).toBe('Oldest first')
    expect(sortOrderWords('lastFollowup', 'desc')).toBe('Most recent first')
    expect(sortOrderWords('completed', 'desc')).toBe('Newest first')
  })

  it('Last followed up and Completed: labels, direction, and the direction each starts in when picked', () => {
    expect(sortHasDirection('lastFollowup')).toBe(true)
    expect(sortHasDirection('completed')).toBe(true)
    expect(isTodoSortBy('lastFollowup') && isTodoSortBy('completed')).toBe(true)
    expect(groupSortSummary('none', 'followup')).toBe('Next follow-up')
    expect(groupSortSummary('people', 'lastFollowup')).toBe('People · Last followed up')
    expect(groupSortSummary('none', 'completed', 'desc')).toBe('Completed ↓')
    // Completed starts newest first, Last followed up oldest first, whatever the direction before.
    expect(withListSort({ sort: 'name' }, 'completed')).toEqual({ sort: 'completed', sortDirection: 'desc' })
    expect(withListSort({ sort: 'deadline', sortDirection: 'desc' }, 'lastFollowup')).toEqual({ sort: 'lastFollowup' })
    // Leaving them, the direction carries over as for any sort.
    expect(withListSort({ sort: 'completed', sortDirection: 'desc' }, 'created')).toEqual({ sort: 'created', sortDirection: 'desc' })
    expect(sortDirectionOnPick('completed', 'asc')).toBe('desc')
    expect(sortDirectionOnPick('name', 'desc')).toBe('desc')
  })

  it('a direction carries over to another sort with one and is dropped for Manual; asc is stored as no field', () => {
    expect(withListSort({ sort: 'deadline', sortDirection: 'desc' }, 'name')).toEqual({ sort: 'name', sortDirection: 'desc' })
    expect(withListSort({ sort: 'deadline', sortDirection: 'desc' }, 'manual')).toEqual({ sort: 'manual' })
    const byName: Pick<ListDefinition, 'sort' | 'sortDirection'> = { sort: 'name' }
    expect(withSortDirection(byName, 'desc')).toEqual({ sort: 'name', sortDirection: 'desc' })
    expect(withSortDirection({ ...byName, sortDirection: 'desc' }, 'asc')).toEqual({ sort: 'name' })
  })
})

describe('multi-value chips read with "or"', () => {
  it('two, three, more values; one value alone', () => {
    expect(orValue(['A'])).toBe('A')
    expect(orValue(['A', 'B'])).toBe('A or B')
    expect(orValue(['A', 'B', 'C'])).toBe('A, B or C')
    expect(orValue(['A', 'B', 'C', 'D'])).toBe('A, B or 2 more')
    expect(orValue([])).toBe('none')
  })

  it('every multi-value "is" chip says any of them will do; a single value has no tooltip', () => {
    const chips = filterChips({ ...emptyPredicate(), tags: [1, 2], personIds: [0, 1], statusIds: [0, 1] }, names)
    expect(chips.map((c) => [c.value, c.tooltip])).toEqual([
      ['#q4 or #home', 'Tags: #q4 or #home\nTasks with any of them'],
      ['Unassigned or Alice', 'People: Unassigned or Alice\nTasks with any of them'],
      ['No status or Waiting', 'Status: No status or Waiting\nTasks in any of them'],
    ])
    expect(filterChips({ ...emptyPredicate(), tags: [1] }, names)[0]?.tooltip).toBeUndefined()
  })
})

describe('a filter line with or groups', () => {
  const hot = { ...emptyFilterClauses(), markers: 'hot' as const }
  const grouped: TodoPredicate = {
    ...emptyPredicate(),
    statusIds: [1],
    orGroups: [{ ...hot, personIds: [1, 2] }, { ...emptyFilterClauses(), tags: [0] }],
  }

  it('the own chips first, then each or group as its chips', () => {
    const items = predicateLineItems(grouped, names)
    expect(items.map((i) => (i.kind === 'chip' ? i.chip.value : i.chips.map((c) => c.value)))).toEqual([
      'Waiting', ['Hot', 'Alice or Bob'], ['No tags'],
    ])
    expect(items.map((i) => (i.kind === 'orGroup' ? i.index : null))).toEqual([null, 0, 1])
  })

  it('in words: an or group joins its chips with "or", items with " · "', () => {
    expect(describeFilters(predicateLineItems(grouped, names))).toBe('Status Waiting · Priority Hot or People Alice or Bob · Tags No tags')
    expect(describeFilters(filterChips(grouped, names))).toBe('Status Waiting')
  })

  it('a list whose only filter is an or group narrows', () => {
    expect(hasNarrowingFilters({ ...emptyPredicate(), orGroups: [hot] })).toBe(true)
  })

  it('removing a chip from an or group; its last chip takes the group', () => {
    const fewer = removeChip(grouped, { field: 'markers' }, 0)
    expect(fewer.orGroups?.[0]?.markers).toBeNull()
    expect(fewer.orGroups?.[0]?.personIds).toEqual([1, 2])
    const gone = removeChip(grouped, { field: 'tags' }, 1)
    expect(gone.orGroups).toHaveLength(1)
    expect(removeChip(grouped, { field: 'status' }).statusIds).toBeNull()
  })

  it('a chip of its own moves into a new or group as its first alternative; refused at the cap', () => {
    const p: TodoPredicate = { ...emptyPredicate(), statusIds: [1], negate: { statusIds: true }, personIds: [2] }
    const wrapped = wrapChipInOrGroup(p, { field: 'status' })!
    expect(wrapped.statusIds).toBeNull()
    expect(wrapped.negate).toBeUndefined()
    expect(wrapped.personIds).toEqual([2])
    expect(wrapped.orGroups).toEqual([{ ...emptyFilterClauses(), statusIds: [1], negate: { statusIds: true } }])
    const full: TodoPredicate = { ...p, orGroups: Array.from({ length: OR_GROUPS_MAX }, () => hot) }
    expect(wrapChipInOrGroup(full, { field: 'status' })).toBeNull()
  })

  it('a date chip moves its date type alone', () => {
    const due = { match: 'set' as const }
    const created = { match: 'range' as const, start: { kind: 'offset' as const, days: -7 }, end: null }
    const wrapped = wrapChipInOrGroup({ ...emptyPredicate(), dates: { deadline: due, created } }, { field: 'dates', dateField: 'created' })!
    expect(wrapped.dates).toEqual({ deadline: due })
    expect(chipClauses({ ...emptyPredicate(), dates: { deadline: due, created } }, { field: 'dates', dateField: 'created' }).dates).toEqual({ created })
    expect(wrapped.orGroups?.[0]?.dates).toEqual({ created })
  })

  it('the fields a group holds', () => {
    expect([...heldFields({ ...hot, personIds: [1], statusIds: [1] })]).toEqual(['markers', 'people', 'status'])
    expect(heldFields(emptyFilterClauses()).size).toBe(0)
  })

  it('Dates is held only once every offered date type filters there — each type is its own chip (cr25 P4b)', () => {
    const set = { match: 'set' as const }
    const one = { ...emptyFilterClauses(), dates: { lastFollowup: { match: 'range' as const, start: { kind: 'offset' as const, days: -7 }, end: null, not: true as const } } }
    expect(heldFields(one).has('dates')).toBe(false)
    const allButCompleted = { ...emptyFilterClauses(), dates: { deadline: set, followup: set, lastFollowup: set, created: { match: 'range' as const, start: null, end: { kind: 'offset' as const, days: 0 } }, modified: { match: 'range' as const, start: null, end: { kind: 'offset' as const, days: 0 } } } }
    expect(heldFields(allButCompleted).has('dates')).toBe(false)
    // A host that leaves Completed out (the check-in): every type it offers filters.
    expect(heldFields(allButCompleted, ['deadline', 'followup', 'lastFollowup', 'created', 'modified']).has('dates')).toBe(true)
    const all = { ...allButCompleted, dates: { ...allButCompleted.dates, completed: { match: 'range' as const, start: null, end: { kind: 'offset' as const, days: 0 } } } }
    expect(heldFields(all).has('dates')).toBe(true)
  })
})
