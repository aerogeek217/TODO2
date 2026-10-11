// Setup for the `shared` vitest project (isolate: false — see vitest.config.ts).
// Files in a worker share one module cache, jsdom document and fake IndexedDB,
// so this puts back, at every file boundary, what a fresh worker used to give
// each file for free.
import { afterAll, beforeAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type * as Zustand from 'zustand'
import { db } from '../data/database'

type StoreReset = () => void
type ResetRegistry = typeof globalThis & { __zustandStoreResets?: Set<StoreReset> }

// Every zustand store records how to return to its initial state. The registry
// lives on globalThis because store modules are cached across files while this
// setup file re-runs for each one.
vi.mock('zustand', async (importOriginal) => {
  const actual = await importOriginal<typeof Zustand>()
  const resets = ((globalThis as ResetRegistry).__zustandStoreResets ??= new Set())
  const track = <S extends Zustand.StoreApi<unknown>>(store: S): S => {
    resets.add(() => store.setState(store.getInitialState(), true))
    return store
  }
  const create = (<T>(initializer?: Zustand.StateCreator<T>) =>
    initializer
      ? track(actual.create<T>()(initializer))
      : (init: Zustand.StateCreator<T>) => track(actual.create<T>()(init))) as typeof actual.create
  return { ...actual, create }
})

beforeAll(async () => {
  for (const reset of (globalThis as ResetRegistry).__zustandStoreResets ?? []) reset()
  // Closed but auto-opening, like an untouched db in a fresh worker.
  await db.delete({ disableAutoOpen: false })
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterAll(() => {
  // No `globals: true`, so Testing Library's own afterEach(cleanup) never registers.
  cleanup()
  document.body.innerHTML = ''
  const html = document.documentElement
  for (const name of html.getAttributeNames()) html.removeAttribute(name)
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
