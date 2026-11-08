import type { CellGeometry, Rect, WorkspaceGeometry } from '../../utils/workspace-drop'

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

/**
 * A cell card (`[data-ws-cell]`): its header, body and visible tabs, and
 * whether it is headless (`[data-headless]`) — what that means for a drop
 * the hit test decides (`workspace-drop.dropStrip`).
 */
function measureCell(cellEl: HTMLElement): CellGeometry {
  const id = cellEl.dataset.wsCell ?? ''
  const empty = cellEl.dataset.empty === 'true'
  const headless = cellEl.dataset.headless === 'true'
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
  return { id, rect: rectOf(cellEl), header, headless, body: bodyEl ? rectOf(bodyEl) : null, empty, tabs }
}

/**
 * Measures the rendered workspace (`[data-ws-area]`) into the geometry the
 * drag hit test works on: the area and every cell of its table
 * (`[data-ws-cell]`). Tabs clipped by a full strip are left out.
 */
export function measureWorkspace(area: HTMLElement): WorkspaceGeometry {
  const cells = Array.from(area.querySelectorAll<HTMLElement>('[data-ws-cell]')).map(measureCell)
  return { area: rectOf(area), cells }
}
