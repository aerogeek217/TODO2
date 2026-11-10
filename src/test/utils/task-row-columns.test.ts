import { describe, it, expect } from 'vitest'
import {
  DATES_TIERS,
  datesParts,
  REPEAT_DATE_PART,
  DEFAULT_DETAILS_WIDTH,
  defaultDetailsWidth,
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
  it('nothing stored: the details take 45 % of a 528px list (233): people 34, tags 51, the dates 92, title 244', () => {
    const cols = taskRowColumns(528)
    expect(cols.details).toBe(defaultDetailsWidth(518))
    expect(cols.details).toBe(233)
    expect(cols.laidOut).toBe(233)
    expect([cols.people, cols.tags, cols.dates, cols.datesTier]).toEqual([34, 51, 92, 'both'])
    // Status is the last track (the task menu is right-click / Shift+F10 only).
    expect(cols.template).toBe('8px 18px minmax(0, 1fr) 16px 34px 51px 92px 20px')
    expect(titleWidth(528, cols.laidOut)).toBe(244)
  })

  it('nothing stored in a wide list: the details stop at 300 (people 61, tags 91)', () => {
    const cols = taskRowColumns(1200)
    expect(cols.details).toBe(DEFAULT_DETAILS_WIDTH)
    expect([cols.people, cols.tags, cols.dates]).toEqual([61, 91, 92])
    expect(titleWidth(1200, cols.laidOut)).toBe(849)
    expect(defaultDetailsWidth(0)).toBe(0)
    expect(defaultDetailsWidth(10_000)).toBe(300)
  })

  it('people take 40% of F, within 22 … 64; tags the rest', () => {
    // F = D − 128 fixed (notes 16, the dates 92, status 20) − 20 gaps
    expect(taskRowColumns(2000, 148 + 56)).toMatchObject({ people: 22, tags: 34 })
    expect(taskRowColumns(2000, 148 + 100)).toMatchObject({ people: 40, tags: 60 })
    expect(taskRowColumns(2000, 148 + 300)).toMatchObject({ people: 64, tags: 236 })
  })

  it('below the split minimum the dates give way first — the follow-up date, then the due date — then tags, then people', () => {
    // F = D − fixed (16 + dates + 20) − 20 gaps; each tier holds while F ≥ 56.
    expect(taskRowColumns(2000, 204)).toMatchObject({ datesTier: 'both', dates: 92, people: 22, tags: 34 })
    const due = taskRowColumns(2000, 203)
    expect(due).toMatchObject({ datesTier: 'due', dates: 65, people: 33, tags: 49 })
    expect(taskRowColumns(2000, 177)).toMatchObject({ datesTier: 'due', people: 22, tags: 34 })
    expect(taskRowColumns(2000, 176)).toMatchObject({ datesTier: 'icons', dates: 38, people: 33, tags: 49 })
    expect(taskRowColumns(2000, 150)).toMatchObject({ datesTier: 'icons', people: 22, tags: 34 })
    // Then tags go (people take their gap), then people.
    const noTags = taskRowColumns(2000, 149)
    expect(noTags).toMatchObject({ datesTier: 'icons', people: 60, tags: 0 })
    expect(noTags.template).toBe('8px 18px minmax(0, 1fr) 16px 60px 38px 20px')
    expect(noTags.laidOut).toBe(149)
    expect(taskRowColumns(2000, 111)).toMatchObject({ people: 22, tags: 0 })
    const neither = taskRowColumns(2000, 110)
    expect(neither).toMatchObject({ people: 0, tags: 0, datesTier: 'icons' })
    expect(neither.template).toBe('8px 18px minmax(0, 1fr) 16px 38px 20px')
    expect(neither.laidOut).toBe(84)
  })

  it('clamps a stored width to min (notes, the dates as icons, status) … max (title keeps 140px); the bounds follow the width', () => {
    const wide = taskRowColumns(528, 4000)
    expect(wide.maxDetails).toBe(528 - 10 - 41 - 140)
    expect(wide.details).toBe(wide.maxDetails)
    expect(titleWidth(528, wide.laidOut)).toBe(140)
    const tight = taskRowColumns(528, 0)
    expect(tight.details).toBe(84)
    expect(tight.minDetails).toBe(84)
    expect(tight.datesTier).toBe('icons')
    // The same stored value in a wider list: no longer clamped.
    expect(taskRowColumns(1200, 600).details).toBe(600)
    expect(taskRowColumns(700, 600).details).toBe(700 - 10 - 41 - 140)
  })

  it('the list width sets the default details, and so the dates: the follow-up date goes first, then the due date', () => {
    // Both dates while 45 % of the inner width leaves people and tags their split (D ≥ 204).
    expect(taskRowColumns(463)).toMatchObject({ details: 204, datesTier: 'both', dates: 92 })
    expect(taskRowColumns(462)).toMatchObject({ details: 203, datesTier: 'due', dates: 65 })
    expect(taskRowColumns(403)).toMatchObject({ details: 177, datesTier: 'due', dates: 65 })
    expect(taskRowColumns(402)).toMatchObject({ details: 176, datesTier: 'icons', dates: 38 })
    // A wider stored width can't widen them past what the list gives.
    expect(taskRowColumns(306, 4000).datesTier).toBe('icons')
    // In a wide list the details width sets them.
    expect(taskRowColumns(1200, 300).datesTier).toBe('both')
    expect(taskRowColumns(1200, 200).datesTier).toBe('due')
    expect(taskRowColumns(1200, 160).datesTier).toBe('icons')
  })

  it('a 307px list keeps the title its 140px: the dates as icons, tags gone, people kept', () => {
    const cols = taskRowColumns(307)
    expect(cols.minDetails).toBe(84)
    expect(cols.details).toBe(307 - 10 - 41 - 140)
    expect(titleWidth(307, cols.laidOut)).toBe(140)
    // F = 116 − 74 − 20 = 22: people take it and the gap tags had.
    expect([cols.people, cols.tags, cols.datesTier]).toEqual([27, 0, 'icons'])
  })

  it('a list too narrow even for the fixed tracks keeps them (the title shrinks below 140)', () => {
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
    expect(datesParts('both')).toMatchObject({ due: 45, followup: 45 })
    expect(datesParts('due')).toMatchObject({ due: 45, followup: 18 })
    // A set date is its text alone (5 + 35 + 5: `Today` bold fits, D25 D1); the repeat glyph before a repeating task's date would be 57.
    expect(DATES_TIERS).toEqual({ both: 92, due: 65, icons: 38 })
    expect(REPEAT_DATE_PART).toBe(57)
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
