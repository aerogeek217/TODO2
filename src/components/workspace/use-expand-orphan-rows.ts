import { useLayoutEffect } from 'react'
import type { LayoutBody } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { orphanCollapsedRows } from '../../utils/workspace-grid'

/**
 * Expands the collapsed rows of the open layout that nothing can expand
 * (`orphanCollapsedRows`: no filled cell lies only in collapsed rows over
 * them), as view state — written at once, no undo step. The layout ops
 * never leave one (`normalizeGrid`); this is for a table that arrives with
 * one: a layout stored by a build whose ops did (a valid row is opened as
 * stored, without the repair's `normalizeGrid`), or an undo that carried
 * the collapse of the moment onto an older table. Such a row is a header's
 * height with no Expand and no divider on either side.
 */
export function useExpandOrphanRows(layout: LayoutBody): void {
  const setTrackCollapsed = useWorkspaceStore((s) => s.setTrackCollapsed)
  useLayoutEffect(() => {
    const ids = orphanCollapsedRows(layout).flatMap((i) => layout.grid.rows[i]?.id ?? [])
    if (ids.length > 0) void setTrackCollapsed(ids, false)
  }, [layout, setTrackCollapsed])
}
