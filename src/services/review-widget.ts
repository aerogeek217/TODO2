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
 * a jump goes to (J4).
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

/** The Review widget a jump goes to: its layout, its tab, and whether that layout is the open one. */
export interface ReviewWidgetTarget {
  layoutId: number
  tabId: string
  /** The layout is the open one (no switch needed). */
  open: boolean
}

/**
 * Where a Review button's jump goes (J4): the open layout's first Review
 * widget in reading order, else the first layout in tab order that has one
 * (the caller switches to it — `workspace-store.load`, after the
 * editor-leave question); null when no layout has one (the buttons hide).
 */
export function reviewWidgetTarget(): ReviewWidgetTarget | null {
  const { working, layouts } = useWorkspaceStore.getState()
  return reviewWidgetTargetIn(working, layouts)
}

/**
 * `reviewWidgetTarget` over the given layouts: `working` (the open layout as
 * shown) first, then the others in `layouts`' order (the open one's stored
 * copy skipped). A hook reads it through the store's state.
 */
export function reviewWidgetTargetIn(
  working: (LayoutBody & { id: number }) | null,
  layouts: readonly (LayoutBody & { id: number })[],
): ReviewWidgetTarget | null {
  if (working) {
    const tabId = firstReviewTab(working)
    if (tabId) return { layoutId: working.id, tabId, open: true }
  }
  for (const layout of layouts) {
    if (layout.id === working?.id) continue
    const tabId = firstReviewTab(layout)
    if (tabId) return { layoutId: layout.id, tabId, open: false }
  }
  return null
}
