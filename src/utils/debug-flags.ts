/**
 * Permanent diagnostic infrastructure for the rail / float / taskboard /
 * calendar DnD subsystem. `?debug-dnd=1` traces the full drop path on every
 * pointer-up — source slot/tab → collision rule chosen → resolved `over.id`
 * → guard outcomes → final dispatch — so the next silent failure (the kind
 * triage P5 had to forensically diagnose) shows its mechanics in the console
 * without needing a fresh instrumentation pass.
 *
 * Pattern: read `window.location.search` once at module load, expose the
 * resolved boolean as a const, and gate per-call-site logs on it via the
 * `dndLog` helper so production console stays quiet when the flag is absent.
 * The bundle cost is a few dozen no-op string literals — accepted as the
 * price of permanent diagnose infrastructure for a recurring failure surface.
 */

function readFlag(name: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return new URLSearchParams(window.location.search).has(name)
  } catch {
    return false
  }
}

export const DEBUG_DND: boolean = readFlag('debug-dnd')

/**
 * Gated console.warn for DnD diagnostics. No-op when `?debug-dnd=1` isn't on
 * the URL. Caller passes a short label (e.g. `'dispatch.calendar-day'`) and an
 * optional payload object; we print under a `[debug-dnd]` prefix so the user
 * can `console.warn` filter by it in DevTools.
 */
export function dndLog(label: string, payload?: Record<string, unknown>): void {
  if (!DEBUG_DND) return
  // eslint-disable-next-line no-console
  console.warn('[debug-dnd]', label, payload ?? {})
}
