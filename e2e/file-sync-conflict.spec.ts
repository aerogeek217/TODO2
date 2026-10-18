import { expect, test, type Page } from '@playwright/test'
import { gotoSettingsDeepLink, openSettings } from './fixtures/workspace'
import { readSyncFile as readFile } from './fixtures/sync-file'
import { readStore, readStores, writeStores } from './fixtures/db'

/**
 * Sync-file conflict flow in a real browser.
 *
 * `showOpenFilePicker` opens a native dialog Playwright can't drive, so an
 * init script replaces it with a picker that returns a REAL
 * `FileSystemFileHandle` from the Origin Private File System. OPFS handles
 * are structured-cloneable (the app persists the handle to IndexedDB),
 * support `getFile` / `createWritable`, and report permission `granted` —
 * so everything after the picker is the production code path.
 */

const SYNC_FILE = 'e2e-sync.json'

async function stubPicker(page: Page) {
  await page.addInitScript((name) => {
    const pick = async () => {
      const dir = await navigator.storage.getDirectory()
      return [await dir.getFileHandle(name, { create: true })]
    }
    Object.defineProperty(window, 'showOpenFilePicker', { value: pick, configurable: true })
  }, SYNC_FILE)
}

async function readSyncFile(page: Page): Promise<string> {
  return readFile(page, SYNC_FILE, { create: true })
}

async function writeSyncFile(page: Page, text: string) {
  await page.evaluate(async ({ name, text }) => {
    const dir = await navigator.storage.getDirectory()
    const fh = await dir.getFileHandle(name, { create: true })
    const w = await fh.createWritable()
    await w.write(text)
    await w.close()
  }, { name: SYNC_FILE, text })
}

/** Raw-IDB snapshot of every data store (what an export of this DB looks like). */
async function dumpDb(page: Page): Promise<Record<string, unknown[]>> {
  const data = await readStores(page)
  delete data.backups
  // As a file holds it: Dates as ISO strings.
  return JSON.parse(JSON.stringify(data)) as Record<string, unknown[]>
}

async function addTodo(page: Page, title: string) {
  const now = new Date()
  await writeStores(page, { add: { todos: [{ uid: crypto.randomUUID(), title, isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 0 }] } })
}

test('attaching a file that differs from a non-empty browser asks first; cancel and "Keep browser data" behave', async ({ page }) => {
  await stubPicker(page)
  await page.goto('/')
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })

  // Browser side: one task. File side: same DB, but the task renamed.
  await addTodo(page, 'Browser task')
  const dump = await dumpDb(page)
  const fileTodos = (dump.todos as Array<Record<string, unknown>>).map((t) => ({ ...t, title: 'File task' }))
  // Same schema as the browser (Vite dev serves the source module by URL).
  const schemaVersion = await page.evaluate(async (url) => {
    const mod = (await import(/* @vite-ignore */ url)) as { CURRENT_DB_VERSION: number }
    return mod.CURRENT_DB_VERSION
  }, '/src/data/database.ts')
  const fileText = JSON.stringify({ ...dump, todos: fileTodos, __schemaVersion: schemaVersion, savedAt: '2026-01-01T00:00:00.000Z' })
  await writeSyncFile(page, fileText)

  await gotoSettingsDeepLink(page)
  await (await openSettings(page, 'File storage')).getByRole('button', { name: 'Attach to File' }).click()

  // Conflict dialog before anything changed.
  const dialog = page.getByRole('dialog', { name: 'Browser data and sync file differ' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('no record of syncing')
  await expect(dialog.getByTestId('sync-conflict-sides')).toContainText('1 task')
  // Focus lands inside the dialog (Dialog primitive), not behind it.
  await expect(dialog.locator(':focus')).toHaveCount(1)
  expect(await readSyncFile(page)).toBe(fileText)

  // Cancel → paused, both sides untouched; the storage pill says so (no strip).
  await dialog.getByRole('button', { name: 'Cancel (pause sync)' }).click()
  const pill = page.getByTestId('storage-pill')
  await expect(pill).toHaveAttribute('data-state', 'paused')
  expect(await readSyncFile(page)).toBe(fileText)
  // The pill sits under the Settings modal: close it first.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden()
  await expect(page.getByRole('alert')).toHaveCount(0)
  const titles = ((await dumpDb(page)).todos as Array<{ title: string }>).map((t) => t.title)
  expect(titles).toEqual(['Browser task'])

  // Retry (from the pill's popover) → asked again → keep the browser's data,
  // by keyboard: the cards are a radio group with nothing picked; the one
  // confirm is named after the pick.
  await pill.click()
  const popover = page.getByRole('dialog', { name: 'Sync paused' })
  await expect(popover).toContainText('have different data. Choose which version to keep.')
  await expect(popover).toContainText('Retry shows the choice again')
  await popover.getByRole('button', { name: 'Retry' }).click()
  await expect(popover).toBeHidden()
  await expect(dialog).toBeVisible()
  const browserCard = dialog.getByRole('radio', { name: /This browser/ })
  const fileCard = dialog.getByRole('radio', { name: /\.json/ })
  await expect(browserCard).toBeFocused()
  await expect(browserCard).not.toBeChecked()
  await expect(fileCard).not.toBeChecked()
  await expect(dialog.getByRole('button', { name: 'Pick a version' })).toBeDisabled()
  await page.keyboard.press('ArrowRight')
  await expect(fileCard).toBeChecked()
  await expect(dialog.getByRole('button', { name: /^Keep .+\.json$/ })).toBeEnabled()
  await page.keyboard.press('ArrowLeft')
  await expect(browserCard).toBeChecked()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Cancel (pause sync)' })).toBeFocused()
  await page.keyboard.press('Tab')
  const keep = dialog.getByRole('button', { name: 'Keep browser data' })
  await expect(keep).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(pill).toHaveAttribute('data-state', 'syncing')

  await expect.poll(async () => {
    const written = JSON.parse(await readSyncFile(page)) as { todos: Array<{ title: string }> }
    return written.todos.map((t) => t.title)
  }).toEqual(['Browser task'])

  // A file backup snapshot was taken before the overwrite.
  const backups = await readStore<{ data: string }>(page, 'backups')
  expect(backups.filter((b) => b.data.includes('File task')).length).toBeGreaterThan(0)

  // Now in sync: a reload loads silently.
  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('storage-pill')).toHaveAttribute('data-state', 'syncing')
  // Connected again: Settings shows the attached file.
  await expect((await openSettings(page, 'File storage')).getByRole('button', { name: 'Attach to Different File' })).toBeVisible()
})

test('an unreadable sync file pauses sync and is never overwritten by edits', async ({ page }) => {
  await stubPicker(page)
  await page.goto('/')
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  await writeSyncFile(page, '{ not json')

  await gotoSettingsDeepLink(page)
  await (await openSettings(page, 'File storage')).getByRole('button', { name: 'Attach to File' }).click()

  const pill = page.getByTestId('storage-pill')
  await expect(pill).toHaveAttribute('data-state', 'paused')
  // A real app edit (QuickAdd → Dexie hooks), not a raw IDB write.
  await page.goto('/')
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  await expect(pill).toHaveAttribute('data-state', 'paused')
  await page.keyboard.press('Control+Space')
  const quickAdd = page.getByRole('dialog', { name: 'Quick add task' })
  await quickAdd.getByPlaceholder('New task…').fill('Edit while paused')
  await page.keyboard.press('Enter')
  await expect.poll(async () => ((await dumpDb(page)).todos as Array<{ title: string }>).map((t) => t.title))
    .toContain('Edit while paused')
  // The read waits for any save running or scheduled (`whenIdle`), so a
  // save the paused edit wrongly scheduled would land before it.
  expect(await readSyncFile(page)).toBe('{ not json')
  // …and the edit is recorded as unsynced for the next conflict check.
  const state = await page.evaluate(() => localStorage.getItem('todo2-file-sync-state'))
  expect(JSON.parse(state ?? '{}').dirtySince).toBeTruthy()

  // A cold load still says so: in the storage pill and its popover, no strip.
  await page.goto('about:blank')
  await page.goto('/')
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  await expect(pill).toHaveAttribute('data-state', 'paused')
  await expect(pill).toHaveText('Sync paused')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await pill.click()
  const popover = page.getByRole('dialog', { name: 'Sync paused' })
  await expect(popover).toContainText('The file contains invalid JSON')
  await expect(popover).toContainText('Nothing has been written to either side.')
  await expect(popover.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(popover.getByRole('button', { name: 'Keep browser data…' })).toBeVisible()
})
