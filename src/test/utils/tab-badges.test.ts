import { describe, expect, it } from 'vitest'
import {
  countTabBadges,
  inTabBadgeRange,
  parseTabBadgeRange,
  pickListTabBadges,
  tabBadgeRangeLabel,
  tabBadgeRangesFor,
  tabBadgeSummary,
} from '../../utils/tab-badges'

const today = new Date(2026, 10, 5)
const inDays = (n: number) => new Date(2026, 10, 5 + n, 15, 30)
const task = (fields: { due?: number; followup?: number; done?: boolean }) => ({
  isCompleted: fields.done === true,
  dueDate: fields.due === undefined ? undefined : inDays(fields.due),
  nextFollowupAt: fields.followup === undefined ? undefined : inDays(fields.followup),
})

describe('parseTabBadgeRange', () => {
  it.each([['off', 'off'], ['overdue', 'overdue'], ['0', 0], ['14', 14], [3, 3]])('reads %s', (value, want) => {
    expect(parseTabBadgeRange(value)).toBe(want)
  })

  it.each(['', 'soon', '-1', '1.5', '366', null, undefined, {}])('refuses %s', (value) => {
    expect(parseTabBadgeRange(value)).toBeUndefined()
  })
})

describe('pickListTabBadges', () => {
  it('reads off and both ranges', () => {
    expect(pickListTabBadges('off')).toBe('off')
    expect(pickListTabBadges({ due: 'overdue', followup: 7 })).toEqual({ due: 'overdue', followup: 7 })
  })

  it.each([undefined, null, 'on', { due: 3 }, { due: 'soon', followup: 0 }])('drops %j', (value) => {
    expect(pickListTabBadges(value)).toBeUndefined()
  })
})

describe('tabBadgeRangesFor', () => {
  const app = { due: 3, followup: 0 }

  it('is the app’s without the list’s own', () => {
    expect(tabBadgeRangesFor(undefined, app)).toBe(app)
  })

  it('is off, or the list’s own', () => {
    expect(tabBadgeRangesFor('off', app)).toEqual({ due: 'off', followup: 'off' })
    expect(tabBadgeRangesFor({ due: 7, followup: 'off' }, app)).toEqual({ due: 7, followup: 'off' })
  })
})

describe('countTabBadges', () => {
  it('counts overdue and the range’s last day, not past it, by day whatever the hour', () => {
    const counts = countTabBadges([task({ due: -1 }), task({ due: 0 }), task({ due: 3 }), task({ due: 4 }), task({})], { due: 3, followup: 'off' }, today)
    expect(counts).toEqual({ due: 3, dueOverdue: 1, followup: 0, followupOverdue: 0 })
  })

  it('counts due and follow-up apart, one task in both', () => {
    const counts = countTabBadges([task({ due: 1, followup: -2 }), task({ followup: 0 }), task({ followup: 1 })], { due: 3, followup: 0 }, today)
    expect(counts).toEqual({ due: 1, dueOverdue: 0, followup: 2, followupOverdue: 1 })
  })

  it('overdue only leaves today out; off counts nothing; completed never counts', () => {
    expect(countTabBadges([task({ due: -1 }), task({ due: 0 })], { due: 'overdue', followup: 'off' }, today).due).toBe(1)
    expect(countTabBadges([task({ due: -1, followup: -1 })], { due: 'off', followup: 'off' }, today).due).toBe(0)
    expect(countTabBadges([task({ due: -1, followup: -1, done: true })], { due: 3, followup: 0 }, today))
      .toEqual({ due: 0, dueOverdue: 0, followup: 0, followupOverdue: 0 })
  })
})

describe('inTabBadgeRange', () => {
  const ranges = { due: 3, followup: 0 }
  const tasks = [
    task({ due: -1 }), task({ due: 3 }), task({ due: 4 }), task({ followup: 0 }), task({ followup: 1 }),
    task({ due: 1, followup: -2 }), task({}), task({ due: -1, done: true }),
  ]

  it('is the tasks countTabBadges counts: open, a date inside its range (cr31 UI W4)', () => {
    expect(tasks.map((t) => inTabBadgeRange(t, ranges, today))).toEqual([true, true, false, true, false, true, false, false])
    expect(countTabBadges(tasks.filter((t) => inTabBadgeRange(t, ranges, today)), ranges, today)).toEqual(countTabBadges(tasks, ranges, today))
    expect(tasks.some((t) => inTabBadgeRange(t, { due: 'off', followup: 'off' }, today))).toBe(false)
  })
})

describe('tabBadgeSummary', () => {
  it('spells each kind', () => {
    expect(tabBadgeSummary({ due: 3, dueOverdue: 1, followup: 2, followupOverdue: 0 }, { due: 3, followup: 0 }))
      .toEqual(['3 due: 1 overdue, 2 within 3 days', '2 follow-ups: today'])
  })

  it('says when all are overdue, and leaves out what is empty', () => {
    expect(tabBadgeSummary({ due: 0, dueOverdue: 0, followup: 1, followupOverdue: 1 }, { due: 3, followup: 0 })).toEqual(['1 follow-up: overdue'])
    expect(tabBadgeSummary({ due: 2, dueOverdue: 2, followup: 0, followupOverdue: 0 }, { due: 'overdue', followup: 0 })).toEqual(['2 due: all overdue'])
  })
})

describe('tabBadgeRangeLabel', () => {
  it.each([['off', 'Off'], ['overdue', 'Overdue only'], [0, 'Overdue and today'], [1, 'Overdue and tomorrow'], [7, 'Overdue and next 7 days']] as const)('%s', (range, label) => {
    expect(tabBadgeRangeLabel(range)).toBe(label)
  })
})
