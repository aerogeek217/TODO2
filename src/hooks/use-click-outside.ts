import { useEffect, type RefObject } from 'react'
import { useLatestRef } from './use-latest-ref'

/**
 * Calls `callback` when a mousedown occurs outside the referenced element.
 * Only active when `active` is true. `alsoInside` counts more targets as
 * inside (e.g. a popup the element portals to the body).
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  callback: () => void,
  active: boolean,
  alsoInside?: (target: Element) => boolean,
) {
  const callbackRef = useLatestRef(callback)
  const alsoInsideRef = useLatestRef(alsoInside)

  useEffect(() => {
    if (!active) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (!ref.current || ref.current.contains(target)) return
      if (target instanceof Element && alsoInsideRef.current?.(target)) return
      callbackRef.current()
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [ref, active, callbackRef, alsoInsideRef])
}
