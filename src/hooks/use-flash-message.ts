import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A message shown for a while (a Settings section's result line, a toast):
 * `show(value, ms)` sets it and puts `empty` back after `ms` (a newer message
 * restarts the clock). The timer is cleared on unmount.
 */
export function useFlashMessage<T>(empty: T): [T, (value: T, ms: number) => void] {
  const [message, setMessage] = useState<T>(empty)
  const timer = useRef<number | null>(null)
  const emptyRef = useRef(empty)
  useEffect(() => () => { if (timer.current != null) clearTimeout(timer.current) }, [])
  const show = useCallback((value: T, ms: number) => {
    setMessage(value)
    if (timer.current != null) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMessage(emptyRef.current), ms)
  }, [])
  return [message, show]
}
