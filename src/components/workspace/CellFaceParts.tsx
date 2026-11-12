import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { LayoutTab } from '../../models/workspace-layout'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import { WidgetFaceContext, type WidgetFaceHost } from '../../hooks/use-widget-face'
import { CloseIcon } from '../shared/icons'
import { TabIcon } from './TabIcon'
import { PopoverRoot } from '../shared/PopoverRoot'
import { WidgetBody } from './WidgetBody'
import { useTabTitle } from './widget-hooks'
import styles from './CellFace.module.css'

/** The full widget's popover: about this size, clamped to the viewport. */
const FACE_POPOVER_WIDTH_PX = 720
const FACE_POPOVER_HEIGHT_PX = 520

/**
 * The small face's keyboard way to its full widget: a button over the body,
 * seen only when focused (a click passes through it to the face, whose click
 * the body takes).
 */
export function SmallFaceOpener({ title, open, onOpen }: { title: string; open: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={styles.opener}
      aria-label={`Open ${title}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-face-opener=""
      onClick={(e) => {
        // The body's own click would open it again.
        e.preventDefault()
        onOpen()
      }}
    />
  )
}

/**
 * Where focus goes back in a cell when the small face's opener is gone (the
 * face grew): its active tab, else (alone in its cell) its widget's top line
 * when that takes focus (an inline one, `tabIndex` −1), else the cell's ⋯ —
 * a top line whose controls float over the cell (a Number's label, a small
 * face's line) is a plain line.
 */
const CELL_FOCUS_TARGETS = [
  '[role="tab"][aria-selected="true"]:not([aria-hidden="true"])',
  '[data-widget-top-line][data-ws-tab][tabindex]',
  '[data-cell-controls] button[aria-label="Cell options"]',
]

function cellFocusTarget(cell: HTMLElement): HTMLElement | null {
  for (const selector of CELL_FOCUS_TARGETS) {
    const el = cell.querySelector<HTMLElement>(selector)
    if (el) return el
  }
  return null
}

/** The face every widget in the popover shows: its full one, whatever room the popover has. */
const FULL_FACE: WidgetFaceHost = { forced: 'large' }

/**
 * A small face's full widget (its large face) in a popover over the cell —
 * about 720 × 520, kept in the viewport, under the cell when it fits.
 * Esc, × or a press outside closes it; what opens from inside (a menu, the
 * task editor, the task dialog) is a layer above it.
 */
export function WidgetFacePopover({ tab, anchorRef, onClose }: {
  tab: LayoutTab
  /** The cell it opens over. */
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const title = useTabTitle(tab)
  const panelEl = useRef<HTMLDivElement | null>(null)
  const { panelRef, style, placed } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: anchorRef },
    open: true,
    placement: 'bottom-start',
    closeOnScroll: false,
    closeOnResize: false,
    observeSize: true,
    onClose,
  })
  const setPanel = useCallback((el: HTMLDivElement | null) => {
    panelEl.current = el
    panelRef(el)
  }, [panelRef])
  // Focus goes in once it is placed, and back to where it was (the cell) when it closes from inside —
  // to the cell's active tab (alone in its cell, its widget's top line) when that is gone (the small
  // face's opener, when the face grew).
  useEffect(() => {
    if (!placed) return
    const before = document.activeElement
    const anchor = anchorRef.current
    panelEl.current?.focus({ preventScroll: true })
    return () => {
      const active = document.activeElement
      if (!(active == null || active === document.body || panelEl.current?.contains(active))) return
      if (!(before instanceof HTMLElement) || before === document.body) return
      const back = before.isConnected ? before : anchor ? cellFocusTarget(anchor) : null
      back?.focus({ preventScroll: true })
    }
  }, [placed, anchorRef])
  return createPortal(
    <PopoverRoot
      ref={setPanel}
      className={styles.popover}
      style={{
        position: style.position,
        left: style.left,
        top: style.top,
        width: `min(${FACE_POPOVER_WIDTH_PX}px, calc(100vw - 16px))`,
        height: `min(${FACE_POPOVER_HEIGHT_PX}px, calc(100vh - 16px))`,
      }}
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      data-testid="widget-face-popover"
      data-face-popover={tab.id}
    >
      <div className={styles.header}>
        <TabIcon tab={tab} className={styles.kindIcon} />
        <span className={styles.title}>{title}</span>
        <button type="button" className={styles.close} aria-label="Close" title="Close" onClick={onClose}>
          <CloseIcon size={12} />
        </button>
      </div>
      <div className={styles.body}>
        <WidgetFaceContext.Provider value={FULL_FACE}>
          <WidgetBody tab={tab} />
        </WidgetFaceContext.Provider>
      </div>
    </PopoverRoot>,
    document.body,
  )
}
