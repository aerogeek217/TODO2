import { describe, it, expect } from 'vitest'
import { LIST_ZOOMS, isListZoom } from '../../models/workspace-layout'
import {
  canStepListZoom,
  parseListZoomSetting,
  rowSummaryText,
  rowTone,
  stepListZoom,
  stripWidthPct,
} from '../../utils/list-zoom'

const TODAY = new Date(2026, 10, 6)
const day = (n: number) => new Date(2026, 10, 6 + n)
const SETTINGS = { urgentRange: 3, staleAfterDays: 30 }
const task = (fields: Partial<{ dueDate: Date; nextFollowupAt: Date; isCompleted: boolean; modifiedAt: Date; title: string }> = {}) => ({
  title: 'A task', isCompleted: false, modifiedAt: TODAY, ...fields,
})

describe('the zoom step (D25 C + I1)', () => {
  it('orders the levels most detail first', () => {
    expect(LIST_ZOOMS).toEqual(['stacked', 'rows', 'lines', 'strips'])
    expect(isListZoom('lines')).toBe(true)
    expect(isListZoom('compact')).toBe(false)
  })

  it('steps one level, in towards Stacked and out towards Strips', () => {
    expect(stepListZoom('rows', 'in')).toBe('stacked')
    expect(stepListZoom('rows', 'out')).toBe('lines')
    expect(stepListZoom('lines', 'out')).toBe('strips')
    expect(stepListZoom('strips', 'in')).toBe('lines')
  })

  it('is clamped at the ends', () => {
    expect(stepListZoom('stacked', 'in')).toBe('stacked')
    expect(stepListZoom('strips', 'out')).toBe('strips')
    expect(canStepListZoom('stacked', 'in')).toBe(false)
    expect(canStepListZoom('stacked', 'out')).toBe(true)
    expect(canStepListZoom('strips', 'out')).toBe(false)
  })
})

describe('the Default list zoom row', () => {
  it('reads a level as it is, the old densities as levels, anything else as nothing', () => {
    for (const z of LIST_ZOOMS) expect(parseListZoomSetting(z)).toBe(z)
    expect(parseListZoomSetting('comfortable')).toBe('stacked')
    expect(parseListZoomSetting('compact')).toBe('rows')
    expect(parseListZoomSetting('Rows')).toBeUndefined()
    expect(parseListZoomSetting('')).toBeUndefined()
    expect(parseListZoomSetting(3)).toBeUndefined()
  })
})

describe('a task’s tone at Lines and Strips', () => {
  it('takes the first that holds: late, due soon, follow-up late, stale, none', () => {
    expect(rowTone(task({ dueDate: day(-1), nextFollowupAt: day(-2) }), TODAY, SETTINGS)).toBe('late')
    expect(rowTone(task({ dueDate: day(2), nextFollowupAt: day(-2) }), TODAY, SETTINGS)).toBe('soon')
    expect(rowTone(task({ dueDate: day(5), nextFollowupAt: day(-1) }), TODAY, SETTINGS)).toBe('followup')
    expect(rowTone(task({ dueDate: day(5), modifiedAt: day(-40) }), TODAY, SETTINGS)).toBe('stale')
    expect(rowTone(task({ dueDate: day(5) }), TODAY, SETTINGS)).toBe('none')
    expect(rowTone(task(), TODAY, SETTINGS)).toBe('none')
  })

  it('follows the Settings ranges: no due-soon range, no stale fade', () => {
    expect(rowTone(task({ dueDate: day(2) }), TODAY, { urgentRange: null, staleAfterDays: 30 })).toBe('none')
    expect(rowTone(task({ modifiedAt: day(-40) }), TODAY, { urgentRange: 3, staleAfterDays: 0 })).toBe('none')
  })

  it('a completed task is none, late or not', () => {
    expect(rowTone(task({ dueDate: day(-3), isCompleted: true }), TODAY, SETTINGS)).toBe('none')
  })
})

describe('a strip’s width', () => {
  it('grows with the title, between 24% and 100%, the same for the same title', () => {
    expect(stripWidthPct('')).toBe(24)
    expect(stripWidthPct('Q4')).toBe(27)
    expect(stripWidthPct('Migrate billing jobs')).toBeGreaterThan(stripWidthPct('Q4 budget'))
    expect(stripWidthPct('x'.repeat(200))).toBe(100)
    expect(stripWidthPct('Send interview feedback')).toBe(stripWidthPct('Send interview feedback'))
  })
})

describe('a line’s tooltip', () => {
  it('the title, then what the cells would say, then a stale task’s last edit', () => {
    const text = rowSummaryText(task({ title: 'Ship it', dueDate: day(-2), nextFollowupAt: day(1), modifiedAt: day(-40) }), TODAY, {
      rowDates: 'relative', people: ['Ann', 'Bob'], tags: ['docs'], count: { done: 1, total: 3 }, stale: true,
    })
    const [title, meta, stale] = text.split('\n')
    expect(title).toBe('Ship it')
    expect(meta).toBe('Due Nov 4 (late) · Follow-up Sat · 1 of 3 subtasks done · Ann, Bob · #docs')
    expect(stale).toMatch(/^Last edited 40 days ago/)
  })

  it('a task with nothing set is its title alone', () => {
    expect(rowSummaryText(task({ title: 'Bare' }), TODAY, { rowDates: 'numeric', people: [], tags: [], count: null, stale: false })).toBe('Bare')
  })
})
