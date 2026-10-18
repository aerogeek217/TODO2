/**
 * Permanent diagnostic infrastructure for the task DnD
 * subsystem. `?debug-dnd=1` traces the full drop path on every
 * pointer-up — collision rule chosen → resolved `over.id`
 * → guard outcomes → final dispatch — so the next silent drop failure shows
 * its mechanics in the console without needing a fresh instrumentation pass.
 *
 * Pattern: read `window.location.search` once at module load, expose the
 * resolved boolean as a const, and gate per-call-site logs on it via the
 * `dndLog` helper so production console stays quiet when the flag is absent.
 * The bundle cost is a few dozen no-op string literals — accepted as the
 * price of permanent diagnose infrastructure for a recurring failure surface.
 */

/** Whether the URL query `search` (e.g. `?debug-dnd=1`) carries the flag `name`. */
export function hasFlag(search: string, name: string): boolean {
  try {
    return new URLSearchParams(search).has(name)
  } catch {
    return false
  }
}

export const DEBUG_DND: boolean = typeof window !== 'undefined' && hasFlag(window.location.search, 'debug-dnd')

type DndLog = (label: string, payload?: Record<string, unknown>) => void

/** The `dndLog` for a flag value: prints when `enabled`, otherwise a no-op. */
export function makeDndLog(enabled: boolean): DndLog {
  return (label, payload) => {
    if (!enabled) return
    console.warn('[debug-dnd]', label, payload ?? {})
  }
}

/**
 * Gated console.warn for DnD diagnostics. No-op when `?debug-dnd=1` isn't on
 * the URL. Caller passes a short label (e.g. `'dispatch.calendar-day'`) and an
 * optional payload object; we print under a `[debug-dnd]` prefix so the user
 * can `console.warn` filter by it in DevTools.
 */
export const dndLog: DndLog = makeDndLog(DEBUG_DND)
