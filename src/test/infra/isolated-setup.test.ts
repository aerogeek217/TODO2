import { describe, it, expect, vi } from 'vitest'
import { useUIStore } from '../../stores/ui-store'
import { registerModuleReset } from '../../utils/module-reset'

// A vi.mock puts this file in the isolated project (vitest.config.ts); the
// setup resets the stores and the registered module state before each test,
// there as in the shared project.
vi.mock('../../utils/platform', async (importOriginal) => importOriginal())

let moduleStateTouched = false
registerModuleReset(() => { moduleStateTouched = false })

// Each test finds a fresh store and fresh module state, then leaves both
// changed: in either order, the second one passes only if the setup reset them.
describe.each(['first', 'second'])('a test of an isolated file (%s)', () => {
  it('starts from the stores’ initial state and fresh module state', () => {
    expect(useUIStore.getState().selectedTodoIds.size).toBe(0)
    expect(moduleStateTouched).toBe(false)
    useUIStore.setState({ selectedTodoIds: new Set([1, 2]) })
    moduleStateTouched = true
  })
})
