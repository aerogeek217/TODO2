import type { CellArea, GridTrack, LayoutBody, LayoutCell, LayoutTab, NumberTab } from '../../models/workspace-layout'
import type { NumberConfig } from '../../models/glance-widgets'
import { numberConfigOfMetric, type V77NumberMetric } from '../../data/upgrades/v78/number-metrics'

/**
 * Builders for workspace layouts in the table shape (D26: grid tracks and
 * cells covering rectangles of them), so a test says what it builds:
 *
 *     const a = cell('a', [tab])
 *     const b = cell('b')
 *     grid([[a, a, b],
 *           [c, d, b]])
 *
 * — each inner array a row track, each entry a column track, each cell
 * covering the tracks where it appears (a rectangle). Tracks are `c1 …` /
 * `r1 …` (or `opts.prefix`-ed), weight 1000 unless `opts` says.
 */

/** A cell before `grid` places it: its id, tabs and active tab. */
export type CellSpec = Omit<LayoutCell, 'area'>

/** A cell holding `tabs` (no active tab unless `extra` says); `grid` gives it its area. */
export function cell(id: string, tabs: LayoutTab[] = [], extra: Partial<Omit<LayoutCell, 'id' | 'tabs' | 'area'>> = {}): CellSpec {
  return { id, tabs, ...extra }
}

/** A track's size and collapse (a number: its weight). */
export type TrackSpec = number | Omit<GridTrack, 'id'>

export interface GridOptions {
  /** The column tracks' sizes (default weight 1000 each). */
  cols?: readonly TrackSpec[]
  /** The row tracks' sizes (default weight 1000 each). */
  rows?: readonly TrackSpec[]
  /** The column / row track ids (default `c1 …` / `r1 …`, after `prefix`). */
  colIds?: readonly string[]
  rowIds?: readonly string[]
  prefix?: string
}

function track(id: string, spec: TrackSpec | undefined): GridTrack {
  if (spec === undefined) return { id, weight: 1000 }
  return typeof spec === 'number' ? { id, weight: spec } : { id, ...spec }
}

/**
 * A layout body from an ASCII-area matrix of cells (by identity, or by id):
 * the tracks it has, each cell's area the rectangle it covers, the cells in
 * reading order. Throws when a cell's places aren't a full rectangle.
 */
export function grid(matrix: ReadonlyArray<ReadonlyArray<CellSpec>>, opts: GridOptions = {}): LayoutBody {
  const rowCount = matrix.length
  const colCount = matrix[0]?.length ?? 0
  const found = new Map<string, { spec: CellSpec; at: Array<[number, number]> }>()
  matrix.forEach((line, r) => {
    if (line.length !== colCount) throw new Error(`grid: row ${r} has ${line.length} tracks, not ${colCount}`)
    line.forEach((spec, c) => {
      const entry = found.get(spec.id) ?? { spec, at: [] }
      entry.at.push([r, c])
      found.set(spec.id, entry)
    })
  })
  const cells: LayoutCell[] = []
  for (const { spec, at } of found.values()) {
    const rs = at.map(([r]) => r)
    const cs = at.map(([, c]) => c)
    const area: CellArea = {
      col: Math.min(...cs),
      row: Math.min(...rs),
      colSpan: Math.max(...cs) - Math.min(...cs) + 1,
      rowSpan: Math.max(...rs) - Math.min(...rs) + 1,
    }
    if (area.colSpan * area.rowSpan !== at.length) throw new Error(`grid: cell ${spec.id} is not a rectangle`)
    cells.push({ ...spec, area })
  }
  cells.sort((a, b) => a.area.row - b.area.row || a.area.col - b.area.col)
  const prefix = opts.prefix ?? ''
  return {
    grid: {
      columns: Array.from({ length: colCount }, (_, i) => track(opts.colIds?.[i] ?? `${prefix}c${i + 1}`, opts.cols?.[i])),
      rows: Array.from({ length: rowCount }, (_, i) => track(opts.rowIds?.[i] ?? `${prefix}r${i + 1}`, opts.rows?.[i])),
    },
    cells,
  }
}

/** A one-cell layout body: `only` over one column and one row. */
export function single(only: CellSpec, opts: GridOptions = {}): LayoutBody {
  return grid([[only]], opts)
}

/** An empty layout body: no tracks, no cells. */
export function emptyBody(): LayoutBody {
  return { grid: { columns: [], rows: [] }, cells: [] }
}

/**
 * A body as an ASCII picture, a line per row track and a cell id per column
 * track — what an op made, for an assertion that reads as a drawing.
 */
export function picture(body: LayoutBody): string[] {
  const out = body.grid.rows.map(() => body.grid.columns.map(() => '.'))
  for (const c of body.cells) {
    for (let r = c.area.row; r < c.area.row + c.area.rowSpan; r++) {
      for (let k = c.area.col; k < c.area.col + c.area.colSpan; k++) {
        const line = out[r]
        if (line) line[k] = c.id
      }
    }
  }
  return out.map((line) => line.join(' '))
}

/**
 * A Number tab counting what a v77 metric counted (`numberConfigOfMetric`:
 * its name, colour and filter), with `patch` over its config.
 */
export function numberTab(id: string, metric: V77NumberMetric = 'open', patch: Partial<NumberConfig> = {}): NumberTab {
  return { id, kind: 'number', config: { ...(numberConfigOfMetric(metric) as unknown as NumberConfig), ...patch } }
}
