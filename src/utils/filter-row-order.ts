import { chipKey, type FilterChip, type GraphicalLineItem } from './filter-chips'

/**
 * The order a filter's chips keep in the editors (`PredicateChips`): the
 * order they were added in. A chip keeps its place, a new one goes last, a
 * removed chip's place goes (so the chip added again goes last; a removed
 * Priority chip's later ones move down a condition). Rows are typed refs,
 * compared by `chipKey`: no caller spells a key.
 */

/** A chip by what it filters: its field, a date chip's date type, a Priority chip's condition. */
export type ChipRef = Pick<FilterChip, 'field' | 'dateField' | 'markerIndex'>

/** One row of the line: a chip. */
export type RowRef = { kind: 'chip'; chip: ChipRef }

/** The order's rows, first to last. */
export type RowOrder = readonly RowRef[]

/** The row `item` is. */
export function rowOf(item: GraphicalLineItem): RowRef {
  return { kind: 'chip', chip: { field: item.chip.field, dateField: item.chip.dateField, markerIndex: item.chip.markerIndex } }
}

/** A row's identity (`chipKey`). */
export function rowId(row: RowRef): string {
  return chipKey(row.chip)
}

/** The order `items` show in now (the order at mount). */
export function rowOrderOf(items: readonly GraphicalLineItem[]): RowRef[] {
  return items.map(rowOf)
}

/** `order` with the rows of `items` it hasn't got yet, last. */
export function withRowsAdded(order: RowOrder, items: readonly GraphicalLineItem[]): RowRef[] {
  const have = new Set(order.map(rowId))
  return [...order, ...items.map(rowOf).filter((row) => !have.has(rowId(row)))]
}

const isPriority = (row: RowRef): boolean => row.chip.markerIndex !== undefined

/** `order` without Priority chip `index`'s row, the later Priority chips' rows moved down. */
export function withoutPriorityRow(order: RowOrder, index: number): RowRef[] {
  return order.flatMap((row): RowRef[] => {
    if (!isPriority(row)) return [row]
    const n = row.chip.markerIndex ?? 0
    if (n === index) return []
    return [n > index ? { kind: 'chip', chip: { ...row.chip, markerIndex: n - 1 } } : row]
  })
}

/** `order` without chip `chip`'s row (a Priority chip's: the later ones moved down). */
export function withoutChipRow(order: RowOrder, chip: ChipRef): RowRef[] {
  if (chip.markerIndex !== undefined) return withoutPriorityRow(order, chip.markerIndex)
  const id = chipKey(chip)
  return order.filter((row) => rowId(row) !== id)
}

/** `items` sorted by `order` (a row not in it — the predicate replaced from outside — after the others, in their own order). */
export function sortedRows(items: readonly GraphicalLineItem[], order: RowOrder): GraphicalLineItem[] {
  const ids = order.map(rowId)
  const position = (item: GraphicalLineItem) => {
    const i = ids.indexOf(rowId(rowOf(item)))
    return i < 0 ? ids.length : i
  }
  return [...items].sort((a, b) => position(a) - position(b))
}
