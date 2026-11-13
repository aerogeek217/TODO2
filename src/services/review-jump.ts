import { getActiveTab, tabIgnoresLens } from '../models/workspace-layout'
import { REVIEW_POPUP_TAB_ID } from '../models/review'
import { editorsHoldChanges, leaveOpenEditors } from '../stores/editor-leave'
import type { ReviewFilter } from '../stores/list-widget-store'
import { useUIStore } from '../stores/ui-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { attrSelector, PROMPT_ROW_ATTR, REVIEW_UPDATE_ATTR, REVIEW_WIDGET_ATTR } from '../utils/dom-contract'
import { registerModuleReset } from '../utils/module-reset'
import { getTab, panelOfTab } from '../utils/workspace-layout-queries'
import { listReviewFilter, type ReviewJump } from './review'
import { reviewWidgetTarget, setReviewWidgetFilter } from './review-widget'
import { openReviewPopup } from './widget-popup'

/**
 * A Review button's jump: every Review entry point — a list's Review these N
 * tasks, `R`, the palette's Review List and Review With ›, the person / tag
 * menu, the top bar's People filter, a Breakdown row's Review and its count
 * columns' counts, the filtered-tasks panel — hands its filter
 * (`services/review`) to `jumpToReview`, which shows it in a Review widget:
 * the open layout's first one (reading order) when it has one, else the
 * popup review (`services/widget-popup`: a Review widget in the widget popup,
 * tied to no layout tab). The buttons are always there, the phone's too.
 *
 * **Nothing is saved**: the filter is the widget's temporary one, a jump
 * replaces whatever it was reviewing without asking — a new filter starts
 * the review over, the same one sent again resumes it (`ReviewWidget`) —,
 * and it writes no layout and makes no undo step. One thing follows the
 * button: the widget's lens switch, set to the source's when the source has
 * one (`ReviewJump.ignoreLens`: a list, a Breakdown, the top bar), so the
 * widget shows the tasks the button counted — view state, written only when
 * it differs (the popup review's in memory).
 */

/** The jump running, so a second press while its question is up does nothing. */
let jumping = false
registerModuleReset(() => { jumping = false })

/**
 * Shows `filter` in a Review widget and moves the focus into it. The open
 * layout's Review widget (`reviewWidgetTarget`), when it has one: an open
 * editor with changes asks Save / Discard / Keep editing first when showing
 * the widget would hide another tab of its cell (the editor's subject could
 * be that tab), and Keep editing cancels the jump; the widget popup closes
 * unless it shows that very widget. Else the popup review, opened with the
 * filter (an editor with changes asked first, as the popup asks). The task
 * dialog and the filtered-tasks panel, which would cover the widget, close.
 * Resolves whether the filter was shown.
 */
export async function jumpToReview(jump: ReviewJump | null): Promise<boolean> {
  if (jumping) return false
  jumping = true
  try {
    // The widget keeps the filter alone; the source's lens switch goes to the widget's own.
    const filter: ReviewFilter | null = jump ? { expression: jump.expression, showCompleted: jump.showCompleted } : null
    const ignoreLens = jump?.ignoreLens
    const target = reviewWidgetTarget()
    if (!target) {
      if (!(await openReviewPopup(filter))) return false
      closeCovers()
      const ui = useUIStore.getState()
      if (ignoreLens != null && (ui.popupReviewView.ignoreLens === true) !== ignoreLens) ui.patchPopupReviewView({ ignoreLens })
      focusReviewWidget(REVIEW_POPUP_TAB_ID)
      return true
    }
    const tabId = target.tabId
    if (editorsHoldChanges() && hidesAnotherTab(tabId) && !(await leaveOpenEditors())) return false
    closeCovers()
    const ui = useUIStore.getState()
    const popup = ui.widgetPopup
    if (popup && !(popup.kind === 'tab' && popup.tabId === tabId)) ui.closeWidgetPopup()
    if (ignoreLens != null) setWidgetLensSwitch(tabId, ignoreLens)
    setReviewWidgetFilter(tabId, filter)
    focusReviewWidget(tabId)
    return true
  } finally {
    jumping = false
  }
}

/** Sets Review tab `tabId`'s lens switch (its view state, saved at once) when it isn't `ignoreLens` already. */
function setWidgetLensSwitch(tabId: string, ignoreLens: boolean): void {
  const ws = useWorkspaceStore.getState()
  const tab = ws.working ? getTab(ws.working, tabId) : undefined
  if (tab?.kind !== 'review' || tabIgnoresLens(tab) === ignoreLens) return
  void ws.patchTabViewState(tabId, 'review', { ignoreLens })
}

/** The task dialog and the filtered-tasks panel close: they would cover the widget. */
function closeCovers(): void {
  const ui = useUIStore.getState()
  if (ui.taskDialog) ui.hideTaskDialog()
  if (ui.filterPanelOpen) ui.closeFilterPanel()
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

/** The focus wait in flight: one at a time — a later jump's takes its place, and a reset drops it. */
let focusWait: ReturnType<typeof setTimeout> | null = null
function stopFocusWait(): void {
  if (focusWait != null) clearTimeout(focusWait)
  focusWait = null
}
registerModuleReset(stopFocusWait)

/**
 * Moves the focus into Review widget `tabId` once it renders (a layout
 * switch, a tab change and its queue land over a few renders): the card's
 * Status update line while a card shows, else its filter field, else (a
 * small face) the first control in its cell. Only the latest call waits:
 * an earlier one still looking for its widget gives up.
 */
export function focusReviewWidget(tabId: string): void {
  stopFocusWait()
  const started = Date.now()
  let seen = 0
  const attempt = () => {
    focusWait = null
    // The page is gone (the wait outlived it): nothing to focus.
    if (typeof document === 'undefined') return
    // A stored tab id is any string: escaped, so one with a quote or a backslash still makes a selector.
    const host = document.querySelector<HTMLElement>(attrSelector(REVIEW_WIDGET_ATTR, CSS.escape(tabId)))
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
    if (Date.now() - started < FOCUS_WAIT_MS) focusWait = setTimeout(attempt, FOCUS_STEP_MS)
  }
  focusWait = setTimeout(attempt, 0)
}
