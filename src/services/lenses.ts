import { findLens, layoutNamesText, layoutsUsingLens } from '../utils/lens'
import { useSettingsStore } from '../stores/settings-store'
import { useUIStore } from '../stores/ui-store'
import { useUndoStore } from '../stores/undo-store'
import { undoable } from '../stores/undoable'
import { useWorkspaceStore } from '../stores/workspace-store'

/**
 * Lens actions that reach past the settings row: deleting a lens takes it
 * off the layouts that picked it.
 */

/** The names of the layouts that picked lens `id` (the open one as edited). */
export function lensUserNames(id: string): string[] {
  const { layouts, working } = useWorkspaceStore.getState()
  return layoutsUsingLens(layouts, working, id).map((l) => l.name)
}

/**
 * Deletes lens `id`. When layouts picked it, asks first ("Used by Default
 * and Planning — they'll show every task"); those layouts go to No lens. One
 * undo step with the snackbar: Undo brings the lens back with the layouts'
 * picks. Resolves whether it was deleted.
 */
export async function deleteLens(id: string): Promise<boolean> {
  const lens = findLens(useSettingsStore.getState().lenses, id)
  if (!lens) return false
  const { layouts, working } = useWorkspaceStore.getState()
  const users = layoutsUsingLens(layouts, working, id)
  if (users.length > 0) {
    const names = layoutNamesText(users.map((l) => `“${l.name}”`))
    const confirmed = await useUIStore.getState().askConfirmation({
      title: `Delete lens “${lens.name}”?`,
      message: `Used by ${names} — ${users.length === 1 ? 'it' : 'they'}’ll show every task.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!confirmed) return false
  }
  const description = `Deleted lens “${lens.name}”`
  const layoutIds = users.map((l) => l.id)
  return useUndoStore.getState().runGroup(description, async () => {
    const remaining = useSettingsStore.getState().lenses.filter((l) => l.id !== id)
    if (!(await useSettingsStore.getState().setLenses(remaining, description))) return false
    if (layoutIds.length > 0) {
      await useWorkspaceStore.getState().setLayoutsLens(layoutIds, null)
      undoable(
        description,
        () => useWorkspaceStore.getState().setLayoutsLens(layoutIds, null),
        () => useWorkspaceStore.getState().setLayoutsLens(layoutIds, id),
      )
    }
    return true
  })
}
