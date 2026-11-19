import { describe, expect, it } from 'vitest'
import { createTab } from '../../models/workspace-layout'
import { structureProbe, withStructurePreview } from '../../utils/structure-preview'
import { insertTrackAt, splitCell } from '../../utils/workspace-layout-ops'
import { cell, grid } from '../helpers/layout-builders'

const tab = (id: string) => createTab('notes', id)

describe('structureProbe (the layout edit mode’s previews, round two)', () => {
  // a | b
  // a | c   — a spans both rows: a row inserted between them grows a across it.
  const a = cell('a', [tab('ta')])
  const b = cell('b', [tab('tb')])
  const c = cell('c', [tab('tc')])
  const body = grid([[a, b], [a, c]])

  it('marks an insert’s new empty cells and the filled cells that grow across the new track', () => {
    const probe = structureProbe(body, (l, genId) => insertTrackAt(l, 'rows', 1, genId).layout)
    expect(probe).not.toBeNull()
    expect(probe!.body.grid.rows).toHaveLength(3)
    // Only column B gets a new cell; a grows across the new row.
    expect(probe!.newCellIds).toHaveLength(1)
    expect(probe!.grewCellIds).toEqual(['a'])
    const fresh = probe!.body.cells.find((x) => x.id === probe!.newCellIds[0])
    expect(fresh?.tabs).toEqual([])
    expect(fresh?.area).toMatchObject({ col: 1, row: 1, colSpan: 1, rowSpan: 1 })
  })

  it('marks a split’s new half; its probe ids are never a layout’s own', () => {
    const probe = structureProbe(body, (l, genId) => splitCell(l, 'b', 'right', genId).layout)
    expect(probe!.newCellIds).toHaveLength(1)
    expect(body.cells.some((x) => x.id === probe!.newCellIds[0])).toBe(false)
    // A new column through b's track: c (below it) grows across it too.
    expect(probe!.grewCellIds).toEqual(['c'])
  })

  it('is null when the edit changes nothing', () => {
    expect(structureProbe(body, (l) => l)).toBeNull()
  })

  it('draws the layout as the probe: every cell at its new area (an unmoved one the same object), then the new cells', () => {
    const probe = structureProbe(body, (l, genId) => insertTrackAt(l, 'rows', 1, genId).layout)!
    const drawn = withStructurePreview(body, probe.body, probe.newCellIds)
    expect(drawn.grid).toBe(probe.body.grid)
    expect(drawn.cells.map((x) => x.id)).toEqual(['a', 'b', 'c', ...probe.newCellIds])
    expect(drawn.cells[1]).toBe(body.cells[1])
    expect(drawn.cells[0]?.area.rowSpan).toBe(3)
    // A probe that dropped a cell: the layout as it is.
    expect(withStructurePreview(body, { grid: body.grid, cells: [] }, [])).toBe(body)
  })
})
