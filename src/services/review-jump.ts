import { getActiveTab } from '../models/workspace-layout'
import { editorsHoldChanges, leaveOpenEditors } from '../stores/editor-leave'
import type { ReviewFilter } from '../stores/list-widget-store'
import { useUIStore } from '../stores/ui-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { attrSelector, PROMPT_ROW_ATTR, REVIEW_UPDATE_ATTR, REVIEW_WIDGET_ATTR } from '../utils/dom-contract'
import { registerModuleReset } from '../utils/module-reset'
import { panelOfTab } from '../utils/workspace-layout-queries'
import { listReviewFilter } from './review'
import { firstReviewTab, reviewWidgetTarget, setReviewWidgetFilter } from './review-widget'

/**
 * A Review button's jump (widget feedback 2B, J4): every Review entry point —
 * a list's Review these N tasks, `R`, the palette's Review List and Review
 * With ›, the person / tag menu, the top bar's People filter, a Breakdown
 * row's Review and its count columns' counts, the filtered-tasks panel —
 * hands its filter (`services/review`) to `jumpToReview`, which shows it in
 * a Review widget: the open layout's first one (reading order), else the
 * first layout in tab order that has one. Where none exists the buttons are
 * hidden (`hooks/use-review-jump`), never a widget added.
 *
 * **Nothing is saved**: the filter is the widget's temporary one, a jump
 * replaces whatever it was reviewing without asking, and it writes no layout
 * and makes no undo step (a layout switch records what a switch records).
 */

/** Whether a jump has somewhere to go: a Review widget on some layout. */
export function reviewJumpAvailable(): boolean {
  return reviewWidgetTarget() != null
}

/** The jump running, so a second press while its question is up does nothing. */
let jumping = false
registerModuleReset(() => { jumping = false })

/**
 * Shows `filter` in the Review widget a jump goes to (`reviewWidgetTarget`)
 * and moves the focus into it. On another layout it switches there first,
 * the way the layout tabs do (`workspace-store.load`): an open editor with
 * changes asks Save / Discard / Keep editing, and Keep editing cancels the
 * jump. On the open layout an editor with changes asks too when showing the
 * widget would hide another tab of its cell (the editor's subject could be
 * that tab). The task dialog and the filtered-tasks panel, which would cover
 * the widget, close. Resolves whether the filter was shown.
 */
export async function jumpToReview(filter: ReviewFilter | null): Promise<boolean> {
  const target = reviewWidgetTarget()
  if (!target || jumping) return false
  jumping = true
  try {
    let tabId = target.tabId
    const ws = useWorkspaceStore.getState()
    if (!target.open) {
      await ws.load(target.layoutId)
      const after = useWorkspaceStore.getState()
      // Keep editing (or a failed switch): the jump goes no further.
      if (after.activeLayoutId !== target.layoutId || !after.working) return false
      tabId = firstReviewTab(after.working) ?? tabId
    } else if (editorsHoldChanges() && hidesAnotherTab(tabId) && !(await leaveOpenEditors())) {
      return false
    }
    const ui = useUIStore.getState()
    if (ui.taskDialog) ui.hideTaskDialog()
    if (ui.filterPanelOpen) ui.closeFilterPanel()
    setReviewWidgetFilter(tabId, filter)
    focusReviewWidget(tabId)
    return true
  } finally {
    jumping = false
  }
}

/**
 * Reviews list tab `tabId` (its ⋯ menu's Review these N tasks, `R`, the
 * palette's Review List): a jump with the list's filter as it shows its
 * tasks (`listReviewFilter`). False: nothing to review (the tab isn't on
 * screen, or its prompt waits for a pick).
 */
export function reviewListTab(tabId: string): boolean {
  const filter = listReviewFilter(tabId)
  if (!filter) return false
  void jumpToReview(filter)
  return true
}

/** Whether showing Review tab `tabId` makes it its cell's active tab in place of another. */
function hidesAnotherTab(tabId: string): boolean {
  const working = useWorkspaceStore.getState().working
  const cell = working ? panelOfTab(working, tabId) : undefined
  return cell != null && getActiveTab(cell)?.id !== tabId
}

/** How long a jump waits for the widget (and its first card) to render before it gives up on the focus. */
const FOCUS_WAIT_MS = 1500
const FOCUS_STEP_MS = 50
/** Once the widget is there, how many steps it waits for a card before it settles for the field. */
const CARD_STEPS = 4

/**
 * Moves the focus into Review widget `tabId` once it renders (a layout
 * switch, a tab change and its queue land over a few renders): the card's
 * Status update line while a card shows, else its filter field, else (a
 * small face) the first control in its cell.
 */
export function focusReviewWidget(tabId: string): void {
  const started = Date.now()
  let seen = 0
  const attempt = () => {
    const host = document.querySelector<HTMLElement>(attrSelector(REVIEW_WIDGET_ATTR, tabId))
    if (host) {
      const update = host.querySelector<HTMLElement>(attrSelector(REVIEW_UPDATE_ATTR))
      if (update) {
        update.focus()
        return
      }
      seen += 1
      if (seen > CARD_STEPS) {
        const field = host.querySelector<HTMLElement>(`${attrSelector(PROMPT_ROW_ATTR)} textarea`)
        const fallback = field ?? host.querySelector<HTMLElement>('button, [tabindex="0"]')
          ?? host.closest('[data-ws-cell]')?.querySelector<HTMLElement>('button') ?? null
        fallback?.focus()
        return
      }
    }
    if (Date.now() - started < FOCUS_WAIT_MS) window.setTimeout(attempt, FOCUS_STEP_MS)
  }
  window.setTimeout(attempt, 0)
}
