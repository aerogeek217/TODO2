// Every Zustand store records how to return to its initial state: the test
// setups replace `zustand` with `trackStores(actual)` (vi.mock), so each
// `create` registers its store here as it is made.
import type * as Zustand from 'zustand'

type StoreReset = () => void
// On globalThis: in the shared project the store modules (and so this list)
// outlive each file, while the setup file that mocks `zustand` re-runs per file.
type ResetRegistry = typeof globalThis & { __zustandStoreResets?: Set<StoreReset> }

function registry(): Set<StoreReset> {
  return ((globalThis as ResetRegistry).__zustandStoreResets ??= new Set())
}

/** `zustand` with a `create` that registers every store it makes. */
export function trackStores(actual: typeof Zustand): typeof Zustand {
  const track = <S extends Zustand.StoreApi<unknown>>(store: S): S => {
    registry().add(() => store.setState(store.getInitialState(), true))
    return store
  }
  const create = (<T>(initializer?: Zustand.StateCreator<T>) =>
    initializer
      ? track(actual.create<T>()(initializer))
      : (init: Zustand.StateCreator<T>) => track(actual.create<T>()(init))) as typeof actual.create
  return { ...actual, create }
}

/** Every store made so far, back to its initial state. */
export function resetStores(): void {
  for (const reset of registry()) reset()
}
