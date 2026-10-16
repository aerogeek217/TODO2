import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { beforeEach, vi } from 'vitest'
import type * as Zustand from 'zustand'
import { resetStores } from './store-tracking'
import { resetModuleState } from '../utils/module-reset'

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
