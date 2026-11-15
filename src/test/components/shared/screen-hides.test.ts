import { describe, it, expect } from 'vitest'
import { screenFilterCount, screenUnhideAction } from '../../../components/shared/filters/screen-hides'
import { useFilterStore } from '../../../stores/filter-store'

const base = () => useFilterStore.getInitialState().filters

describe('screenFilterCount and the Clear label', () => {
  it('counts each chip and each top-level term of the typed expression', () => {
    expect(screenFilterCount(base())).toBe(0)
    expect(screenFilterCount({ ...base(), expression: { kind: 'person', id: 1 } })).toBe(1)
    expect(screenFilterCount({ ...base(), expression: { kind: 'and', items: [{ kind: 'person', id: 1 }, { kind: 'tag', id: 2 }] } })).toBe(2)
    expect(screenFilterCount({ ...base(), showCompleted: true, expression: { kind: 'or', items: [{ kind: 'person', id: 1 }, { kind: 'tag', id: 2 }] } })).toBe(2)
  })

  it('reads plural from two filters, an expression of two terms among them', () => {
    expect(screenUnhideAction(1).label).toBe('Clear screen filter')
    expect(screenUnhideAction(screenFilterCount({ ...base(), expression: { kind: 'and', items: [{ kind: 'person', id: 1 }, { kind: 'tag', id: 2 }] } })).label).toBe('Clear screen filters')
  })
})
