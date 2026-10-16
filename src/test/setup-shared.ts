// Setup for the `shared` vitest project (isolate: false — see vitest.config.ts).
// Files in a worker share one module cache, jsdom document and fake IndexedDB,
// so this puts back, at every file boundary, what a fresh worker used to give
// each file for free.
import { afterAll, beforeAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type * as Zustand from 'zustand'
import { db } from '../data/database'
import { resetWriteTracking } from '../stores/store-helpers'
import { fileStorageService } from '../services/file-storage'
import { backupScheduler } from '../data/backup-scheduler'
import { resetFileHandleCache } from '../services/file-handle-idb'
import { resetFileStoragePrompts } from '../services/file-storage-store'
import { resetNoteSaves } from '../stores/note-store'
import { resetSettingsModuleState } from '../stores/settings-store'
import { resetListOrderLoad } from '../stores/list-order-store'

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
  // A write a previous file left unsettled would hold up every later load.
  resetWriteTracking()
  // Module state outside the stores, back to a fresh import's.
  fileStorageService.reset()
  backupScheduler.reset()
  resetFileStoragePrompts()
  resetFileHandleCache()
  resetNoteSaves()
  resetSettingsModuleState()
  resetListOrderLoad()
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
