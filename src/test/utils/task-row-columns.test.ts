import { describe, it, expect } from 'vitest'
import {
  DATES_TIERS,
  datesParts,
  REPEAT_DATE_PART,
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
  it('splits the default details width in a 540px list: people 60, tags 90, the dates 94, title 176', () => {
    const cols = taskRowColumns(528)
    expect(cols.details).toBe(DEFAULT_DETAILS_WIDTH)
    expect(cols.laidOut).toBe(DEFAULT_DETAILS_WIDTH)
    expect([cols.people, cols.tags, cols.dates, cols.datesTier]).toEqual([60, 90, 94, 'both'])
    // Status is the last track (the task menu is right-click / Shift+F10 only).
    expect(cols.template).toBe('5px 18px minmax(0, 1fr) 16px 60px 90px 94px 20px')
    expect(titleWidth(528, cols.laidOut)).toBe(176)
  })

  it('people take 40% of F, within 22 … 64; tags the rest', () => {
    // F = D − 130 fixed (notes 16, the dates 94, status 20) − 20 gaps
    expect(taskRowColumns(2000, 150 + 56)).toMatchObject({ people: 22, tags: 34 })
    expect(taskRowColumns(2000, 150 + 100)).toMatchObject({ people: 40, tags: 60 })
    expect(taskRowColumns(2000, 150 + 300)).toMatchObject({ people: 64, tags: 236 })
  })

  it('below the split minimum the dates give way first — the follow-up date, then the due date — then tags, then people', () => {
    // F = D − fixed (16 + dates + 20) − 20 gaps; each tier holds while F ≥ 56.
    expect(taskRowColumns(2000, 206)).toMatchObject({ datesTier: 'both', dates: 94, people: 22, tags: 34 })
    const due = taskRowColumns(2000, 205)
    expect(due).toMatchObject({ datesTier: 'due', dates: 66, people: 33, tags: 50 })
    expect(taskRowColumns(2000, 178)).toMatchObject({ datesTier: 'due', people: 22, tags: 34 })
    expect(taskRowColumns(2000, 177)).toMatchObject({ datesTier: 'icons', dates: 38, people: 33, tags: 50 })
    expect(taskRowColumns(2000, 150)).toMatchObject({ datesTier: 'icons', people: 22, tags: 34 })
    // Then tags go (people take their gap), then people.
    const noTags = taskRowColumns(2000, 149)
    expect(noTags).toMatchObject({ datesTier: 'icons', people: 60, tags: 0 })
    expect(noTags.template).toBe('5px 18px minmax(0, 1fr) 16px 60px 38px 20px')
    expect(noTags.laidOut).toBe(149)
    expect(taskRowColumns(2000, 111)).toMatchObject({ people: 22, tags: 0 })
    const neither = taskRowColumns(2000, 110)
    expect(neither).toMatchObject({ people: 0, tags: 0, datesTier: 'icons' })
    expect(neither.template).toBe('5px 18px minmax(0, 1fr) 16px 38px 20px')
    expect(neither.laidOut).toBe(84)
  })

  it('clamps a stored width to min (notes, the dates as icons, status) … max (title keeps 80px); the bounds follow the width', () => {
    const wide = taskRowColumns(528, 4000)
    expect(wide.maxDetails).toBe(528 - 14 - 38 - 80)
    expect(wide.details).toBe(wide.maxDetails)
    expect(titleWidth(528, wide.laidOut)).toBe(80)
    const tight = taskRowColumns(528, 0)
    expect(tight.details).toBe(84)
    expect(tight.minDetails).toBe(84)
    expect(tight.datesTier).toBe('icons')
    // The same stored value in a wider list: no longer clamped.
    expect(taskRowColumns(1200, 600).details).toBe(600)
    expect(taskRowColumns(700, 600).details).toBe(700 - 14 - 38 - 80)
  })

  it('the list width caps the details, and so the dates: the follow-up date goes first, then the due date', () => {
    // Both dates while people and tags keep their split at the widest details.
    expect(taskRowColumns(338)).toMatchObject({ datesTier: 'both', dates: 94 })
    expect(taskRowColumns(337)).toMatchObject({ datesTier: 'due', dates: 66 })
    expect(taskRowColumns(310)).toMatchObject({ datesTier: 'due', dates: 66 })
    expect(taskRowColumns(309)).toMatchObject({ datesTier: 'icons', dates: 38 })
    // A wider stored width can't widen them past what the list gives.
    expect(taskRowColumns(308, 4000).datesTier).toBe('icons')
    // In a wide list the details width sets them.
    expect(taskRowColumns(1200, 300).datesTier).toBe('both')
    expect(taskRowColumns(1200, 200).datesTier).toBe('due')
    expect(taskRowColumns(1200, 160).datesTier).toBe('icons')
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
    expect(datesParts('both')).toMatchObject({ due: 46, followup: 46 })
    expect(datesParts('due')).toMatchObject({ due: 46, followup: 18 })
    // A set date is its text alone (6 + 34 + 6); the repeat glyph before a repeating task's date would be 58.
    expect(DATES_TIERS).toEqual({ both: 94, due: 66, icons: 38 })
    expect(REPEAT_DATE_PART).toBe(58)
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
