import { describe, it, expect } from 'vitest'
import { useUIStore } from '../../stores/ui-store'
import { registerModuleReset } from '../../utils/module-reset'

// This file is in the shared project (no vi.mock), whose files share one
// module instance; the setup still resets the stores and the registered
// module state before each test.

let moduleStateTouched = false
registerModuleReset(() => { moduleStateTouched = false })

// Each test finds a fresh store and fresh module state, then leaves both
// changed: in either order, the second one passes only if the setup reset them.
describe.each(['first', 'second'])('a test of a shared file (%s)', () => {
  it('starts from the stores’ initial state and fresh module state', () => {
    expect(useUIStore.getState().selectedTodoIds.size).toBe(0)
    expect(moduleStateTouched).toBe(false)
    useUIStore.setState({ selectedTodoIds: new Set([1, 2]) })
    moduleStateTouched = true
  })
})
