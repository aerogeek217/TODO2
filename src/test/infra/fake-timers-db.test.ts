import { describe, it, expect, vi } from 'vitest'
import { db } from '../../data/database'

// fake-indexeddb runs every database step on setImmediate, which the
// config's default fake timers leave real (vitest.config.ts `fakeTimers`):
// faked, a first open under fake timers was dropped by useRealTimers and
// every later database op of the file hung (cr31 tests 2.4). The pair
// passes in either order only with that.

/** `promise`, or a rejection after `ms` of real time (a hang fails fast instead of at the test timeout). */
function within<T>(promise: Promise<T>, ms = 5_000): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => { setTimeout(() => reject(new Error(`still pending after ${ms} ms`)), ms) })])
}

describe.each(['first', 'second'])('the database under fake timers (%s)', () => {
  it('opens when its first open starts under vi.useFakeTimers(), and stays usable after useRealTimers', async () => {
    db.close({ disableAutoOpen: false })
    vi.useFakeTimers()
    const count = db.todos.count()
    for (let i = 0; i < 50; i++) await Promise.resolve()
    vi.useRealTimers()
    await expect(within(count)).resolves.toBe(0)
    await expect(within(db.todos.count())).resolves.toBe(0)
  })
})
