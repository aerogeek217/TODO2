import { tabBand, type CellGeometry, type FrameInsets, type Rect, type TableMetrics, type WorkspaceGeometry } from '../../utils/workspace-drop'

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

/**
 * A cell card (`[data-ws-cell]`): its header, body and visible tabs, and its
 * active tab's title (`[data-ws-cell-title]`). A cell of one widget has no
 * header (no strip, D26 AA1): its whole card is its body. A strip of
 * Numbers (flair P10) has no header either: its slots
 * (`[data-number-slot]`) are its tabs, in its body (`strip`). In the
 * layout edit mode, also the card's name (`[data-ws-card-name]`) and a
 * one-widget card's tab area (`band`, `cardTabArea`).
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
  const slots = header ? [] : Array.from(cellEl.querySelectorAll<HTMLElement>('[data-number-slot]'))
    .map((s) => ({ id: s.dataset.numberSlot ?? '', rect: rectOf(s) }))
  const title = cellEl.dataset.wsCellTitle
  const rect = rectOf(cellEl)
  const body = empty ? null : header == null ? rect : bodyEl ? rectOf(bodyEl) : null
  const name = cellEl.dataset.wsCardName
  const band = header == null ? cardTabArea(cellEl) : null
  return {
    id,
    ...(title ? { title } : {}),
    ...(name ? { name } : {}),
    rect,
    header,
    body,
    empty,
    tabs: slots.length > 0 ? slots : tabs,
    ...(slots.length > 0 ? { strip: true } : {}),
    ...(band ? { band } : {}),
  }
}

/**
 * In the layout edit mode, a card's tab area — where a drop, or an armed
 * card's click, joins it as tabs: its tab strip (its header), or a
 * one-widget card's top band (`workspace-drop.tabBand`, a header's
 * height). `null` outside the mode, for a Numbers strip (its middle joins
 * it already) and an empty cell.
 */
export function cardTabArea(cellEl: HTMLElement): Rect | null {
  if (!cellEl.closest('[data-layout-editing]') || cellEl.dataset.empty === 'true') return null
  const headerEl = cellEl.querySelector('[data-ws-cell-header]')
  if (headerEl) return rectOf(headerEl)
  if (cellEl.querySelector('[data-number-slot]')) return null
  const headerPx = px(getComputedStyle(cellEl).getPropertyValue('--cell-header-height')) || 32
  return tabBand(rectOf(cellEl), headerPx)
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
function measureTableElement(table: HTMLElement): TableMetrics {
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
 * How far the cells start in from each edge of the area: the area's padding
 * and the table's (the layout edit mode's frame), its scroll not counted —
 * where the drop model's insert zones reach from.
 */
function measureFrame(area: Rect, table: HTMLElement): FrameInsets | null {
  // Not laid out (a test's DOM): none, the drop model's default.
  if (table.clientWidth <= 0 || table.clientHeight <= 0) return null
  const r = table.getBoundingClientRect()
  const style = getComputedStyle(table)
  const left = r.left + table.clientLeft
  const top = r.top + table.clientTop
  return {
    left: left + px(style.paddingLeft) - area.left,
    top: top + px(style.paddingTop) - area.top,
    right: area.right - (left + table.clientWidth - px(style.paddingRight)),
    bottom: area.bottom - (top + table.clientHeight - px(style.paddingBottom)),
  }
}

/**
 * Measures the rendered workspace (`[data-ws-area]`) into the geometry the
 * drag hit test and the drop ghost work on: the area, where its cells start
 * in from its edges, every cell of its table (`[data-ws-cell]`; tabs
 * clipped by a full strip left out) and the table's grid.
 */
export function measureWorkspace(area: HTMLElement): WorkspaceGeometry {
  const cells = Array.from(area.querySelectorAll<HTMLElement>('[data-ws-cell]')).map(measureCell)
  const table = area.querySelector<HTMLElement>('[data-ws-table]')
  const box = rectOf(area)
  const frame = table ? measureFrame(box, table) : null
  return { area: box, cells, ...(table ? { table: measureTableElement(table) } : {}), ...(frame ? { frame } : {}) }
}
