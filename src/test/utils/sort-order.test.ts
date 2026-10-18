import { describe, it, expect } from 'vitest'
import { byName, bySortOrder } from '../../utils/sort-order'

describe('bySortOrder', () => {
  it('orders by sortOrder, then id', () => {
    const rows = [{ id: 3, sortOrder: 1 }, { id: 1, sortOrder: 2 }, { id: 2, sortOrder: 1 }]
    expect(rows.toSorted(bySortOrder).map((r) => r.id)).toEqual([2, 3, 1])
  })
})

describe('byName', () => {
  it('orders alphabetically by name, as localeCompare does', () => {
    const names = ['bob', 'Ann', 'Émile', 'carl']
    const rows = names.map((name) => ({ name }))
    expect(rows.toSorted(byName).map((r) => r.name)).toEqual(names.toSorted((a, b) => a.localeCompare(b)))
  })
})
