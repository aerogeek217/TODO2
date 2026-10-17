import { describe, it, expect } from 'vitest'
import {
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
  it('splits the default details width in a 540px list: people 46, tags 68, title 214', () => {
    const cols = taskRowColumns(528)
    expect(cols.details).toBe(DEFAULT_DETAILS_WIDTH)
    expect(cols.laidOut).toBe(DEFAULT_DETAILS_WIDTH)
    expect([cols.people, cols.tags, cols.due]).toEqual([46, 68, 46])
    expect(cols.template).toBe('5px 18px minmax(0, 1fr) 16px 46px 68px 46px 18px 20px 18px')
    expect(titleWidth(528, cols.laidOut)).toBe(214)
  })

  it('people take 40% of F, within 22 … 64; tags the rest', () => {
    // F = D − 118 fixed − 30 gaps
    expect(taskRowColumns(2000, 148 + 56)).toMatchObject({ people: 22, tags: 34 })
    expect(taskRowColumns(2000, 148 + 100)).toMatchObject({ people: 40, tags: 60 })
    expect(taskRowColumns(2000, 148 + 300)).toMatchObject({ people: 64, tags: 236 })
  })

  it('tags give way first (people take their gap), then people', () => {
    const noTags = taskRowColumns(2000, 148 + 55)
    expect(noTags).toMatchObject({ people: 60, tags: 0 })
    expect(noTags.template).toBe('5px 18px minmax(0, 1fr) 16px 60px 46px 18px 20px 18px')
    expect(noTags.laidOut).toBe(203)
    expect(taskRowColumns(2000, 148 + 17)).toMatchObject({ people: 22, tags: 0 })
    const neither = taskRowColumns(2000, 148 + 16)
    expect(neither).toMatchObject({ people: 0, tags: 0 })
    expect(neither.template).toBe('5px 18px minmax(0, 1fr) 16px 46px 18px 20px 18px')
    expect(neither.laidOut).toBe(138)
  })

  it('clamps a stored width to min (fixed tracks only) … max (title keeps 80px); the bounds follow the width', () => {
    const wide = taskRowColumns(528, 4000)
    expect(wide.maxDetails).toBe(528 - 14 - 38 - 80)
    expect(wide.details).toBe(wide.maxDetails)
    expect(titleWidth(528, wide.laidOut)).toBe(80)
    const tight = taskRowColumns(528, 0)
    expect(tight.details).toBe(138)
    expect(tight.minDetails).toBe(138)
    // The same stored value in a wider list: no longer clamped.
    expect(taskRowColumns(1200, 600).details).toBe(600)
    expect(taskRowColumns(700, 600).details).toBe(700 - 14 - 38 - 80)
  })

  it('narrow lists (< 360px) get a 40px due track; a 320px list clamps to the title minimum, tags removed', () => {
    const cols = taskRowColumns(308)
    expect(cols.due).toBe(40)
    expect(cols.minDetails).toBe(132)
    expect(cols.details).toBe(308 - 14 - 38 - 80)
    expect(cols.tags).toBe(0)
    expect(cols.people).toBeGreaterThanOrEqual(30)
    expect(cols.people).toBeLessThanOrEqual(40)
    expect(taskRowColumns(360).due).toBe(46)
  })

  it('a list too narrow even for the fixed tracks keeps them (the title shrinks below 80)', () => {
    const cols = taskRowColumns(200)
    expect(cols.details).toBe(cols.minDetails)
    expect([cols.people, cols.tags]).toEqual([0, 0])
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
