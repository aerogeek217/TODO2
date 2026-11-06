import { describe, it, expect } from 'vitest'
import { expandedWeight } from '../../utils/workspace-resize'

describe('expandedWeight', () => {
  it('sums the weights, which may come to under 1 once a part has gone', () => {
    expect(expandedWeight([{ weight: 0.25 }, { weight: 0.25 }])).toBe(0.5)
  })

  it('leaves collapsed parts out: they take no free space', () => {
    expect(expandedWeight([{ weight: 2, collapsed: true }, { weight: 0.5 }, { weight: 0.25, collapsed: false }])).toBe(0.75)
    expect(expandedWeight([{ weight: 1, collapsed: true }])).toBe(0)
  })
})
