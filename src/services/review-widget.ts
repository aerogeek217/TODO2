import type { LayoutBody } from '../models/workspace-layout'
import { useListWidgetStore, type ReviewFilter } from '../stores/list-widget-store'
import { usePersonStore } from '../stores/person-store'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { startOfToday } from '../utils/date'
import { parseExpression, type ExpressionParse } from '../utils/filter-expression'
import { readingOrder } from '../utils/workspace-grid'
import { expressionResolver } from './filter-expression-field'
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

/**
 * Sets Review tab `tabId`'s filter from `text` — what the widget's field
 * takes (`@Aisha or @Ben`, `#q4 and overdue`), names read as the field reads
 * them — and shows the tab, as `setReviewWidgetFilter`. A text that doesn't
 * read changes nothing (the parse says why); an empty one clears the filter.
 */
export function setReviewWidgetFilterText(tabId: string, text: string): ExpressionParse {
  const people = usePersonStore.getState().people
  const tags = useTagStore.getState().tags
  const statuses = useStatusStore.getState().statuses
  const parse = parseExpression(text, { today: startOfToday(), names: expressionResolver(people, tags, statuses) })
  if (parse.ok) setReviewWidgetFilter(tabId, parse.expression ? { expression: parse.expression, showCompleted: parse.showCompleted } : null)
  return parse
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
export interface ReviewWidgetTarget {
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
