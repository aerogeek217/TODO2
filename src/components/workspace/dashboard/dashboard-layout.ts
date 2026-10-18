/** Columns of the dashboard's body grid. */
export const DASHBOARD_GRID_COLUMNS = 12

/** Below this cell width the dashboard is one scrolling column. */
export const DASHBOARD_WIDE_MIN_PX = 1100

/** Built-in tiles per row (more start a second row). */
export const TILES_PER_ROW = 6

export interface PlacedSection<Id extends string> {
  id: Id
  /** Grid columns it spans (its default span, or more as a row's last). */
  span: number
}

/**
 * Lays the shown sections out in rows of the 12-column grid: in order, each
 * with its default span, a new row whenever the next one doesn't fit; the
 * last section of a row stretches to fill it. So hiding a section re-flows
 * the rest without gaps.
 */
export function packSections<Id extends string>(
  sections: ReadonlyArray<{ id: Id; span: number }>,
  columns = DASHBOARD_GRID_COLUMNS,
): PlacedSection<Id>[][] {
  const rows: PlacedSection<Id>[][] = []
  let row: PlacedSection<Id>[] = []
  let used = 0
  const close = () => {
    const last = row.at(-1)
    if (last) {
      last.span += columns - used
      rows.push(row)
    }
    row = []
    used = 0
  }
  for (const s of sections) {
    const span = Math.max(1, Math.min(columns, s.span))
    if (used + span > columns) close()
    row.push({ id: s.id, span })
    used += span
  }
  close()
  return rows
}

/**
 * The grid's row track sizes for the section rows: every row shares the
 * leftover height, except that with two or more rows the last one is a
 * fixed 272px band (the charts' row).
 */
export function sectionRowTracks(rowCount: number): string[] {
  if (rowCount === 0) return []
  if (rowCount === 1) return ['minmax(0, 1fr)']
  return [...Array.from({ length: rowCount - 1 }, () => 'minmax(0, 1fr)'), '272px']
}
