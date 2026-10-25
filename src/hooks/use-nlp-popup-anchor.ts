import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { usePopoverAnchor, type PopoverAnchor } from './use-popover-anchor'

const POPUP_GAP_PX = 4

/** The `@ # /` popup's width where a field hosts it (`NlpPopup`). */
export const NLP_POPUP_WIDTH_PX = 280

interface AnchorRect { left: number; top: number; right: number; bottom: number }

/**
 * The autocomplete popup's anchor: the input's box from the caret column to
 * its right edge, in the viewport. `usePopoverAnchor` puts the popup below it
 * at the caret, above it when it would clip the bottom edge, and ends it at
 * the input's right edge when it would clip the right one. Null until the
 * input is mounted.
 */
function measureAnchor(input: HTMLInputElement | null, caretLeft: number): AnchorRect | null {
  if (!input) return null
  const r = input.getBoundingClientRect()
  return { left: r.left + caretLeft, top: r.top, right: r.right, bottom: r.bottom }
}

const sameRect = (a: AnchorRect | null, b: AnchorRect | null) =>
  a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom)

const OFFSCREEN: PopoverAnchor = { kind: 'point', x: -9999, y: -9999 }

/**
 * Where a field's `@ # /` popup (`NlpPopup`, portal'd to the body, fixed)
 * goes: `usePopoverAnchor` against the input's box from the caret column
 * (`useNlpAutocomplete`'s `caretLeft`). The rect is static to that hook, so it
 * is re-measured here on scroll (capture) and resize while the popup shows;
 * the hook re-places on the popup's own size changes. Keys and outside
 * presses stay the host's. `popupRef` is the popup's element (a host's
 * outside-press check), `setPopupEl` its ref callback.
 */
export function useNlpPopupAnchor(
  inputRef: RefObject<HTMLInputElement | null>,
  popup: { visible: boolean; caretLeft: number },
) {
  const [anchor, setAnchor] = useState<AnchorRect | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const { visible, caretLeft } = popup

  const measure = useCallback(() => {
    const next = measureAnchor(inputRef.current, caretLeft)
    setAnchor((prev) => (sameRect(prev, next) ? prev : next))
  }, [inputRef, caretLeft])

  useLayoutEffect(() => {
    if (!visible) return
    measure()
  }, [visible, measure])

  useEffect(() => {
    if (!visible) return
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [visible, measure])

  const { panelRef, style } = usePopoverAnchor({
    anchor: anchor ? { kind: 'rect', ...anchor } : OFFSCREEN,
    open: visible,
    offset: POPUP_GAP_PX,
    closeOnScroll: false,
    closeOnResize: false,
    closeOnEscape: false,
    closeOnOutsideClick: false,
    observeSize: true,
    onClose: () => {},
  })
  const setPopupEl = useCallback((el: HTMLDivElement | null) => {
    popupRef.current = el
    panelRef(el)
  }, [panelRef])

  return { popupRef, setPopupEl, style: { top: style.top, left: style.left, width: NLP_POPUP_WIDTH_PX } }
}
