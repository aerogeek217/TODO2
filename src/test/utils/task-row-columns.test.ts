import { describe, it, expect } from 'vitest'
import {
  DATES_TIERS,
  datesParts,
  DEFAULT_DETAILS_WIDTH,
  peopleFit,
  tagsFit,
  taskRowColumns,
  TASK_ROW,
} from '../../utils/task-row-columns'

/** The title track's width for rows `width` wide with these columns. */
function titleWidth(width: number, laidOut: number): number {
  return width - TASK_ROW.padLeft - TASK_ROW.padRight - TASK_ROW.gutter - TASK_ROW.checkbox - 3 * TASK_ROW.gap - laidOut
}

describe('taskRowColumns', () => {
  it('splits the default details width in a 540px list: people 53, tags 79, the dates 112, title 176', () => {
    const cols = taskRowColumns(528)
    expect(cols.details).toBe(DEFAULT_DETAILS_WIDTH)
    expect(cols.laidOut).toBe(DEFAULT_DETAILS_WIDTH)
    expect([cols.people, cols.tags, cols.dates, cols.datesTier]).toEqual([53, 79, 112, 'both'])
    // Status is the last track (the task menu is right-click / Shift+F10 only).
    expect(cols.template).toBe('5px 18px minmax(0, 1fr) 16px 53px 79px 112px 20px')
    expect(titleWidth(528, cols.laidOut)).toBe(176)
  })

  it('people take 40% of F, within 22 … 64; tags the rest', () => {
    // F = D − 148 fixed − 20 gaps
    expect(taskRowColumns(2000, 168 + 56)).toMatchObject({ people: 22, tags: 34 })
    expect(taskRowColumns(2000, 168 + 100)).toMatchObject({ people: 40, tags: 60 })
    expect(taskRowColumns(2000, 168 + 300)).toMatchObject({ people: 64, tags: 236 })
  })

  it('tags give way first (people take their gap), then people; the dates stay', () => {
    const noTags = taskRowColumns(2000, 168 + 55)
    expect(noTags).toMatchObject({ people: 60, tags: 0, datesTier: 'both' })
    expect(noTags.template).toBe('5px 18px minmax(0, 1fr) 16px 60px 112px 20px')
    expect(noTags.laidOut).toBe(223)
    expect(taskRowColumns(2000, 168 + 17)).toMatchObject({ people: 22, tags: 0 })
    const neither = taskRowColumns(2000, 168 + 16)
    expect(neither).toMatchObject({ people: 0, tags: 0, datesTier: 'both' })
    expect(neither.template).toBe('5px 18px minmax(0, 1fr) 16px 112px 20px')
    expect(neither.laidOut).toBe(158)
  })

  it('clamps a stored width to min (fixed tracks only) … max (title keeps 80px); the bounds follow the width', () => {
    const wide = taskRowColumns(528, 4000)
    expect(wide.maxDetails).toBe(528 - 14 - 38 - 80)
    expect(wide.details).toBe(wide.maxDetails)
    expect(titleWidth(528, wide.laidOut)).toBe(80)
    const tight = taskRowColumns(528, 0)
    expect(tight.details).toBe(158)
    expect(tight.minDetails).toBe(158)
    // The same stored value in a wider list: no longer clamped.
    expect(taskRowColumns(1200, 600).details).toBe(600)
    expect(taskRowColumns(700, 600).details).toBe(700 - 14 - 38 - 80)
  })

  it('the list width alone sets the dates: the follow-up date goes first, then the due date', () => {
    // Both dates while people and tags keep their split at the widest details.
    expect(taskRowColumns(356)).toMatchObject({ datesTier: 'both', dates: 112 })
    expect(taskRowColumns(355)).toMatchObject({ datesTier: 'due', dates: 75 })
    expect(taskRowColumns(319)).toMatchObject({ datesTier: 'due', dates: 75 })
    expect(taskRowColumns(318)).toMatchObject({ datesTier: 'icons', dates: 38 })
    // The details width never changes it (a divider drag re-lays rows out, nothing else).
    for (const stored of [0, 120, 200, 4000]) expect(taskRowColumns(528, stored).datesTier).toBe('both')
    for (const stored of [0, 120, 4000]) expect(taskRowColumns(308, stored).datesTier).toBe('icons')
  })

  it('a 320px list shows the dates as icons and keeps people and tags', () => {
    const cols = taskRowColumns(308)
    expect(cols.minDetails).toBe(84)
    expect(cols.details).toBe(308 - 14 - 38 - 80)
    // F = 176 − 74 − 20 = 82.
    expect([cols.people, cols.tags]).toEqual([33, 49])
  })

  it('a list too narrow even for the fixed tracks keeps them (the title shrinks below 80)', () => {
    const cols = taskRowColumns(200)
    expect(cols.details).toBe(cols.minDetails)
    expect(cols.datesTier).toBe('icons')
    expect([cols.people, cols.tags]).toEqual([0, 0])
  })
})

describe('datesParts', () => {
  it('splits each tier into the due part and the follow-up part', () => {
    for (const tier of ['both', 'due', 'icons'] as const) {
      const p = datesParts(tier)
      expect(p.due + p.gap + p.followup).toBe(DATES_TIERS[tier])
    }
    expect(datesParts('due')).toMatchObject({ due: 55, followup: 18 })
  })
})

describe('peopleFit', () => {
  it('shows every avatar that fits, then +N; one avatar with +N beside it or as a badge', () => {
    expect(peopleFit(0, 46)).toEqual({ shown: 0, more: 0, badge: false })
    expect(peopleFit(1, 22)).toEqual({ shown: 1, more: 0, badge: false })
    expect(peopleFit(2, 46)).toEqual({ shown: 2, more: 0, badge: false })
    // 64px: room 58 → three avatars (40) + "+N" (16) = 56.
    expect(peopleFit(5, 64)).toEqual({ shown: 3, more: 2, badge: false })
    expect(peopleFit(4, 46)).toEqual({ shown: 1, more: 3, badge: false })
    // 35px: room 29 → one avatar; 16 + "+N" doesn't fit → badge.
    expect(peopleFit(4, 35)).toEqual({ shown: 1, more: 3, badge: true })
  })
})

describe('tagsFit', () => {
  const more = () => 16
  it('fits whole tags, leaving room for +N while more follow', () => {
    expect(tagsFit([], 68, more)).toEqual({ shown: 0, more: 0 })
    expect(tagsFit([30, 20], 68, more)).toEqual({ shown: 2, more: 0 })
    expect(tagsFit([30, 20, 20], 68, more)).toEqual({ shown: 1, more: 2 })
    expect(tagsFit([20, 20, 20], 100, more)).toEqual({ shown: 3, more: 0 })
  })

  it('always shows the first tag (it ellipsizes when it doesn’t fit)', () => {
    expect(tagsFit([200, 20], 68, more)).toEqual({ shown: 1, more: 1 })
    expect(tagsFit([200], 40, more)).toEqual({ shown: 1, more: 0 })
  })
})
