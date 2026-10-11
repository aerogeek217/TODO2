import type { CellGeometry, ColumnGeometry, Rect, WorkspaceGeometry } from '../../utils/workspace-drop'

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

/**
 * Measures the rendered workspace (`[data-ws-area]`) into the geometry the
 * tab-drag hit test works on. Tabs clipped by a full strip are left out.
 */
export function measureWorkspace(area: HTMLElement): WorkspaceGeometry {
  const columns: ColumnGeometry[] = []
  for (const colEl of Array.from(area.querySelectorAll<HTMLElement>('[data-ws-column]'))) {
    const cells: CellGeometry[] = []
    for (const cellEl of Array.from(colEl.querySelectorAll<HTMLElement>('[data-ws-cell]'))) {
      const id = cellEl.dataset.wsCell ?? ''
      const empty = cellEl.dataset.empty === 'true'
      const headerEl = cellEl.querySelector('[data-ws-cell-header]')
      const bodyEl = cellEl.querySelector('[data-ws-cell-body]')
      const header = headerEl ? rectOf(headerEl) : null
      const listEl = headerEl?.querySelector('[role="tablist"]')
      const visibleRight = listEl ? rectOf(listEl).right : header?.right ?? 0
      const tabs = header
        ? Array.from(cellEl.querySelectorAll<HTMLElement>('[data-ws-tab]'))
            .map((t) => ({ id: t.dataset.wsTab ?? '', rect: rectOf(t) }))
            .filter((t) => t.rect.right <= visibleRight + 0.5 && t.rect.right > t.rect.left)
        : []
      cells.push({ id, rect: rectOf(cellEl), header, body: bodyEl ? rectOf(bodyEl) : null, empty, tabs })
    }
    columns.push({ id: colEl.dataset.wsColumn ?? '', rect: rectOf(colEl), cells })
  }
  return { area: rectOf(area), columns }
}
