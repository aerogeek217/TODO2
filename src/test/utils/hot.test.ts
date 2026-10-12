import { describe, it, expect } from 'vitest'
import {
  DEFAULT_HOT_RULE,
  formatHotRule,
  hotRulesEqual,
  isHot,
  matchesHotLine,
  normalizeHotRule,
  parseHotRule,
  readHotRule,
  type HotRule,
} from '../../utils/hot'

// Sat 10 Oct 2026.
const today = new Date(2026, 9, 10)
const day = (d: number) => new Date(2026, 9, d)
const open = { isCompleted: false }

describe('isHot', () => {
  it('default rule: (Urgent AND Important) OR Focus', () => {
    expect(isHot({ ...open, urgent: true, important: true }, DEFAULT_HOT_RULE, today, 3)).toBe(true)
    expect(isHot({ ...open, focus: true }, DEFAULT_HOT_RULE, today, 3)).toBe(true)
    expect(isHot({ ...open, urgent: true }, DEFAULT_HOT_RULE, today, 3)).toBe(false)
    expect(isHot({ ...open, important: true }, DEFAULT_HOT_RULE, today, 3)).toBe(false)
    expect(isHot(open, DEFAULT_HOT_RULE, today, 3)).toBe(false)
  })

  it('each line shape needs every marker of the line', () => {
    const t = { ...open, urgent: true as const, important: true as const, focus: true as const }
    for (const line of [
      { urgent: true }, { important: true }, { focus: true },
      { urgent: true, important: true }, { urgent: true, focus: true }, { important: true, focus: true },
      { urgent: true, important: true, focus: true },
    ] as const) {
      expect(isHot(t, [line], today, 3), JSON.stringify(line)).toBe(true)
    }
    expect(isHot({ ...open, important: true, focus: true }, [{ urgent: true, important: true, focus: true }], today, 3)).toBe(false)
    expect(isHot({ ...open, urgent: true, focus: true }, [{ important: true, focus: true }], today, 3)).toBe(false)
  })

  it('ORs across lines', () => {
    const rule: HotRule = [{ urgent: true, important: true }, { important: true, focus: true }, { focus: true, urgent: true }]
    expect(isHot({ ...open, important: true, focus: true }, rule, today, 3)).toBe(true)
    expect(isHot({ ...open, focus: true, urgent: true }, rule, today, 3)).toBe(true)
    expect(isHot({ ...open, focus: true }, rule, today, 3)).toBe(false)
  })

  it('Urgent is effective urgent: a due date within the range (overdue included) counts', () => {
    const importantDueMon = { ...open, important: true as const, dueDate: day(12) }
    expect(isHot(importantDueMon, DEFAULT_HOT_RULE, today, 3)).toBe(true)
    expect(isHot(importantDueMon, DEFAULT_HOT_RULE, today, 1)).toBe(false)
    expect(isHot({ ...open, important: true, dueDate: day(2) }, DEFAULT_HOT_RULE, today, 0)).toBe(true)
  })

  it('range Off: only the flag makes a task urgent', () => {
    expect(isHot({ ...open, important: true, dueDate: day(9) }, DEFAULT_HOT_RULE, today, null)).toBe(false)
    expect(isHot({ ...open, important: true, urgent: true, dueDate: day(9) }, DEFAULT_HOT_RULE, today, null)).toBe(true)
  })

  it('completed tasks are never hot', () => {
    const done = { isCompleted: true, urgent: true as const, important: true as const, focus: true as const }
    expect(isHot(done, DEFAULT_HOT_RULE, today, 3)).toBe(false)
    expect(isHot(done, [{ focus: true }], today, 3)).toBe(false)
    expect(matchesHotLine(done, { focus: true }, today, 3)).toBe(false)
  })

  it('an empty line or an empty rule matches nothing', () => {
    expect(matchesHotLine({ ...open, focus: true }, {}, today, 3)).toBe(false)
    expect(isHot({ ...open, focus: true }, [], today, 3)).toBe(false)
  })
})

describe('Hot rule storage', () => {
  it('normalizes: keys in display order, empty lines dropped, duplicates collapsed', () => {
    expect(normalizeHotRule([{ focus: true }, {}, { important: true, urgent: true }, { urgent: true, important: true }]))
      .toEqual([{ focus: true }, { urgent: true, important: true }])
    expect(normalizeHotRule([{}])).toEqual([])
  })

  it('formats as JSON and reads it back', () => {
    const json = formatHotRule(DEFAULT_HOT_RULE)
    expect(json).toBe('[{"urgent":true,"important":true},{"focus":true}]')
    expect(parseHotRule(json)).toEqual(DEFAULT_HOT_RULE)
    expect(hotRulesEqual([{ important: true, urgent: true }, { focus: true }], DEFAULT_HOT_RULE)).toBe(true)
    expect(hotRulesEqual([{ focus: true }, { urgent: true, important: true }], DEFAULT_HOT_RULE)).toBe(false)
  })

  it('accepts at least one line, each with at least one known marker set to true', () => {
    expect(readHotRule([{ urgent: true }])).toEqual([{ urgent: true }])
    expect(readHotRule([{ focus: true }, { focus: true }])).toEqual([{ focus: true }])
  })

  it.each([
    ['not an array', { urgent: true }],
    ['no lines', []],
    ['an empty line', [{ urgent: true }, {}]],
    ['an unknown key', [{ urgent: true, hot: true }]],
    ['a non-true value', [{ urgent: false }]],
    ['a string value', [{ urgent: 'yes' }]],
    ['a line that is an array', [['urgent']]],
    ['a null line', [null]],
  ])('rejects %s', (_name, raw) => {
    expect(readHotRule(raw)).toBeUndefined()
  })

  it('rejects text that is not JSON', () => {
    expect(parseHotRule('urgent+important')).toBeUndefined()
    expect(parseHotRule('')).toBeUndefined()
  })
})
