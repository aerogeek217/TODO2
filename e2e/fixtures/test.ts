import { test as base } from '@playwright/test'
import { hotModules, staleServerError } from './workspace'

/**
 * `test` for a spec that loads the app itself — one that never calls
 * `seedWorkspace` (which checks for a hot-updated dev server on its own)
 * but imports the app's modules in the page (`import('/src/stores/…')`,
 * here or through a fixture): its page is watched from the start, and the
 * test fails saying to restart the server when the page asked for a
 * hot-updated module — whatever else the test made of the second, empty
 * module copy it got (cr34 T8).
 */
export const test = base.extend<{ freshDevServer: void }>({
  freshDevServer: [async ({ page }, use) => {
    const hot = hotModules(page)
    await use()
    const stale = hot[0]
    if (stale !== undefined) throw staleServerError(stale)
  }, { auto: true }],
})

export { expect } from '@playwright/test'
