import { describe, it, expect } from 'vitest'
import { db } from '../../data/database'
import { trackWrite } from '../../stores/store-helpers'
import { useUIStore } from '../../stores/ui-store'

// What a test leaves in flight must land in that test, not in a later one
// after its reset (cr31 tests 2.2 / 2.3: shuffled runs failed on it). The
// pair passes in either order only because the setup settles each test's
// writes (`setup.ts`, `settleModuleWork`).

describe.each(['first', 'second'])('a store write left in flight (%s)', () => {
  it('lands with what follows its database write before the next test starts (the setup settles it)', async () => {
    // A real database op: the macrotasks a write left by the other test needs to land here.
    await db.todos.count()
    expect(useUIStore.getState().selectedTodoIds.size).toBe(0)
    // Shown or pushed only once the database write is done, like a setting's undo step.
    void (async () => {
      await trackWrite(() => db.todos.count())
      useUIStore.setState({ selectedTodoIds: new Set([7]) })
    })()
  })
})
