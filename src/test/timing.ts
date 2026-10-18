import { expect } from 'vitest'

/**
 * Fails unless `run` finishes within `ms` in one of up to `tries` runs. For
 * the "stays fast on huge input" checks (a regex gone super-linear takes
 * seconds to minutes, the fixed code milliseconds): a loaded machine — the
 * full suite beside another process — can slow one run past the bound, a
 * regression slows every run. `run` holds the test's own assertions too.
 */
export function expectWithin(ms: number, run: () => void, tries = 3): void {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < tries && best >= ms; i++) {
    const start = performance.now()
    run()
    best = Math.min(best, performance.now() - start)
  }
  expect(best, `the fastest of ${tries} runs took ${Math.round(best)} ms`).toBeLessThan(ms)
}
