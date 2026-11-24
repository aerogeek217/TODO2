import { useMemo } from 'react'
import type { PlannerTab } from '../../../models/workspace-layout'
import { plannerWindowKey, usePlannerStore } from '../../../stores/planner-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { PlannerResetScope } from '../../../utils/planner'
import type { MenuEntry } from '../../shared/MenuPopover'
import { FunnelIcon, ResetIcon } from '../../shared/icons'
import { openPlannerSettings, UNPLANNED_FILTER_LABEL } from './open-planner-settings'

/** Reset plan's name: its button, its submenu's item, its menu's label. */
export const RESET_PLAN_LABEL = 'Reset plan'

/** Reset plan's choices, in the menu's order; the first is named by the report: `This week`, or the days shown while the window is shifted. */
const RESET_SCOPES: ReadonlyArray<{ scope: PlannerResetScope; label: string; clears: string }> = [
  { scope: 'week', label: 'This week', clears: 'Clears every plan the Planner shows: planned days and Delayed' },
  { scope: 'today', label: 'Today only', clears: 'Clears the plans for today' },
  { scope: 'delayed', label: 'Delayed', clears: 'Clears the plans of the Delayed tasks' },
]

const NO_ENTRIES: MenuEntry[] = []

/**
 * **Reset plan**'s three choices for the Planner `tab` — This week · Today
 * only · Delayed, each with the count of tasks it would clear
 * (`utils/planner.plannerResetCounts`) and inert at 0; with the window
 * shifted the first is named for the days shown (`Nov 27 – Dec 3`), which
 * is what it resets — over the Planner as
 * it shows now: the screen filter's tasks placed for the tab's window, a
 * row lingering after its completion left out. A pick clears those tasks'
 * plan states in one write and one undo step, with the snackbar's Undo
 * (`services/planner-drop.resetPlannerPlan`); no date changes.
 *
 * Read from what the drawn Planner reports (`planner-store.resets`, written
 * by `hooks/use-planner`): nothing is computed here, so a cell's menu costs
 * a Planner no second view and any other cell nothing at all. None without
 * a tab, or for a Planner that isn't drawn (a tab behind another).
 */
export function usePlannerResetEntries(tab: PlannerTab | undefined): MenuEntry[] {
  const key = plannerWindowKey(useWorkspaceStore((s) => s.working?.id), tab?.id ?? '')
  const isPlanner = tab != null
  const report = usePlannerStore((s) => (isPlanner ? s.resets[key] : undefined))
  return useMemo(() => {
    if (!report) return NO_ENTRIES
    return RESET_SCOPES.map(({ scope, label, clears }): MenuEntry => ({
      kind: 'item',
      label: scope === 'week' ? report.week : label,
      note: String(report.counts[scope]),
      disabled: report.counts[scope] === 0,
      description: clears,
      descriptionTooltip: true,
      onSelect: () => report.run(scope),
    }))
  }, [report])
}

/**
 * The Planner's entries in its widget's ⋯ menu: **What counts as
 * unplanned…** (its settings, `PlannerSettings`), then **Reset plan ›**, its
 * three choices a submenu (none while the Planner isn't drawn).
 */
export function usePlannerMenuEntries(tab: PlannerTab | undefined): MenuEntry[] {
  const children = usePlannerResetEntries(tab)
  const tabId = tab?.id
  return useMemo(() => {
    if (tabId == null) return NO_ENTRIES
    const settings: MenuEntry = { kind: 'item', label: `${UNPLANNED_FILTER_LABEL}…`, icon: <FunnelIcon />, onSelect: () => openPlannerSettings(tabId) }
    return children.length === 0 ? [settings] : [settings, { kind: 'item', label: RESET_PLAN_LABEL, icon: <ResetIcon />, children, childrenWidth: 200 }]
  }, [tabId, children])
}
