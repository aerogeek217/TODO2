import { useWorkspaceStore, type WorkspaceState } from '../stores/workspace-store'
import { countListTabs } from '../utils/workspace-layout-ops'

/**
 * How many list widgets show list `listDefinitionId` across every layout: the
 * open layout as edited, the others as saved. Tabs in `exceptTabIds` (of the
 * open layout) are not counted.
 */
export function countListWidgets(
  state: Pick<WorkspaceState, 'working' | 'layouts'>,
  listDefinitionId: number,
  exceptTabIds?: ReadonlySet<string>,
): number {
  const { working, layouts } = state
  let n = working ? countListTabs(working, listDefinitionId, exceptTabIds) : 0
  for (const layout of layouts) {
    if (layout.id !== working?.id) n += countListTabs(layout, listDefinitionId)
  }
  return n
}

/** `countListWidgets` for a list, kept current. */
export function useListWidgetCount(listDefinitionId: number | undefined): number {
  return useWorkspaceStore((s) => (listDefinitionId != null ? countListWidgets(s, listDefinitionId) : 0))
}
