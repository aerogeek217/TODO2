import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { nextSkyEventGapMs, planSkyEvent, SKY_EVENT_KINDS, type SkyEventKind, type SkyEventSpec } from '../utils/sky-events'
import { useLatestRef } from './use-latest-ref'

/** The sky events showing now, one at most of each kind. */
export type SkyEvents = Partial<Record<SkyEventKind, SkyEventSpec>>

/** How long past its own length an event stays mounted (its animation ends first). */
const LINGER_MS = 250

/**
 * Development only: `document.dispatchEvent(new CustomEvent(SKY_EVENT_DEBUG, { detail: 'ufo' }))`
 * — or `window.ambienceSkyEvent('ufo')` — shows that event now, whatever the clock says.
 */
export const SKY_EVENT_DEBUG = 'ambience:sky-event'

type SetEvents = Dispatch<SetStateAction<SkyEvents>>

function without(events: SkyEvents, kind: SkyEventKind, id?: number): SkyEvents {
  const current = events[kind]
  if (!current || (id !== undefined && current.id !== id)) return events
  const next = { ...events }
  delete next[kind]
  return next
}

/**
 * One kind's loop while `on`: wait a gap, show one (unless the page is
 * hidden), take it down when it has run, wait again. Off: the wait stops and
 * the one showing goes.
 */
function useSkyEventLoop(kind: SkyEventKind, on: boolean, random: RefObject<() => number>, nextId: RefObject<number>, setEvents: SetEvents): void {
  useEffect(() => {
    if (!on) return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => { timer = setTimeout(fire, nextSkyEventGapMs(kind, random.current)) }
    const fire = () => {
      if (document.hidden) { schedule(); return }
      const spec = planSkyEvent(kind, random.current, nextId.current++)
      setEvents((events) => ({ ...events, [kind]: spec }))
      timer = setTimeout(() => {
        setEvents((events) => without(events, kind, spec.id))
        schedule()
      }, spec.durMs + LINGER_MS)
    }
    schedule()
    return () => {
      clearTimeout(timer)
      setEvents((events) => without(events, kind))
    }
  }, [kind, on, random, nextId, setEvents])
}

/**
 * The top bar's rare sky events (`AmbienceSky`): each kind on its own timer
 * while `allowed` says it may show (`utils/sky-events.allowedSkyEvents`), its
 * gaps and paths from `random` (injectable for tests). Timers only — the
 * motion is CSS.
 */
export function useSkyEvents(allowed: Readonly<Record<SkyEventKind, boolean>>, random: () => number = Math.random): SkyEvents {
  const [events, setEvents] = useState<SkyEvents>({})
  const randomRef = useLatestRef(random)
  const nextId = useRef(1)
  useSkyEventLoop('shootingStar', allowed.shootingStar, randomRef, nextId, setEvents)
  useSkyEventLoop('ufo', allowed.ufo, randomRef, nextId, setEvents)
  useSkyEventLoop('airplane', allowed.airplane, randomRef, nextId, setEvents)
  useSkyEventDebug(randomRef, nextId, setEvents)
  return events
}

/** Development only: a way to call up an event now (`SKY_EVENT_DEBUG`). */
function useSkyEventDebug(random: RefObject<() => number>, nextId: RefObject<number>, setEvents: SetEvents): void {
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const onDebug = (e: Event) => {
      const kind = (e as CustomEvent<unknown>).detail
      if (!SKY_EVENT_KINDS.includes(kind as SkyEventKind)) return
      const spec = planSkyEvent(kind as SkyEventKind, random.current, nextId.current++)
      setEvents((events) => ({ ...events, [spec.kind]: spec }))
      const timer = setTimeout(() => {
        timers.delete(timer)
        setEvents((events) => without(events, spec.kind, spec.id))
      }, spec.durMs + LINGER_MS)
      timers.add(timer)
    }
    const helpers = window as unknown as Record<string, unknown>
    helpers.ambienceSkyEvent = (kind: SkyEventKind) => document.dispatchEvent(new CustomEvent(SKY_EVENT_DEBUG, { detail: kind }))
    document.addEventListener(SKY_EVENT_DEBUG, onDebug)
    return () => {
      document.removeEventListener(SKY_EVENT_DEBUG, onDebug)
      delete helpers.ambienceSkyEvent
      for (const timer of timers) clearTimeout(timer)
    }
  }, [random, nextId, setEvents])
}
