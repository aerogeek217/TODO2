import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import { useDialogLayer } from './dialog-layer'
import styles from './AnchoredPicker.module.css'
import { PopoverRoot } from './PopoverRoot'
import { KEEP_EVENTS_INSIDE } from './keep-events-inside'

interface AnchoredPickerProps {
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
  /**
   * Esc anywhere closes the picker and stops there. Off for pickers whose
   * search field closes them on Esc itself (`ChipSelector`'s `onClose`).
   */
  closeOnEscape?: boolean
  /** `false` when the anchor isn't the trigger (a click on it then closes the picker). Default `true`. */
  anchorIsInside?: boolean
  children: ReactNode
}

/**
 * A row / bulk-bar picker (status menu, people / tag `ChipSelector`) portalled
 * to the body and placed by `usePopoverAnchor`: below its anchor, flipped
 * above near the bottom edge and to the anchor's right edge near the right
 * one, clamped inside the viewport. It follows the anchor through scrolls,
 * resizes and its own size changes; an outside click closes it, and a click
 * on the trigger is left to the trigger's own toggle.
 *
 * Its pointer events stay inside (`KEEP_EVENTS_INSIDE`): a press in it never
 * starts the row's drag, a click never selects the row, a double-click never
 * opens the editor.
 *
 * On the overlay layer: opened from a row inside an overlay (the task
 * dialog) it mounts after it, so DOM order puts it on top; an overlay opened
 * later (an editor) still covers it. Opened from a dialog on a higher tier
 * (the notes convert preview's draft rows), it sits above that dialog.
 */
export function AnchoredPicker({ anchorRef, onClose, closeOnEscape = false, anchorIsInside = true, children }: AnchoredPickerProps) {
  const layer = useDialogLayer()
  const aboveDialog = layer != null && layer !== 'overlay'
  const { panelRef, style, caret } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: anchorRef },
    open: true,
    closeOnScroll: false,
    closeOnResize: false,
    closeOnEscape,
    consumeEscape: true,
    anchorIsInside,
    observeSize: true,
    onClose,
    caret: true,
  })
  return createPortal(
    <PopoverRoot ref={panelRef} caret={caret} className={`${styles.picker} ${aboveDialog ? styles.aboveDialog : ''}`} data-anchored-picker="" style={{ position: style.position, left: style.left, top: style.top }} {...KEEP_EVENTS_INSIDE}>
      {children}
    </PopoverRoot>,
    document.body,
  )
}
