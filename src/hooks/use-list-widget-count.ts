import { getUnsavedListIds } from '../stores/list-draft-store'
import { useSettingsStore } from '../stores/settings-store'
import { useWorkspaceStore, type WorkspaceState } from '../stores/workspace-store'
import { countListTabs } from '../utils/workspace-layout-ops'

/**
 * How many widgets show list `listDefinitionId` across every layout — list
 * tabs on it, and Eisenhower tabs while the app-wide Eisenhower source is
 * that list (`eisenhowerListId`, by default the setting as it is now): the
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

/**
 * The list with unsaved edits that would be left with no widget if the
 * app-wide Eisenhower source became `nextListId` — the current source list,
 * when Eisenhower tabs and no other widget show it —, as a list of ids
 * (empty when none): what to ask about (`UnsavedPrompt`) before changing
 * the source. A list no widget shows now loses nothing to the change.
 */
export function listsLosingLastWidgetToSource(nextListId: number | null): number[] {
  const current = useSettingsStore.getState().eisenhowerListId
  if (current == null || current === nextListId || !getUnsavedListIds().includes(current)) return []
  const workspace = useWorkspaceStore.getState()
  const shownNow = countListWidgets(workspace, current, undefined, current) > 0
  return shownNow && countListWidgets(workspace, current, undefined, nextListId) === 0 ? [current] : []
}
