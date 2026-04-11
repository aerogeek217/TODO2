import { useEffect, useRef as useReactRef, type RefObject } from 'react'

/**
 * Calls `callback` when a mousedown occurs outside the referenced element.
 * Only active when `active` is true.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  callback: () => void,
  active: boolean,
) {
  const callbackRef = useReactRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!active) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        callbackRef.current()
      }
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [ref, active])
}
