import { useEffect, useState } from 'react'
import { startOfToday } from '../utils/date'

/**
 * Midnight of the current local day, as state that rolls over at the next
 * midnight — so date-sensitive memos (`today` predicates, buckets) recompute
 * on day change without a reload. Re-arms its timer after each rollover.
 */
export function useToday(): Date {
  const [today, setToday] = useState(startOfToday)
  useEffect(() => {
    const now = new Date()
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
    const timer = setTimeout(() => {
      setToday(startOfToday())
    }, Math.max(1000, nextMidnight - now.getTime() + 50))
    return () => clearTimeout(timer)
  }, [today])
  return today
}
