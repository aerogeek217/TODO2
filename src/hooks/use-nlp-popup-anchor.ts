import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { usePopoverAnchor, type PopoverAnchor } from './use-popover-anchor'

const POPUP_GAP_PX = 4

/** The `@ # ! /` popup's width where a field hosts it (`NlpPopup`). */
export const NLP_POPUP_WIDTH_PX = 280

interface AnchorRect { left: number; top: number; right: number; bottom: number }

/**
 * The autocomplete popup's anchor: the input's box from the caret column to
 * its right edge, in the viewport. `usePopoverAnchor` puts the popup below it
 * at the caret, above it when it would clip the bottom edge, and ends it at
 * the input's right edge when it would clip the right one. The caret column
 * is `caretX` (a viewport x) when the host measures it, else `caretLeft` in
 * from the input's left. Null until the input is mounted.
 */
function measureAnchor(input: HTMLElement | null, caretLeft: number, caretX: number | null): AnchorRect | null {
  if (!input) return null
  const r = input.getBoundingClientRect()
  const left = caretX == null ? r.left + caretLeft : Math.min(Math.max(caretX, r.left), r.right)
  return { left, top: r.top, right: r.right, bottom: r.bottom }
}

/**
 * The viewport x of character `index` of a field's text in its mirror (an
 * element holding that text, laid out as the field lays it out — wrapped, and
 * scrolled with it): a wrapping field's caret column, which a one-line
 * measure can't give. Null when the mirror holds no such character.
 */
export function mirrorCharX(mirror: HTMLElement, index: number): number | null {
  const walker = document.createTreeWalker(mirror, NodeFilter.SHOW_TEXT)
  let at = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0
    if (index < at + length) {
      const range = document.createRange()
      // No layout (JSDOM): the host's one-line measure stands.
      if (typeof range.getClientRects !== 'function') return null
      range.setStart(node, index - at)
      range.setEnd(node, index - at + 1)
      const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
      return rect.left
    }
    at += length
  }
  return null
}

const sameRect = (a: AnchorRect | null, b: AnchorRect | null) =>
  a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom)

const OFFSCREEN: PopoverAnchor = { kind: 'point', x: -9999, y: -9999 }

/**
 * Where a field's `@ # ! /` popup (`NlpPopup`, portal'd to the body, fixed)
 * goes: `usePopoverAnchor` against the input's box from the caret column
 * (`useNlpAutocomplete`'s `caretLeft`, or the host's `caret.x` for a field
 * that wraps). The rect is static to that hook, so it
 * is re-measured here on scroll (capture) and resize while the popup shows;
 * the hook re-places on the popup's own size changes. Keys and outside
 * presses stay the host's. `popupRef` is the popup's element (a host's
 * outside-press check), `setPopupEl` its ref callback.
 */
export function useNlpPopupAnchor(
  inputRef: RefObject<HTMLElement | null>,
  popup: { visible: boolean; caretLeft: number },
  /**
   * A wrapping field's caret column, measured by its host (`mirrorCharX`),
   * and what it is measured for (`key`: measured again when it changes).
   */
  caret?: { x: () => number | null; key: unknown },
) {
  const [anchor, setAnchor] = useState<AnchorRect | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const { visible, caretLeft } = popup
  const caretXOf = caret?.x
  const caretKey = caret?.key

  const measure = useCallback(() => {
    // A new key is a new measure (the layout effect below runs again).
    void caretKey
    const next = measureAnchor(inputRef.current, caretLeft, caretXOf?.() ?? null)
    setAnchor((prev) => (sameRect(prev, next) ? prev : next))
  }, [inputRef, caretLeft, caretXOf, caretKey])

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
