import type { CellGeometry, Rect, TableMetrics, WorkspaceGeometry } from '../../utils/workspace-drop'

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

/**
 * A cell card (`[data-ws-cell]`): its header, body and visible tabs, and its
 * active tab's title (`[data-ws-cell-title]`). A cell of one widget has no
 * header (no strip, D26 AA1): its whole card is its body.
 */
function measureCell(cellEl: HTMLElement): CellGeometry {
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
  const title = cellEl.dataset.wsCellTitle
  const rect = rectOf(cellEl)
  const body = empty ? null : header == null ? rect : bodyEl ? rectOf(bodyEl) : null
  return { id, ...(title ? { title } : {}), rect, header, body, empty, tabs }
}

/** A computed px length (`6px` → 6); 0 when it isn't one. */
function px(value: string): number {
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * The table (`[data-ws-table]`) as the ghost places a drop's result in it:
 * its content corner (its scroll counted), the room inside its padding, the
 * gap, and each row track's drawn height by id (`data-ws-row-tracks`, the
 * ids in order; the sizes from its computed `grid-template-rows`).
 */
export function measureTableElement(table: HTMLElement): TableMetrics {
  const r = table.getBoundingClientRect()
  const style = getComputedStyle(table)
  const padL = px(style.paddingLeft)
  const padT = px(style.paddingTop)
  const ids = (table.dataset.wsRowTracks ?? '').split(' ').filter(Boolean)
  const sizes = style.gridTemplateRows.split(' ').map(px)
  const rowPx: Record<string, number> = {}
  ids.forEach((id, i) => { rowPx[id] = sizes[i] ?? 0 })
  return {
    left: r.left + table.clientLeft + padL - table.scrollLeft,
    top: r.top + table.clientTop + padT - table.scrollTop,
    width: table.clientWidth - padL - px(style.paddingRight),
    height: table.clientHeight - padT - px(style.paddingBottom),
    gap: px(style.columnGap),
    rowPx,
  }
}

/**
 * Measures the rendered workspace (`[data-ws-area]`) into the geometry the
 * drag hit test and the drop ghost work on: the area, every cell of its
 * table (`[data-ws-cell]`; tabs clipped by a full strip left out) and the
 * table's grid.
 */
export function measureWorkspace(area: HTMLElement): WorkspaceGeometry {
  const cells = Array.from(area.querySelectorAll<HTMLElement>('[data-ws-cell]')).map(measureCell)
  const table = area.querySelector<HTMLElement>('[data-ws-table]')
  return { area: rectOf(area), cells, ...(table ? { table: measureTableElement(table) } : {}) }
}
