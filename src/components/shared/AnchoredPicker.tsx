import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import styles from './AnchoredPicker.module.css'

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
 * On the overlay layer: opened from a row inside an overlay (the task
 * dialog) it mounts after it, so DOM order puts it on top; an overlay opened
 * later (an editor) still covers it.
 */
export function AnchoredPicker({ anchorRef, onClose, closeOnEscape = false, anchorIsInside = true, children }: AnchoredPickerProps) {
  const { panelRef, style } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: anchorRef },
    open: true,
    closeOnScroll: false,
    closeOnResize: false,
    closeOnEscape,
    consumeEscape: true,
    anchorIsInside,
    observeSize: true,
    onClose,
  })
  return createPortal(
    <div ref={panelRef} className={styles.picker} data-anchored-picker="" style={{ position: style.position, left: style.left, top: style.top }}>
      {children}
    </div>,
    document.body,
  )
}
