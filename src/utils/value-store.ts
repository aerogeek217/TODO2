/**
 * One value that changes outside React's render (e.g. once per pointer move)
 * with subscribers — for `useSyncExternalStore`, so only the components that
 * read a part of it that changed re-render.
 */
export interface ValueStore<T> {
  get(): T
  /** Sets the value and tells the subscribers; the same value (`Object.is`) is no change. */
  set(value: T): void
  /** Calls `listener` after each change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void
}

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return
      value = next
      for (const listener of [...listeners]) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
