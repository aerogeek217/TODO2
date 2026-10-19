import type { EisenhowerQuadrant } from '../../../models/workspace-layout'
import { useUIStore } from '../../../stores/ui-store'

/** The menu item (tab menu, cell menu) that opens the Eisenhower settings. */
export const CUSTOMIZE_PANES_LABEL = 'Customize panes…'

/** The `data-settings-focus` of pane `q`'s name field in Settings › Tasks › Eisenhower. */
export function eisenhowerPaneFocus(q: EisenhowerQuadrant): string {
  return `eisenhower-pane-${q}`
}

/**
 * Opens Settings › Tasks › Eisenhower — where the app-wide source and panes
 * are edited — scrolled to it, with pane `pane`'s name field focused when
 * given (a pane header's Edit pane…).
 */
export function openEisenhowerSettings(pane?: EisenhowerQuadrant): void {
  useUIStore.getState().openSettings('eisenhower', pane ? eisenhowerPaneFocus(pane) : undefined)
}
