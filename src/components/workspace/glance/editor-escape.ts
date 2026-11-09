import { useEffect, type RefObject } from 'react'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { isInLayerAbove } from '../../../utils/dom-layers'

/** A key that landed on the page itself: nothing is focused. */
function isPageTarget(target: EventTarget | null): boolean {
  return !(target instanceof Element) || target === document.body || target === document.documentElement
}

/**
 * Esc closes the editor when it comes from inside it (or with nothing
 * focused) and nothing inside handled it first — a filter picker, the
 * expression field putting its text back. Bubble phase, after those (as
 * the Number editor's). The chart editor's and Project pulse's (G5).
 */
export function useEscapeCloses(panel: RefObject<HTMLElement | null>, onClose: () => void): void {
  const onCloseRef = useLatestRef(onClose)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const el = panel.current
      const inside = el != null && e.target instanceof Node && el.contains(e.target)
      if (!inside && !isPageTarget(e.target)) return
      if (el && e.target instanceof Node && isInLayerAbove(el, e.target)) return
      e.preventDefault()
      e.stopPropagation()
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panel, onCloseRef])
}
