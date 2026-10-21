// Setup for the `shared` vitest project (isolate: false — see vitest.config.ts).
// Files in a worker share one module cache, jsdom document and fake IndexedDB,
// so this puts back, at every file boundary, what a fresh worker used to give
// each file for free. (Stores and module state are reset before every test,
// in both projects, by setup.ts.)
import { afterAll, beforeAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { db } from '../data/database'

beforeAll(async () => {
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
  // Clipboard stubs a file defined straight on `navigator` / `globalThis`
  // (jsdom has neither): a later file would find a working clipboard.
  Reflect.deleteProperty(navigator, 'clipboard')
  Reflect.deleteProperty(globalThis, 'ClipboardItem')
  // Likewise `HTMLInputElement.prototype.showPicker = vi.fn()` (jsdom has no
  // date picker): a later file would find one that silently succeeds.
  if (vi.isMockFunction(HTMLInputElement.prototype.showPicker)) {
    Reflect.deleteProperty(HTMLInputElement.prototype, 'showPicker')
  }
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
