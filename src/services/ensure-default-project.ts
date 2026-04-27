import { useProjectStore } from '../stores/project-store'
import { useSettingsStore } from '../stores/settings-store'

/**
 * Resolve a project id to attach a newly-created task to on the given canvas.
 *
 * - If the canvas already has at least one project, return the first one's id.
 * - Otherwise create an "Inbox" project at (0, 0) seeded with the user's
 *   `defaultProjectGroupBy`, persist it as `defaultProjectId`, and return the
 *   new id.
 *
 * Mirrors the orphan-project pattern `useProjectStore.remove` already uses,
 * so a blank-canvas QuickAddBar submit produces a visible task on the first
 * try instead of a write-only IndexedDB row.
 */
export async function ensureDefaultProject(canvasId: number): Promise<number> {
  const onCanvas = useProjectStore.getState().projects.filter((p) => p.canvasId === canvasId)
  const first = onCanvas[0]
  if (first?.id != null) return first.id

  const groupBy = useSettingsStore.getState().defaultProjectGroupBy
  const id = await useProjectStore.getState().add('Inbox', canvasId, 0, 0, groupBy)
  await useSettingsStore.getState().setDefaultProjectId(id)
  return id
}
