import type { GridTrack, LayoutBody, LayoutCell, LayoutTab } from '../models/workspace-layout'
import { withTracks } from './workspace-layout-edit'
import { copySizes, sameTrackIn } from './workspace-layout-sizes'

/**
 * A layout's view state carried onto another table: what an undo or redo of
 * a structural edit keeps of the moment it runs — the sizes (`copySizes`),
 * each row track's collapse where it is the same track in both
 * (`sameTrackIn`), each cell's active tab where the cell (same id) still
 * holds that tab, and each tab's `viewState` where the tab (same id, same
 * kind) is in both. Everything else is `target`'s own. The same object when
 * nothing changes.
 */
export function withViewStateOf<L extends LayoutBody>(target: L, source: LayoutBody): L {
  let next = copySizes(target, source, 'all')
  const rows = next.grid.rows
  const sourceRows = new Map(source.grid.rows.map((t) => [t.id, t]))
  const collapsedRows = rows.map((t): GridTrack => {
    const from = sourceRows.get(t.id)
    if (!from || (from.collapsed === true) === (t.collapsed === true) || !sameTrackIn(next, source, 'rows', t.id)) return t
    if (from.collapsed === true) return { ...t, collapsed: true }
    const { collapsed: _c, ...rest } = t
    void _c
    return rest
  })
  if (collapsedRows.some((t, i) => t !== rows[i])) next = withTracks(next, 'rows', collapsedRows)

  const sourceCells = new Map(source.cells.map((c) => [c.id, c]))
  const sourceTabs = new Map(source.cells.flatMap((c) => c.tabs.map((t) => [t.id, t] as const)))
  let cellsChanged = false
  const cells = next.cells.map((cell): LayoutCell => {
    const from = sourceCells.get(cell.id)
    const active = from?.activeTabId
    const withActive = active !== undefined && active !== cell.activeTabId && cell.tabs.some((t) => t.id === active)
      ? { ...cell, activeTabId: active }
      : cell
    let tabsChanged = false
    const tabs = withActive.tabs.map((tab): LayoutTab => {
      const src = sourceTabs.get(tab.id)
      if (!src || src.kind !== tab.kind || src.viewState === tab.viewState) return tab
      tabsChanged = true
      if (src.viewState === undefined) {
        const { viewState: _v, ...rest } = tab
        void _v
        return rest as LayoutTab
      }
      return { ...tab, viewState: src.viewState } as LayoutTab
    })
    const out = tabsChanged ? { ...withActive, tabs } : withActive
    if (out !== cell) cellsChanged = true
    return out
  })
  if (cellsChanged) next = { ...next, cells }
  return next
}
