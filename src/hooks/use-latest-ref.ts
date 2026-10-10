import { useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Returns a ref whose `.current` always holds the latest committed `value`.
 *
 * Use it when a stable callback (empty-deps `useCallback`, a listener
 * registered once in an effect) needs to read the newest prop/state without
 * re-subscribing. The ref is updated in a layout effect rather than during
 * render (`react-hooks/refs` forbids render-time ref writes), so it is fresh
 * for event handlers, passive effects, and any layout effect declared *after*
 * this hook call in the same component. It is NOT yet fresh during render or
 * in ref callbacks of descendants mounted in the same commit — don't read it
 * there.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}
