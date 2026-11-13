import { REVIEW_POPUP_TAB_ID } from '../models/review'
import { closeOpenEditors, editorsHoldChanges, leaveOpenEditors } from '../stores/editor-leave'
import { useListWidgetStore, type ReviewFilter } from '../stores/list-widget-store'
import { useUIStore, type WidgetPopupTarget } from '../stores/ui-store'

/**
 * The widget popup (**Open larger**): one widget at a time drawn at its large
 * face over the workspace (`WidgetPopupHost`, its state `ui-store.widgetPopup`)
 * — a tab of the open layout (the same tab, not a copy: its filter, sort,
 * zoom, lens switch and edits are the cell's), or the popup review, a Review
 * widget tied to no layout tab (`REVIEW_POPUP_TAB_ID`), where a Review button
 * goes when the open layout has none (`services/review-jump`).
 *
 * The popup covers the workspace, as Settings does: an open editor holding
 * changes (Edit list, a widget editor) asks Save / Discard / Keep editing
 * first (`editor-leave`; Keep editing opens nothing), and an unchanged one
 * closes. An editor opened from inside the popup is a layer above it.
 */

/**
 * Shows `target` in the popup, replacing what it showed (`before` runs just
 * before it shows). Resolves whether it did — false on Keep editing.
 */
async function openPopup(target: WidgetPopupTarget, before?: () => void): Promise<boolean> {
  if (editorsHoldChanges() && !(await leaveOpenEditors())) return false
  closeOpenEditors()
  before?.()
  useUIStore.getState().setWidgetPopup(target)
  return true
}

/** Opens tab `tabId` of the open layout larger; resolves whether it opened. */
export async function openWidgetLarger(tabId: string): Promise<boolean> {
  const open = useUIStore.getState().widgetPopup
  if (open?.kind === 'tab' && open.tabId === tabId) return true
  return openPopup({ kind: 'tab', tabId })
}

/** Opens the list Number tab `tabId` follows (Follow a list) larger; resolves whether it opened. */
export function openNumberList(tabId: string): Promise<boolean> {
  return openPopup({ kind: 'list', tabId })
}

/**
 * Opens the popup review with `filter` (`null`: nothing picked), replacing
 * whatever it reviewed; resolves whether it opened. Its review lasts until
 * a different filter replaces it, a data replace or a reload — closing the
 * popup keeps it, and opening it again with the same filter continues where
 * it stood.
 */
export function openReviewPopup(filter: ReviewFilter | null): Promise<boolean> {
  return openPopup({ kind: 'review' }, () => useListWidgetStore.getState().setReviewFilter(REVIEW_POPUP_TAB_ID, filter))
}

/** Closes the popup (the popup review's filter and place are kept). */
export function closeWidgetPopup(): void {
  useUIStore.getState().closeWidgetPopup()
}
