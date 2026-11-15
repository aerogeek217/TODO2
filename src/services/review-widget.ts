import type { LayoutBody } from '../models/workspace-layout'
import { useListWidgetStore, type ReviewFilter } from '../stores/list-widget-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { readingOrder } from '../utils/workspace-grid'
import { showTab } from './workspace-tabs'

/**
 * What the Review buttons elsewhere (widget feedback 2B, `services/review-jump`)
 * write into a Review widget (2A): its filter — temporary, kept per tab in
 * memory (`list-widget-store.reviewFilters`), never saved — and which widget
 * of the open layout a jump sets.
 */

/**
 * Sets Review tab `tabId`'s filter (`null`: nothing to review) and shows the
 * tab (`showTab`: its cell's active tab, its rows expanded). The tab must be
 * on the open layout to be shown; its filter is kept either way. Nothing is
 * saved.
 */
export function setReviewWidgetFilter(tabId: string, filter: ReviewFilter | null): void {
  useListWidgetStore.getState().setReviewFilter(tabId, filter)
  showTab(tabId)
}

/** The first Review tab of `layout` in reading order (a cell's tabs in strip order), or null. */
export function firstReviewTab(layout: LayoutBody): string | null {
  for (const cell of readingOrder(layout)) {
    const tab = cell.tabs.find((t) => t.kind === 'review')
    if (tab) return tab.id
  }
  return null
}

/** The Review widget a jump sets: its layout (the open one) and its tab. */
interface ReviewWidgetTarget {
  layoutId: number
  tabId: string
}

/**
 * Where a Review button's jump goes: the open layout's first Review widget
 * in reading order; null when it has none (the jump opens the popup review,
 * `services/review-jump`). Other layouts are never switched to.
 */
export function reviewWidgetTarget(): ReviewWidgetTarget | null {
  const { working } = useWorkspaceStore.getState()
  if (!working) return null
  const tabId = firstReviewTab(working)
  return tabId ? { layoutId: working.id, tabId } : null
}
