import { useEffect, useState } from 'react'
import { startOfToday } from '../utils/date'

/**
 * Midnight of the current local day, as state that rolls over at the next
 * midnight — so date-sensitive memos (`today` predicates, buckets) recompute
 * on day change without a reload. Re-arms its timer after each rollover, and
 * re-checks when the page becomes visible again (timers can be throttled or
 * suspended in a hidden tab or a sleeping machine).
 */
export function useToday(): Date {
  const [today, setToday] = useState(startOfToday)
  useEffect(() => {
    const refresh = () => {
      const now = startOfToday()
      setToday((prev) => (prev.getTime() === now.getTime() ? prev : now))
    }
    const now = new Date()
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
    // Always a new value, so the effect re-arms even if the timer fired early.
    const timer = setTimeout(() => setToday(startOfToday()), Math.max(1000, nextMidnight - now.getTime() + 50))
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [today])
  return today
}
