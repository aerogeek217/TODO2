import { usePlannerStore } from '../../../stores/planner-store'
import { openBeside } from '../widget-hooks'

/** The Planner settings' entry in its ⋯ menu (with `…`), and the filter line's name. */
export const WHAT_COUNTS_AS_UNPLANNED = 'What counts as unplanned'

/**
 * Opens a Planner's settings beside it (What counts as unplanned… in its ⋯,
 * the filter line under Unplanned): its tab shown first, as every widget
 * editor (`openBeside`); an editor holding changes is asked first.
 */
export function openPlannerSettings(tabId: string): void {
  if (usePlannerStore.getState().settingsTabId === tabId) return
  openBeside(tabId, () => usePlannerStore.getState().openSettings(tabId))
}
