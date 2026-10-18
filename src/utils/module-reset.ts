/**
 * How each module with state outside a Zustand store (timers, queues,
 * caches, in-flight loads, singletons) gets back to a fresh import's state.
 * A module registers its reset when it loads; the test setup calls
 * `resetModuleState` wherever test files share one module instance, so a
 * new singleton is covered by registering here, not by being listed in the
 * setup. The app itself never resets.
 */
const resets = new Set<() => void>()

/** Registers `reset` (run by `resetModuleState`, in registration order). */
export function registerModuleReset(reset: () => void): void {
  resets.add(reset)
}

/** Runs every registered reset. Tests only. */
export function resetModuleState(): void {
  for (const reset of resets) reset()
}
