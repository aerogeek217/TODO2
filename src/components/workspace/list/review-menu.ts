import type { LensTab } from '../../../models/workspace-layout'
import { queueOfSections, reviewListTab, reviewTasksLabel } from '../../../services/review'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { shortcutLabel } from '../../../utils/shortcut-bindings'
import type { MenuEntry } from '../../shared/MenuPopover'

/** The tab menu item's label: `Review these 8 tasks` (`Review this task` for one). */
export function reviewMenuLabel(n: number): string {
  return reviewTasksLabel(n)
}

/**
 * A list tab's menu item for the review deck (D26): **Review these N
 * tasks**, the tab's tasks as it shows them (`list-widget-store.shown`) one
 * card at a time, its key as the note. Offered while the tab shows a task;
 * none otherwise (or for no tab).
 */
export function useListReviewMenuEntries(tab: LensTab | undefined): MenuEntry[] {
  const shown = useListWidgetStore((s) => (tab ? s.shown[tab.id] : undefined))
  const overrides = useSettingsStore((s) => s.shortcutOverrides)
  if (!tab || !shown) return []
  const n = queueOfSections(shown.sections, false).ids.length
  if (n === 0) return []
  const keys = shortcutLabel('review-list', overrides)
  return [{
    kind: 'item',
    label: reviewMenuLabel(n),
    ...(keys ? { note: keys } : {}),
    onSelect: () => { reviewListTab(tab.id) },
  }]
}
