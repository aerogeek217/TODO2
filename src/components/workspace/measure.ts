import type { BandEdge } from '../../models/workspace-layout'
import type { BandGeometry, CellGeometry, ColumnGeometry, Rect, WorkspaceGeometry } from '../../utils/workspace-drop'

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

/** A cell or band card (`[data-ws-cell]`): its header, body and visible tabs. */
function measurePanel(cellEl: HTMLElement): CellGeometry {
  const id = cellEl.dataset.wsCell ?? ''
  const empty = cellEl.dataset.empty === 'true'
  const headerEl = cellEl.querySelector('[data-ws-cell-header]')
  const bodyEl = cellEl.querySelector('[data-ws-cell-body]')
  const header = headerEl ? rectOf(headerEl) : null
  const listEl = headerEl?.querySelector('[role="tablist"]')
  const visibleRight = listEl ? rectOf(listEl).right : header?.right ?? 0
  const tabs = header
    ? Array.from(cellEl.querySelectorAll<HTMLElement>('[data-ws-tab]:not([data-ws-tab-folded])'))
        .map((t) => ({ id: t.dataset.wsTab ?? '', rect: rectOf(t) }))
        .filter((t) => t.rect.right <= visibleRight + 0.5 && t.rect.right > t.rect.left)
    : []
  return { id, rect: rectOf(cellEl), header, body: bodyEl ? rectOf(bodyEl) : null, empty, tabs }
}

/**
 * Measures the rendered workspace (`[data-ws-area]`) into the geometry the
 * drag hit test works on: the bands (`[data-ws-band]`), the column area
 * between them (`[data-ws-columns]`, its visible box) and its columns. Tabs
 * clipped by a full strip are left out.
 */
export function measureWorkspace(area: HTMLElement): WorkspaceGeometry {
  const bands: BandGeometry[] = []
  for (const bandEl of Array.from(area.querySelectorAll<HTMLElement>('[data-ws-band]'))) {
    const edge = bandEl.dataset.wsBand as BandEdge
    bands.push({ ...measurePanel(bandEl), edge })
  }
  const columns: ColumnGeometry[] = []
  for (const colEl of Array.from(area.querySelectorAll<HTMLElement>('[data-ws-column]'))) {
    const cells = Array.from(colEl.querySelectorAll<HTMLElement>('[data-ws-cell]')).map(measurePanel)
    columns.push({ id: colEl.dataset.wsColumn ?? '', rect: rectOf(colEl), cells })
  }
  const areaRect = rectOf(area)
  const columnAreaEl = area.querySelector('[data-ws-columns]')
  return { area: areaRect, columnArea: columnAreaEl ? rectOf(columnAreaEl) : areaRect, columns, bands }
}
