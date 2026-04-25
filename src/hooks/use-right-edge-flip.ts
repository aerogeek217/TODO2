import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

const RIGHT_EDGE_PADDING = 8

/**
 * Flip an absolutely-positioned popover panel from left-anchored to
 * right-anchored when the default position would push past the viewport's
 * right edge — e.g. when the trigger sits near the right side of a bounded
 * container like the lists editor modal. Measurement runs in
 * `useLayoutEffect` so the flip lands before paint (no flash).
 *
 * Apply the returned `align` to the panel via `data-align={align === 'end' ? 'end' : undefined}`;
 * the matching CSS rule (`[data-align="end"] { left: auto; right: 0 }`)
 * already exists alongside the panel's base styles.
 */
export function useRightEdgeFlip<T extends HTMLElement>(
  open: boolean,
): { panelRef: RefObject<T | null>; align: 'start' | 'end' } {
  const panelRef = useRef<T | null>(null)
  const [align, setAlign] = useState<'start' | 'end'>('start')

  useLayoutEffect(() => {
    if (!open) { setAlign('start'); return }
    const panel = panelRef.current
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    if (rect.right > window.innerWidth - RIGHT_EDGE_PADDING) setAlign('end')
  }, [open])

  return { panelRef, align }
}
