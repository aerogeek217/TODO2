import { useEffect, useSyncExternalStore } from 'react'
import { registerModuleReset } from '../utils/module-reset'
import { startOfToday } from '../utils/date'

/**
 * Midnight of the current local day, shared by every caller: one value that
 * rolls over at the next midnight, so date-sensitive memos (`today`
 * predicates, buckets) recompute — and memoised rows re-render — on day
 * change without a reload. One timer serves all the subscribers (a list's
 * hundreds of rows among them) and one `visibilitychange` re-check (timers
 * can be throttled or suspended in a hidden tab or a sleeping machine).
 * With nobody subscribed nothing is kept, so the next reader reads the day
 * afresh.
 */
let current: Date | null = null
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null

/** The day as the subscribers have it: the same `Date` until it rolls over. */
function snapshot(): Date {
  current ??= startOfToday()
  return current
}

/**
 * Re-reads the day: a new one is every subscriber's (each re-renders, and
 * its effect re-arms the midnight timer — after the render, so a test's
 * `runAllTimers` ends, as when each hook armed its own); the same day only
 * re-arms the timer if it has none (it fired early).
 */
function refresh(): void {
  const now = startOfToday()
  if (current && current.getTime() === now.getTime()) {
    ensureArmed()
    return
  }
  current = now
  if (timer != null) clearTimeout(timer)
  timer = null
  for (const listener of [...listeners]) listener()
}

function onTimer(): void {
  timer = null
  refresh()
}

/** Arms the next midnight's timer while there are subscribers and none is armed. */
function ensureArmed(): void {
  if (timer != null || listeners.size === 0) return
  const now = new Date()
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  timer = setTimeout(onTimer, Math.max(1000, nextMidnight - now.getTime() + 50))
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    // A day read by a render nobody subscribed after (a discarded one) may be stale: React re-reads the snapshot after this.
    if (current && current.getTime() !== startOfToday().getTime()) current = null
    document.addEventListener('visibilitychange', refresh)
    ensureArmed()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    document.removeEventListener('visibilitychange', refresh)
    if (timer != null) clearTimeout(timer)
    timer = null
    current = null
  }
}

registerModuleReset(() => {
  if (timer != null) clearTimeout(timer)
  timer = null
  document.removeEventListener('visibilitychange', refresh)
  listeners.clear()
  current = null
})

export function useToday(): Date {
  const today = useSyncExternalStore(subscribe, snapshot)
  // After a rollover: the next midnight's timer (the first subscriber's effect arms it; the rest find it armed).
  useEffect(ensureArmed, [today])
  return today
}
