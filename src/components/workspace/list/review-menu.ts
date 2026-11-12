import type { LensTab } from '../../../models/workspace-layout'
import { useReviewJumpAvailable } from '../../../hooks/use-review-jump'
import { reviewTasksLabel, sectionTaskIds } from '../../../services/review'
import { reviewListTab } from '../../../services/review-jump'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTodoStore } from '../../../stores/todo-store'
import { shortcutLabel } from '../../../utils/shortcut-bindings'
import type { MenuEntry } from '../../shared/MenuPopover'

/** The tab menu item's label: `Review these 8 tasks` (`Review this task` for one). */
export function reviewMenuLabel(n: number): string {
  return reviewTasksLabel(n)
}

/**
 * A list tab's menu item for a review (widget feedback 2B): **Review these N
 * tasks** — a jump to a Review widget with the list's filter as it shows its
 * tasks (`listReviewFilter`; its manual order and groups don't carry over),
 * N the open tasks the tab shows (each once), its key as the note. Offered
 * while the tab shows an open task and some layout has a Review widget
 * (`useReviewJumpAvailable`); none otherwise (or for no tab).
 */
export function useListReviewMenuEntries(tab: LensTab | undefined): MenuEntry[] {
  const shown = useListWidgetStore((s) => (tab ? s.shown[tab.id] : undefined))
  const todos = useTodoStore((s) => s.todos)
  const overrides = useSettingsStore((s) => s.shortcutOverrides)
  const available = useReviewJumpAvailable()
  if (!tab || !shown || !available) return []
  const open = new Set(todos.filter((t) => !t.isCompleted).map((t) => t.id))
  const n = sectionTaskIds(shown.sections).filter((id) => open.has(id)).length
  if (n === 0) return []
  const keys = shortcutLabel('review-list', overrides)
  return [{
    kind: 'item',
    label: reviewMenuLabel(n),
    ...(keys ? { note: keys } : {}),
    onSelect: () => { reviewListTab(tab.id) },
  }]
}
