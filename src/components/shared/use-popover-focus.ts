import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { tabbables } from '../../utils/focusables'

/**
 * Focus back on the trigger once its popover closes, when the focus went
 * with the popover (it was inside and is now nowhere) — as a dialog gives it
 * back to its opener. A close that moved the focus elsewhere (a click on
 * another control, a dialog the popover opened) keeps it there.
 */
export function useReturnFocus(open: boolean, triggerRef: RefObject<HTMLElement | null>): void {
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open) {
      wasOpen.current = true
      return
    }
    if (!wasOpen.current) return
    wasOpen.current = false
    const active = document.activeElement
    if (!active || active === document.body || !active.isConnected) triggerRef.current?.focus()
  }, [open, triggerRef])
}

/**
 * A non-modal popover that holds the keyboard like a dialog while it is open
 * (the storage pill's): the focus moves to its first control when it opens,
 * Tab and Shift+Tab wrap inside it, and the focus returns to the trigger when
 * it closes (`useReturnFocus`). A press outside still closes it — the page
 * behind stays usable, so it is not `aria-modal`.
 *
 * Returns the panel's key handler.
 */
export function usePopoverFocus({ open, panelRef, triggerRef }: {
  open: boolean
  panelRef: RefObject<HTMLElement | null>
  triggerRef: RefObject<HTMLElement | null>
}): (e: ReactKeyboardEvent<HTMLElement>) => void {
  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel || panel.contains(document.activeElement)) return
    ;(tabbables(panel)[0] ?? panel).focus()
  }, [open, panelRef])
  useReturnFocus(open, triggerRef)
  return (e) => {
    if (e.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    const items = tabbables(panel)
    const first = items.at(0)
    const last = items.at(-1)
    const active = document.activeElement
    if (!first || !last) {
      e.preventDefault()
      panel.focus()
    } else if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }
}
