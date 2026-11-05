import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import type * as Zustand from 'zustand'
import { resetStores } from './store-tracking'
import { resetModuleState, settleModuleWork } from '../utils/module-reset'

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

if (typeof window !== 'undefined' && typeof window.matchMedia === 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })
}

// Every Zustand store registers how to go back to its initial state.
vi.mock('zustand', async (importOriginal) =>
  (await import('./store-tracking')).trackStores(await importOriginal<typeof Zustand>()))

// Before every test, in both projects: every store at its initial state, and
// module state outside the stores (each module registers its own reset —
// writes in flight, loads in flight, the file storage service, the backup
// scheduler, the note store's save timer / queue, …) as a fresh import has
// it. A test sets up what it needs in its own beforeEach or body.
beforeEach(() => {
  resetStores()
  resetModuleState()
})

// The real clock, taken before any test fakes it.
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const realSetImmediate = globalThis.setImmediate
/** Longest wait for a test's work in flight (a write the test left stuck, e.g. under fake timers). */
const SETTLE_MAX_MS = 2_000

// After every test, in both projects: the store writes it left in flight
// land now, and what each does once its database write is done (an undo
// push, a rollback), plus one macrotask for the continuations after that —
// not in the next test, after its reset (cr31 tests 2.2). A write stuck past
// the bound is forgotten by the next test's reset (`resetWriteTracking`).
afterEach(async () => {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    settleModuleWork(),
    new Promise<void>((resolve) => { timer = realSetTimeout(resolve, SETTLE_MAX_MS) }),
  ])
  realClearTimeout(timer)
  await new Promise<void>((resolve) => { realSetImmediate(resolve) })
})
