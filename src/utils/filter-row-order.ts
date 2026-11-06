import { chipKey, type FilterChip, type LineItem } from './filter-chips'

/**
 * The order a filter's rows keep in the editors (`PredicateChips`): the
 * order they were added in. A row keeps its place, a new one goes last, a
 * removed chip's place goes (so the chip added again goes last), a removed
 * or group's place goes with the later groups moving down, and a group made
 * from a chip — or a group that dissolves into its one chip — takes the
 * other's place. Rows are typed refs, compared by `chipKey` (a group by its
 * index): no caller spells a key.
 */

/** A chip by what it filters: its field, a date chip's date type, a Priority chip's condition. */
export type ChipRef = Pick<FilterChip, 'field' | 'dateField' | 'markerIndex'>

/** One row of the line: a chip of the predicate's own, or or group `index`. */
export type RowRef = { kind: 'chip'; chip: ChipRef } | { kind: 'group'; index: number }

/** The order's rows, first to last. */
export type RowOrder = readonly RowRef[]

/** The row `item` is. */
export function rowOf(item: LineItem): RowRef {
  return item.kind === 'chip'
    ? { kind: 'chip', chip: { field: item.chip.field, dateField: item.chip.dateField, markerIndex: item.chip.markerIndex } }
    : { kind: 'group', index: item.index }
}

/** A row's identity (`chipKey` for a chip). */
export function rowId(row: RowRef): string {
  return row.kind === 'chip' ? chipKey(row.chip) : `group:${row.index}`
}

const isPriority = (row: RowRef, index?: number): row is { kind: 'chip'; chip: ChipRef } =>
  row.kind === 'chip' && row.chip.markerIndex !== undefined && (index === undefined || row.chip.markerIndex === index)

/** The order `items` show in now (the order at mount). */
export function rowOrderOf(items: readonly LineItem[]): RowRef[] {
  return items.map(rowOf)
}

/** `order` with the rows of `items` it hasn't got yet, last. */
export function withRowsAdded(order: RowOrder, items: readonly LineItem[]): RowRef[] {
  const have = new Set(order.map(rowId))
  return [...order, ...items.map(rowOf).filter((row) => !have.has(rowId(row)))]
}

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

/** `order` without or group `index`'s row, the later groups' rows moved down. */
export function withoutGroupRow(order: RowOrder, index: number): RowRef[] {
  return order.flatMap((row): RowRef[] => {
    if (row.kind !== 'group') return [row]
    if (row.index === index) return []
    return [row.index > index ? { kind: 'group', index: row.index - 1 } : row]
  })
}

/** `order` with row `from` named `to` in its place (a chip wrapped in a new or group, once written). */
export function withRowRenamed(order: RowOrder, from: RowRef, to: RowRef): RowRef[] {
  const id = rowId(from)
  return order.map((row) => (rowId(row) === id ? to : row))
}

/**
 * `order` once or groups `dissolved` (ascending) went, each into its one
 * chip (`chipOf(index)`; null: none) taking the group's place — a Priority
 * chip after the predicate's own `ownPriority` conditions, in the groups'
 * order — and the later groups moving down.
 */
export function withGroupsDissolved(
  order: RowOrder,
  dissolved: readonly number[],
  chipOf: (index: number) => ChipRef | null,
  ownPriority: number,
): RowRef[] {
  let priority = ownPriority
  const into = new Map(dissolved.map((index) => {
    const chip = chipOf(index)
    const row: RowRef | null = chip == null
      ? null
      : { kind: 'chip', chip: chip.markerIndex !== undefined ? { ...chip, markerIndex: priority++ } : chip }
    return [index, row] as const
  }))
  // Highest first, so each group's index still names it when it goes.
  return [...dissolved].reverse().reduce<RowRef[]>((rows, index) => {
    const row = into.get(index)
    const renamed = row ? rows.map((r) => (r.kind === 'group' && r.index === index ? row : r)) : rows
    return withoutGroupRow(renamed, index)
  }, [...order])
}

/**
 * `items` sorted by `order` (a row not in it — the predicate replaced from
 * outside — after the others, in their own order). `alias`: a row shown
 * under another's place (a chip wrapped in a new group not written yet: the
 * group sits where the chip was).
 */
export function sortedRows(items: readonly LineItem[], order: RowOrder, alias?: { row: RowRef; as: RowRef }): LineItem[] {
  const ids = order.map(rowId)
  const aliasId = alias ? rowId(alias.row) : null
  const asId = alias ? rowId(alias.as) : null
  const position = (item: LineItem) => {
    const id = rowId(rowOf(item))
    const i = ids.indexOf(id === aliasId && asId != null ? asId : id)
    return i < 0 ? ids.length : i
  }
  return [...items].sort((a, b) => position(a) - position(b))
}
