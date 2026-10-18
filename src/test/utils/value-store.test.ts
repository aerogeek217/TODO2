import { describe, expect, it, vi } from 'vitest'
import { createValueStore } from '../../utils/value-store'

describe('createValueStore', () => {
  it('holds a value and tells subscribers about each change, not about the same value', () => {
    const store = createValueStore<number | null>(null)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.set(4)
    expect(store.get()).toBe(4)
    store.set(4)
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
    store.set(5)
    expect(listener).toHaveBeenCalledOnce()
    expect(store.get()).toBe(5)
  })

  it('a listener that unsubscribes during a change leaves the others called', () => {
    const store = createValueStore(0)
    const second = vi.fn()
    const unsubscribeFirst = store.subscribe(() => unsubscribeFirst())
    store.subscribe(second)
    store.set(1)
    expect(second).toHaveBeenCalledOnce()
  })
})
