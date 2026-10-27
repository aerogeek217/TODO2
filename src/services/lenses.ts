import { findLens, type Lens } from '../utils/lens'
import { predicateToCriteria } from '../utils/filter-criteria'
import { matchesFilterWithLookups } from '../utils/filter-match'
import type { TodoNameLookups } from '../utils/filter'
import type { ScreenCountEnv } from './task-dialog'
import { useSettingsStore } from '../stores/settings-store'
import { useUIStore } from '../stores/ui-store'
import { useUndoStore } from '../stores/undo-store'
import { undoable } from '../stores/undoable'

/**
 * Lens actions that reach past the lenses' settings row: the picker's
 * counts, the keyboard's Cycle / Lift lens (the lift is `ui-store`'s), and
 * deleting a lens with the top bar's pick (`settings-store.activeLensId`).
 */

/** What the lens picker shows beside each choice: the open tasks, and how many of them each lens hides. */
export interface LensHideCounts {
  open: number
  hides: ReadonlyMap<string, number>
}

/** How many open tasks each of `lenses` hides right now (`LensHideCounts`), whatever the chips. */
export function lensHideCounts(env: Omit<ScreenCountEnv, 'screen'>, lenses: readonly Lens[]): LensHideCounts {
  const lookups: TodoNameLookups = {
    assignedPeopleMap: env.assignedPeopleMap,
    assignedTagsMap: env.assignedTagsMap,
    statusesById: new Map(env.statuses.map((s) => [s.id!, s])),
  }
  const settings = { ...env.markerSettings, weekStartsOn: env.weekStartsOn }
  const open = env.todos.filter((t) => !t.isCompleted)
  const hides = new Map<string, number>()
  for (const lens of lenses) {
    const keeps = predicateToCriteria(lens.predicate)
    let n = 0
    for (const t of open) if (!matchesFilterWithLookups(keeps, t, lookups, env.today, settings)) n++
    hides.set(lens.id, n)
  }
  return { open: open.length, hides }
}

/**
 * The keyboard's Cycle lens: the top bar's next lens in Settings' order
 * (after the last, No lens; from No lens, the first), its lens back on. With
 * no lens defined the snackbar says where to make one.
 */
export function cycleLens(): void {
  const { lenses, activeLensId } = useSettingsStore.getState()
  if (lenses.length === 0) {
    useUndoStore.getState().notify('No lenses yet — add one in Settings › Tasks › Lenses.')
    return
  }
  const current = findLens(lenses, activeLensId)
  const at = current ? lenses.indexOf(current) : -1
  const next = lenses[at + 1] ?? null
  useUIStore.getState().setLensLifted(false)
  void useSettingsStore.getState().setActiveLens(next?.id ?? null)
}

/** The keyboard's Lift lens: the top bar's lens lifted for now, or put back; without one the snackbar says so. */
export function toggleLensLift(): void {
  const { lenses, activeLensId } = useSettingsStore.getState()
  if (!findLens(lenses, activeLensId)) {
    useUndoStore.getState().notify('No lens to lift.')
    return
  }
  const ui = useUIStore.getState()
  ui.setLensLifted(!ui.lensLifted)
}

/** For an undo / redo: rejects when the pick wasn't saved, so the undo store keeps the entry and says so. */
async function mustPick(id: string | null): Promise<void> {
  if (!(await useSettingsStore.getState().setActiveLens(id))) throw new Error('The lens pick could not be saved')
}

/**
 * Deletes lens `id`; when it is the top bar's pick, the top bar goes to No
 * lens. One undo step with the snackbar: Undo brings the lens back with the
 * pick. Resolves whether it was deleted.
 */
export async function deleteLens(id: string): Promise<boolean> {
  const lens = findLens(useSettingsStore.getState().lenses, id)
  if (!lens) return false
  const description = `Deleted lens “${lens.name}”`
  return useUndoStore.getState().runGroup(description, async () => {
    const settings = useSettingsStore.getState()
    const picked = settings.activeLensId === id
    if (!(await settings.setLenses(settings.lenses.filter((l) => l.id !== id), description))) return false
    // A pick that fails to clear (said by the snackbar) names a lens no more: No lens all the same.
    if (picked && await useSettingsStore.getState().setActiveLens(null)) {
      undoable(description, () => mustPick(null), () => mustPick(id))
    }
    return true
  })
}
