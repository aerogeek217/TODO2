import { useEffect, useId, useLayoutEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { screenTaskDialog } from '../../services/task-dialog'
import { useFilterStore } from '../../stores/filter-store'
import { useUIStore } from '../../stores/ui-store'
import { attrSelector, SEARCH_INPUT_ATTR, SHOW_FILTERED_TASKS_ATTR, shortcutScope } from '../../utils/dom-contract'
import { tabAcross } from '../../utils/focusables'
import { useBackdropPress } from '../shared/use-backdrop-press'
import { TaskDialogContent } from './TaskDialogContent'
import { FILTER_PANEL_MIN_WIDTH, filterPanelPlacement, type FilterPanelPlacement } from './filter-panel-placement'
import styles from './FilteredTasksPanel.module.css'

/** Off-screen until placed (still focusable, unlike a hidden one). */
const UNPLACED: FilterPanelPlacement = {
  left: -9999, top: -9999, width: FILTER_PANEL_MIN_WIDTH, maxHeight: 400, scrimTop: 0, joinedLeft: true, joinedRight: false,
}

function samePlacement(a: FilterPanelPlacement, b: FilterPanelPlacement): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.maxHeight === b.maxHeight
    && a.scrimTop === b.scrimTop && a.joinedLeft === b.joinedLeft && a.joinedRight === b.joinedRight
}

/** The tray's Show N tasks, else (no filter: the button goes with the panel) its search. */
function focusTrayAfterClose(): void {
  const selector = useFilterStore.getState().isActive ? attrSelector(SHOW_FILTERED_TASKS_ATTR) : attrSelector(SEARCH_INPUT_ATTR)
  document.querySelector<HTMLElement>(selector)?.focus()
}

/** Whether a key on `target` is the panel's: in it, in the top bar, or with nothing focused. */
function isOwnTarget(target: EventTarget | null, panel: HTMLElement | null, topBar: HTMLElement | null): boolean {
  if (!(target instanceof Node) || target === document.body || target === document.documentElement) return true
  return panel?.contains(target) === true || topBar?.contains(target) === true
}

/**
 * The top bar's filtered-tasks panel (desktop, `ui-store.filterPanelOpen`):
 * the screen filter's tasks (`TaskDialogContent` on the `screen` source),
 * dropped from the filter tray's bottom edge and joined to it — the tray
 * above stays the filter's editor (its pickers open above the panel; every
 * change re-resolves the rows). A scrim dims and blurs the workspace below
 * the top bar; a press on it closes the panel.
 *
 * Not modal: the top bar stays live. Opening (and the palette's command
 * while open) focuses the panel; the tray and the panel are one Tab cycle.
 * Esc — once a picker, menu or the editor above has taken its own — closes
 * it from the panel, the top bar or the page, and the focus goes back to
 * Show N tasks. No app shortcut fires from inside it (as from the task
 * dialog it was).
 */
export function FilteredTasksPanel({ trayRef, topBarRef, panelRef, trayLeft }: {
  trayRef: RefObject<HTMLElement | null>
  topBarRef: RefObject<HTMLElement | null>
  panelRef: RefObject<HTMLDivElement | null>
  /** The tray's left while expanded over the bar (it moves without resizing), else `undefined`. */
  trayLeft?: number
}) {
  const close = useUIStore((s) => s.closeFilterPanel)
  const focusKey = useUIStore((s) => s.filterPanelFocusKey)
  const isActive = useFilterStore((s) => s.isActive)
  // What it shows: the screen filter's tasks (the description follows the filter).
  const [payload] = useState(screenTaskDialog)
  const titleId = useId()
  const [place, setPlace] = useState<FilterPanelPlacement>(UNPLACED)
  const scrimPress = useBackdropPress(close)

  // Placed under the tray before paint, and again whenever the tray or the
  // window changes size (a filter's value, the fold, a resize) or the tray
  // expands, slides or comes back.
  useLayoutEffect(() => {
    const tray = trayRef.current
    if (!tray) return
    const update = () => {
      const r = tray.getBoundingClientRect()
      const barBottom = topBarRef.current?.getBoundingClientRect().bottom ?? r.bottom
      const next = filterPanelPlacement(r, barBottom, window.innerWidth, window.innerHeight)
      setPlace((prev) => (samePlacement(prev, next) ? prev : next))
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(tray)
    window.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [trayRef, topBarRef, trayLeft])

  // Focus in on open and on each request while open (the palette's command).
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true })
  }, [focusKey, panelRef])

  // Closed with the focus in it (or lost): back to the tray.
  useEffect(() => {
    const panel = panelRef.current
    return () => {
      const active = document.activeElement
      if (active && active !== document.body && active.isConnected && !panel?.contains(active)) return
      document.querySelector<HTMLElement>(attrSelector(SHOW_FILTERED_TASKS_ATTR))?.focus()
    }
  }, [panelRef])

  // Esc: bubble phase, so pickers / menus (capture phase, consuming theirs)
  // and fields that empty themselves first come first. A dialog open above
  // (the editor, a task dialog, the palette) has the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (useUIStore.getState().editPopupMode != null) return
      if (document.querySelector('[aria-modal="true"]')) return
      if (!isOwnTarget(e.target, panelRef.current, topBarRef.current)) return
      e.preventDefault()
      focusTrayAfterClose()
      close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close, panelRef, topBarRef])

  const corners = `${place.joinedLeft ? styles.joinedLeft : ''} ${place.joinedRight ? styles.joinedRight : ''}`
  return createPortal(
    <>
      <div className={styles.scrim} style={{ top: place.scrimTop }} data-filter-panel-scrim="" {...scrimPress} />
      <div
        ref={panelRef}
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`${styles.panel} ${isActive ? styles.panelActive : ''} ${corners}`}
        style={{ left: place.left, top: place.top, width: place.width, maxHeight: place.maxHeight }}
        data-filter-panel=""
        {...shortcutScope('modal')}
        onKeyDown={(e) => tabAcross(e, panelRef.current, trayRef.current)}
      >
        <TaskDialogContent payload={payload} titleId={titleId} panelRef={panelRef} onClose={close} />
      </div>
    </>,
    document.body,
  )
}
