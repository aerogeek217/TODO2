import { useSettingsStore } from '../stores/settings-store'
import { useWorkspaceStore, type WorkspaceState } from '../stores/workspace-store'
import { countListTabs } from '../utils/workspace-layout-ops'

/**
 * How many widgets show list `listDefinitionId` across every layout — list
 * tabs on it, and Eisenhower tabs when it is the Eisenhower's own list
 * (`eisenhowerListId`, by default the setting as it is now): the
 * open layout as edited, the others as saved. Tabs in `exceptTabIds` (of
 * the open layout) are not counted.
 */
export function countListWidgets(
  state: Pick<WorkspaceState, 'working' | 'layouts'>,
  listDefinitionId: number,
  exceptTabIds?: ReadonlySet<string>,
  eisenhowerListId: number | null = useSettingsStore.getState().eisenhowerListId,
): number {
  const { working, layouts } = state
  let n = working ? countListTabs(working, listDefinitionId, eisenhowerListId, exceptTabIds) : 0
  for (const layout of layouts) {
    if (layout.id !== working?.id) n += countListTabs(layout, listDefinitionId, eisenhowerListId)
  }
  return n
}

/** `countListWidgets` for a list, kept current. */
export function useListWidgetCount(listDefinitionId: number | undefined): number {
  const eisenhowerListId = useSettingsStore((s) => s.eisenhowerListId)
  return useWorkspaceStore((s) => (listDefinitionId != null ? countListWidgets(s, listDefinitionId, undefined, eisenhowerListId) : 0))
}
