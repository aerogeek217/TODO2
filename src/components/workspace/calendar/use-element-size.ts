import { useCallback, useLayoutEffect, useState } from 'react'

export interface ElementSize {
  width: number
  height: number
}

const ZERO: ElementSize = { width: 0, height: 0 }

/**
 * The size (client box) of the element given to the returned callback ref,
 * kept current by a ResizeObserver; 0 × 0 until measured (and where
 * ResizeObserver is missing). Follows the ref to a new element.
 */
export function useElementSize(): [(el: HTMLElement | null) => void, ElementSize] {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [size, setSize] = useState<ElementSize>(ZERO)
  const ref = useCallback((node: HTMLElement | null) => setEl(node), [])
  useLayoutEffect(() => {
    if (!el) return
    const measure = () => {
      const width = el.clientWidth
      const height = el.clientHeight
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [ref, size]
}
