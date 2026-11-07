import { describe, expect, it } from 'vitest'
import type { GraphicalLineItem as LineItem } from '../../utils/filter-chips'
import { rowId, rowOrderOf, sortedRows, withoutChipRow, withRowsAdded, type ChipRef, type RowRef } from '../../utils/filter-row-order'

const chip = (field: string, extra: { dateField?: string; markerIndex?: number } = {}): LineItem =>
  ({ kind: 'chip', chip: { field, label: field, value: '', ...extra } as never })
const ids = (order: readonly RowRef[]) => order.map(rowId)

describe('filter-row-order', () => {
  const items = [chip('markers', { markerIndex: 0 }), chip('tags'), chip('dates', { dateField: 'deadline' }), chip('dates', { dateField: 'followup' })]

  it('keeps the rows by chipKey', () => {
    expect(ids(rowOrderOf(items))).toEqual(['markers:0', 'tags', 'dates:deadline', 'dates:followup'])
  })

  it('a new row goes last; one already there keeps its place', () => {
    const order = rowOrderOf([chip('tags')])
    expect(ids(withRowsAdded(order, [chip('people'), chip('tags')]))).toEqual(['tags', 'people'])
  })

  it('a removed chip takes its row with it (a date chip only its date type’s)', () => {
    const order = rowOrderOf(items)
    expect(ids(withoutChipRow(order, { field: 'markers', markerIndex: 0 }))).toEqual(['tags', 'dates:deadline', 'dates:followup'])
    expect(ids(withoutChipRow(order, { field: 'dates', dateField: 'deadline' }))).toEqual(['markers:0', 'tags', 'dates:followup'])
  })

  it('sorts the line by the order; a row not in it goes last', () => {
    const order = rowOrderOf([chip('people'), chip('tags')])
    const line = [chip('tags'), chip('status'), chip('people')]
    expect(sortedRows(line, order).map((i) => rowId({ kind: 'chip', chip: i.chip as ChipRef }))).toEqual(['people', 'tags', 'status'])
  })
})
