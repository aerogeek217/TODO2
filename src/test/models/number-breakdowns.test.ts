import { describe, expect, it } from 'vitest'
import {
  isNumberBreakdown, NUMBER_BREAKDOWN_LABELS, NUMBER_BREAKDOWNS, pickNumberConfig, type NumberPredicateRead,
} from '../../models/glance-widgets'
import { createTab } from '../../models/workspace-layout'

const read: NumberPredicateRead = () => ({ config: createTab('number', 'n').config.filter, fixed: false })

describe('a Number’s breakdown choices', () => {
  it('people, tags, status and priority, each with its menu label', () => {
    expect(NUMBER_BREAKDOWNS).toEqual(['none', 'people', 'tags', 'status', 'priority'])
    expect(NUMBER_BREAKDOWN_LABELS).toEqual({ none: 'None', people: 'By person', tags: 'By tag', status: 'By status', priority: 'By priority' })
  })

  it('the validator accepts every choice, old and new, and nothing else', () => {
    for (const b of NUMBER_BREAKDOWNS) expect(isNumberBreakdown(b)).toBe(true)
    for (const b of ['due', 'person', '', null, 3]) expect(isNumberBreakdown(b)).toBe(false)
  })

  it('a stored status or priority breakdown is read as is; an unknown one is dropped (a fix)', () => {
    const base = createTab('number', 'n').config
    const filter = { config: base.filter, fixed: false }
    for (const breakdown of ['people', 'tags', 'status', 'priority'] as const) {
      expect(pickNumberConfig({ ...base, breakdown }, filter, read)).toEqual({ config: { ...base, breakdown }, fixed: false })
    }
    expect(pickNumberConfig({ ...base, breakdown: 'due' }, filter, read)).toEqual({ config: base, fixed: true })
  })
})
