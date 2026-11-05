import { useEffect, type RefObject } from 'react'

/**
 * Stops a touch drag on `ref`'s element (a sheet's scrim) from scrolling the
 * page behind it. React's `onTouchMove` is passive, so its `preventDefault`
 * does nothing; this listener is not.
 */
export function useBlockTouchScroll(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const block = (e: TouchEvent) => { if (e.cancelable) e.preventDefault() }
    el.addEventListener('touchmove', block, { passive: false })
    return () => el.removeEventListener('touchmove', block)
  }, [ref])
}
