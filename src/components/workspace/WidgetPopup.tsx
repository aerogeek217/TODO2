import { useEffect, useMemo, useRef, useState } from 'react'
import { REVIEW_POPUP_TAB_ID } from '../../models/review'
import type { LayoutTab, LensTab, ReviewTab } from '../../models/workspace-layout'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { WidgetFaceContext, type WidgetFaceHost } from '../../hooks/use-widget-face'
import { onDataReplaced } from '../../services/replace-data'
import { closeWidgetPopup } from '../../services/widget-popup'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { layoutTabs } from '../../utils/workspace-layout-queries'
import { DialogFrame } from '../shared/Dialog'
import { CloseIcon, MoreIcon } from '../shared/icons'
import { MenuPopover } from '../shared/MenuPopover'
import { widgetKindMenuEntries } from '../shared/widget-kind-menu-entries'
import { useWidgetMenuContent } from './cell-menu'
import { TabIcon } from './TabIcon'
import { WidgetBody, type WidgetResult } from './WidgetBody'
import { useTabTitle } from './widget-hooks'
import styles from './WidgetPopup.module.css'

/** The popup's ⋯ menu's name (and its button's). */
export const WIDGET_POPUP_MENU_LABEL = 'Widget options'

/** The task editor on top owns Esc while it's open. */
const editorIsOpen = () => useUIStore.getState().editPopupMode != null

/**
 * Where the focus goes back in a cell when what opened the popup is gone (a
 * menu item): its active tab, else (alone in its cell) its widget's top line
 * when that takes focus, else the cell's ⋯.
 */
const CELL_FOCUS_TARGETS = [
  '[role="tab"][aria-selected="true"]:not([aria-hidden="true"])',
  '[data-widget-top-line][data-ws-tab][tabindex]',
  '[data-cell-controls] button[aria-label="Cell options"]',
]

function focusTabCell(tabId: string): void {
  const cell = document.querySelector(`[data-ws-cell] [data-ws-tab="${CSS.escape(tabId)}"]`)?.closest('[data-ws-cell]')
  if (!cell) return
  for (const selector of CELL_FOCUS_TARGETS) {
    const el = cell.querySelector<HTMLElement>(selector)
    if (el) {
      el.focus({ preventScroll: true })
      return
    }
  }
}

/**
 * The widget popup's host (on the workspace page; `ui-store.widgetPopup`,
 * opened through `services/widget-popup`): one widget at a time, the tab of
 * the open layout it names — closed when that tab goes (a layout switch, the
 * tab closed) —, the list a Number that follows a list shows, or the popup review (`REVIEW_POPUP_TAB_ID`, its view state
 * `ui-store.popupReviewView`). A data replace closes it, as does the
 * workspace leaving.
 */
export function WidgetPopupHost() {
  const target = useUIStore((s) => s.widgetPopup)
  const reviewView = useUIStore((s) => s.popupReviewView)
  const layoutTab = useWorkspaceStore((s) => (
    target != null && target.kind !== 'review' && s.working ? layoutTabs(s.working).find((t) => t.id === target.tabId) : undefined
  ))
  // A Number that follows a list: the list as a list tab of the Number's id (its prompt picks are the Number's).
  const followedListId = layoutTab?.kind === 'number' && layoutTab.config.show === 'list' ? layoutTab.config.list?.listDefinitionId : undefined
  const listTab = useMemo<LensTab | undefined>(
    () => (layoutTab && followedListId != null ? { id: layoutTab.id, kind: 'lens', config: { listDefinitionId: followedListId } } : undefined),
    [layoutTab, followedListId],
  )
  const reviewTab = useMemo<ReviewTab>(
    () => ({ id: REVIEW_POPUP_TAB_ID, kind: 'review', config: {}, viewState: reviewView }),
    [reviewView],
  )
  const tab: LayoutTab | undefined = target?.kind === 'review' ? reviewTab : target?.kind === 'list' ? listTab : layoutTab
  const gone = target != null && target.kind !== 'review' && tab == null
  useEffect(() => {
    if (gone) closeWidgetPopup()
  }, [gone])
  useEffect(() => onDataReplaced(() => { closeWidgetPopup() }), [])
  useEffect(() => () => { closeWidgetPopup() }, [])
  if (!tab) return null
  return <WidgetPopup key={tab.id} tab={tab} />
}

/**
 * **Open larger**: a widget drawn at its large face (the popup review on a
 * phone at its medium face, as the phone's cells show it) in a popup over
 * the workspace — `min(1400px, 100vw − 48px)` × `100vh − 48px`, centered, on
 * the dialogs' overlay tier, the full screen on a phone. The same tab as the
 * cell's: what is edited here is the cell's. Its header: the tab's icon, its
 * title, the widget's own ⋯ entries (no cell layout entries, no Open larger,
 * no Change widget ›) and ×. What opens from inside (menus, editors, the task
 * editor, the task dialog) is a layer above it. Esc, × or a press on the
 * scrim close it; the focus goes back to what opened it (to the tab's cell
 * when that is gone).
 */
function WidgetPopup({ tab }: { tab: LayoutTab }) {
  const title = useTabTitle(tab)
  const isMobile = useIsMobile()
  const [result, setResult] = useState<WidgetResult | undefined>(undefined)
  const [menuOpen, setMenuOpen] = useState(false)
  const moreRef = useRef<HTMLButtonElement | null>(null)
  const content = useWidgetMenuContent(tab, result)
  const entries = content ? widgetKindMenuEntries({ ...content, kindSwitch: false }) : []
  const hasItems = entries.some((e) => e.kind === 'item')
  const face = useMemo<WidgetFaceHost>(
    () => ({ forced: isMobile && tab.kind === 'review' ? 'medium' : 'large' }),
    [isMobile, tab.kind],
  )
  const tabId = tab.id
  // The focus back to the tab's cell when what opened the popup is gone (a menu item): after the frame's own return.
  useEffect(() => () => {
    window.setTimeout(() => {
      // The page is gone by now (the popup closed with it): nothing to focus.
      if (typeof document === 'undefined') return
      const active = document.activeElement
      if (active == null || active === document.body || !active.isConnected) focusTabCell(tabId)
    }, 0)
  }, [tabId])
  return (
    <DialogFrame
      onClose={closeWidgetPopup}
      layer="overlay"
      initialFocus="panel"
      escapeBelongsElsewhere={() => menuOpen || editorIsOpen()}
      aria-label={title}
      className={`${styles.popup} ${isMobile ? styles.sheet : ''}`}
      data={{ 'widget-popup': tab.id, testid: 'widget-popup' }}
    >
      <div className={styles.header}>
        <TabIcon tab={tab} className={styles.kindIcon} />
        <span className={styles.title} data-testid="widget-popup-title">{title}</span>
        {hasItems && (
          <button
            ref={moreRef}
            type="button"
            className={`${styles.action} ${menuOpen ? styles.actionPressed : ''}`}
            aria-label={WIDGET_POPUP_MENU_LABEL}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={WIDGET_POPUP_MENU_LABEL}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <MoreIcon />
          </button>
        )}
        <button type="button" className={styles.action} aria-label="Close" title="Close" onClick={closeWidgetPopup}>
          <CloseIcon size={12} />
        </button>
      </div>
      <div className={styles.body}>
        <WidgetFaceContext.Provider value={face}>
          <WidgetBody tab={tab} onResult={setResult} />
        </WidgetFaceContext.Provider>
      </div>
      {menuOpen && hasItems && (
        <MenuPopover
          anchorRef={moreRef}
          placement="bottom-end"
          width={248}
          label={WIDGET_POPUP_MENU_LABEL}
          entries={entries}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </DialogFrame>
  )
}
