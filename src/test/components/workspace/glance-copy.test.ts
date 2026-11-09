import { describe, it, expect } from 'vitest'
import {
  countOf, deltaLabel, numberDescription, signed, trendBucketLabel,
} from '../../../components/workspace/glance/glance-copy'
import { filterChips, listFilterHint, predicateLineItems } from '../../../utils/filter-chips'
import { emptyPredicate } from '../../../models'

describe('glance copy', () => {
  it('countOf / signed', () => {
    expect(countOf(5, 5)).toBe('5')
    expect(countOf(5, 19)).toBe('5 of 19')
    expect([signed(3), signed(-2), signed(0)]).toEqual(['+3', '−2', '0'])
  })

  it('a Number’s dialog line: what it counts, in words', () => {
    const names = { people: [{ id: 1, name: 'Aisha', initials: 'A' }], tags: [{ id: 4, name: 'Project: Atlas', color: '#fff' }], statuses: [] }
    expect(numberDescription(emptyPredicate(), names)).toBe('Every open task.')
    expect(numberDescription({ ...emptyPredicate(), showCompleted: true }, names)).toBe('Every task.')
    expect(numberDescription({ ...emptyPredicate(), personIds: [1] }, names)).toBe('Open tasks where People Aisha.')
    const atlas = { ...emptyPredicate(), expression: { kind: 'and' as const, items: [
      { kind: 'date' as const, field: 'deadline' as const, match: { match: 'range' as const, start: null, end: { kind: 'relative' as const, token: 'yesterday' as const } } },
      { kind: 'tag' as const, id: 4 },
    ] } }
    expect(numberDescription(atlas, names)).toBe('Open tasks where overdue and #"Project: Atlas".')
    const closed = { ...emptyPredicate(), dates: { completed: { match: 'range' as const, start: { kind: 'relative' as const, token: 'start-of-week' as const }, end: { kind: 'relative' as const, token: 'today' as const } } } }
    expect(numberDescription(closed, names)).toMatch(/^Tasks where Completed/)
  })

  it('a Number’s change: against yesterday or the same day last week', () => {
    expect(deltaLabel(2)).toBe('+2 vs yesterday')
    expect(deltaLabel(0)).toBe('No change vs yesterday')
    expect(deltaLabel(-1, 'lastWeek', new Date(2026, 10, 11))).toBe('−1 vs last Wed')
  })

  it('bar labels', () => {
    expect(trendBucketLabel(new Date(2026, 8, 27), 'day')).toBe('27')
    expect(trendBucketLabel(new Date(2026, 8, 27), 'week')).toBe('Sep 27')
  })

  it('a list’s filter hint: people as @, tags as #, the rest as Label: value', () => {
    expect(listFilterHint([])).toBe('All tasks')
    expect(listFilterHint([
      { field: 'people', label: 'People', value: 'Priya +1' },
      { field: 'tags', label: 'Tags', value: '#q4' },
      { field: 'status', label: 'Status', value: 'Waiting' },
    ])).toBe('@Priya +1 · #q4 · Status: Waiting')
  })

  it('a list’s filter hint names each date type that filters', () => {
    const chips = filterChips({
      ...emptyPredicate(),
      dates: { deadline: { match: 'set' }, created: { match: 'range', start: { kind: 'relative', token: 'start-of-month' }, end: null } },
    }, { people: [], tags: [], statuses: [] })
    expect(listFilterHint(chips)).toBe('Due: any date · Created: on or after start of month')
  })

  it('a list’s filter hint spells an expression as its text', () => {
    const names = { people: [{ id: 1, name: 'Aisha', initials: 'AI' }], tags: [], statuses: [] }
    const items = predicateLineItems({
      ...emptyPredicate(),
      expression: { kind: 'and', items: [{ kind: 'status', id: 0 }, { kind: 'or', items: [{ kind: 'priority', value: 'focus' }, { kind: 'person', id: 1 }] }] },
    }, names)
    expect(listFilterHint(items)).toBe('no status and (/focus or @Aisha)')
  })
})
