import { describe, expect, it } from 'vitest'
import type { GraphicalLineItem as LineItem } from '../../utils/filter-chips'
import {
  rowId, rowOrderOf, sortedRows, withGroupsDissolved, withoutChipRow, withoutGroupRow, withoutPriorityRow, withRowRenamed, withRowsAdded,
  type ChipRef, type RowRef,
} from '../../utils/filter-row-order'

const chip = (field: string, extra: { dateField?: string; markerIndex?: number } = {}): LineItem =>
  ({ kind: 'chip', chip: { field, label: field, value: '', ...extra } as never })
const group = (index: number): LineItem => ({ kind: 'orGroup', index, chips: [] })
const ids = (order: readonly RowRef[]) => order.map(rowId)

describe('filter-row-order', () => {
  const items = [chip('markers', { markerIndex: 0 }), chip('tags'), chip('markers', { markerIndex: 1 }), group(0), chip('dates', { dateField: 'deadline' }), group(1)]

  it('keeps the rows by chipKey, a group by its index', () => {
    expect(ids(rowOrderOf(items))).toEqual(['markers:0', 'tags', 'markers:1', 'group:0', 'dates:deadline', 'group:1'])
  })

  it('a new row goes last; one already there keeps its place', () => {
    const order = rowOrderOf([chip('tags')])
    expect(ids(withRowsAdded(order, [chip('people'), chip('tags')]))).toEqual(['tags', 'people'])
  })

  it('a removed Priority chip takes its row with it, the later ones moving down', () => {
    const order = rowOrderOf(items)
    expect(ids(withoutPriorityRow(order, 0))).toEqual(['tags', 'markers:0', 'group:0', 'dates:deadline', 'group:1'])
    expect(ids(withoutChipRow(order, { field: 'markers', markerIndex: 1 }))).toEqual(['markers:0', 'tags', 'group:0', 'dates:deadline', 'group:1'])
    expect(ids(withoutChipRow(order, { field: 'dates', dateField: 'deadline' }))).toEqual(['markers:0', 'tags', 'markers:1', 'group:0', 'group:1'])
  })

  it('a removed group takes its row, the later groups moving down', () => {
    expect(ids(withoutGroupRow(rowOrderOf(items), 0))).toEqual(['markers:0', 'tags', 'markers:1', 'dates:deadline', 'group:0'])
  })

  it('a written wrap: the group takes the chip’s place', () => {
    const order = rowOrderOf([chip('tags'), chip('people')])
    expect(ids(withRowRenamed(order, { kind: 'chip', chip: { field: 'tags' } }, { kind: 'group', index: 0 }))).toEqual(['group:0', 'people'])
  })

  it('dissolved groups: each chip in its group’s place, Priority after the own conditions in order, later groups down', () => {
    const order = rowOrderOf([chip('markers', { markerIndex: 0 }), group(0), chip('tags'), group(1), group(2)])
    const inGroup = (index: number): ChipRef => (index === 2 ? { field: 'people' } : { field: 'markers', markerIndex: 0 })
    expect(ids(withGroupsDissolved(order, [0, 2], inGroup, 1))).toEqual(['markers:0', 'markers:1', 'tags', 'group:0', 'people'])
    expect(ids(withGroupsDissolved(order, [0, 1], inGroup, 1))).toEqual(['markers:0', 'markers:1', 'tags', 'markers:2', 'group:0'])
    expect(ids(withGroupsDissolved(order, [1], () => null, 1))).toEqual(['markers:0', 'group:0', 'tags', 'group:1'])
  })

  it('sorts the line by the order; a row not in it goes last; a wrapped chip’s group sits in the chip’s place', () => {
    const order = rowOrderOf([chip('people'), chip('tags')])
    const line = [chip('tags'), chip('status'), chip('people')]
    expect(sortedRows(line, order).map((i) => rowId({ kind: 'chip', chip: (i as { chip: ChipRef }).chip }))).toEqual(['people', 'tags', 'status'])
    const wrapped = [chip('people'), group(0)]
    const alias = { row: { kind: 'group', index: 0 } as const, as: { kind: 'chip', chip: { field: 'tags' } } as const }
    expect(sortedRows(wrapped, rowOrderOf([chip('tags'), chip('people')]), alias).map((i) => i.kind)).toEqual(['orGroup', 'chip'])
  })
})
