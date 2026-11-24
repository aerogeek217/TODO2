import { useLayoutEffect } from 'react'
import type { LayoutBody } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { orphanCollapsedTracks } from '../../utils/workspace-grid'

/**
 * Expands the collapsed rows and columns of the open layout that nothing
 * can expand (`orphanCollapsedTracks`: no filled cell lies only in collapsed
 * tracks of that axis over them), as view state — written at once, no undo
 * step. The layout ops never leave one (`normalizeGrid`); this is for a
 * table that arrives with one: a layout stored by a build whose ops did (a
 * valid row is opened as stored, without the repair's `normalizeGrid`), or
 * an undo that carried the collapse of the moment onto an older table. Such
 * a track is a header's (a strip's) size with no Expand and no divider on
 * either side.
 */
export function useExpandOrphanTracks(layout: LayoutBody): void {
  const setTrackCollapsed = useWorkspaceStore((s) => s.setTrackCollapsed)
  useLayoutEffect(() => {
    const ids = (['columns', 'rows'] as const).flatMap((axis) => orphanCollapsedTracks(layout, axis).flatMap((i) => layout.grid[axis][i]?.id ?? []))
    if (ids.length > 0) void setTrackCollapsed(ids, false)
  }, [layout, setTrackCollapsed])
}
