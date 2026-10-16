import { expect, test, type Page } from '@playwright/test'
import { selectTaskRowByTitle, taskRowByTitle } from './fixtures/seed'
import { gotoSettingsDeepLink, openSettings, seedTaskList } from './fixtures/workspace'

/**
 * Backups before destructive operations: a backup snapshot that can't be
 * stored stops the operation and asks "Continue without a backup?" (Cancel
 * is the default); restoring a backup first backs up the current data; and
 * Export & delete asks "Did the file save?" before deleting after a plain
 * download.
 *
 * Storage-full is simulated in the page: while `window.__e2eFailBackups` is
 * set, every write to the `backups` object store aborts its transaction —
 * what a quota error does — so the app's own snapshot code fails for real.
 */

const DB_NAME = 'todo2'
const IMPORT_FILE = 'e2e-backup-import.json'

test.use({ viewport: { width: 1280, height: 800 } })

async function installBackupFailureSwitch(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __e2eFailBackups?: boolean }
    const add = IDBObjectStore.prototype.add
    IDBObjectStore.prototype.add = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
      const req = add.apply(this, args)
      if (this.name === 'backups' && w.__e2eFailBackups) this.transaction.abort()
      return req
    }
  })
}

async function failBackups(page: Page, on: boolean) {
  await page.evaluate((v) => { (window as unknown as { __e2eFailBackups?: boolean }).__e2eFailBackups = v }, on)
}

/** File pickers backed by a real OPFS file (as in `safe-purge.spec.ts`). */
async function stubPickers(page: Page) {
  await page.addInitScript((name) => {
    const handle = async () => (await navigator.storage.getDirectory()).getFileHandle(name, { create: true })
    Object.defineProperty(window, 'showSaveFilePicker', { value: handle, configurable: true })
    Object.defineProperty(window, 'showOpenFilePicker', { value: async () => [await handle()], configurable: true })
  }, IMPORT_FILE)
}

async function dbTitles(page: Page): Promise<string[]> {
  return page.evaluate(async (db) => new Promise<string[]>((resolve, reject) => {
    const req = indexedDB.open(db)
    req.onsuccess = () => {
      const r = req.result.transaction(['todos'], 'readonly').objectStore('todos').getAll()
      r.onsuccess = () => { req.result.close(); resolve((r.result as Array<{ title: string }>).map((t) => t.title).sort()) }
      r.onerror = () => reject(r.error)
    }
    req.onerror = () => reject(req.error)
  }), DB_NAME)
}

async function dbBackups(page: Page): Promise<Array<{ trigger: string; data: string }>> {
  return page.evaluate(async (db) => new Promise<Array<{ trigger: string; data: string }>>((resolve, reject) => {
    const req = indexedDB.open(db)
    req.onsuccess = () => {
      const r = req.result.transaction(['backups'], 'readonly').objectStore('backups').getAll()
      r.onsuccess = () => { req.result.close(); resolve(r.result as Array<{ trigger: string; data: string }>) }
      r.onerror = () => reject(r.error)
    }
    req.onerror = () => reject(req.error)
  }), DB_NAME)
}

/**
 * Waits for the automatic backup every fresh browser gets at startup, so
 * switching backup failures on afterwards can't catch it mid-write (and a
 * reload doesn't take another: the last one is recent).
 */
async function startupBackupTaken(page: Page) {
  await expect.poll(async () => (await dbBackups(page)).filter((b) => b.trigger === 'auto').length).toBe(1)
}

function backupPrompt(page: Page) {
  return page.getByRole('dialog', { name: 'Continue without a backup?' })
}

test('import: a failed backup asks first — Cancel changes nothing, Continue imports and says no backup was taken', async ({ page }) => {
  await installBackupFailureSwitch(page)
  await stubPickers(page)
  await seedTaskList(page, { tasks: [{ title: 'Exported task' }] })

  // Export the current data to the file, then move on from it.
  const settings = await openSettings(page, 'Import / Export')
  await settings.getByRole('button', { name: 'Export JSON' }).click()
  await expect(settings.getByText('Exported!')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await page.getByRole('button', { name: 'New task' }).click()
  await page.keyboard.type('Newer task')
  await page.keyboard.press('Enter')
  await expect(taskRowByTitle(page, 'Newer task')).toBeVisible()
  await page.keyboard.press('Escape')

  await startupBackupTaken(page)
  await failBackups(page, true)
  await openSettings(page, 'Import / Export')
  await settings.getByRole('button', { name: 'Import JSON' }).click()
  const prompt = backupPrompt(page)
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText('before importing the file')
  await expect(prompt.getByRole('button', { name: 'Cancel' })).toBeFocused()

  // Esc = Cancel, and it closes only the prompt, not Settings.
  await page.keyboard.press('Escape')
  await expect(prompt).toBeHidden()
  await expect(settings).toBeVisible()
  await expect(settings.getByText('Import cancelled — nothing changed.')).toBeVisible()
  expect(await dbTitles(page)).toEqual(['Exported task', 'Newer task'])

  await settings.getByRole('button', { name: 'Import JSON' }).click()
  await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: 'Continue' }).click()
  await expect(settings.getByText('Imported successfully. No backup was taken.')).toBeVisible()
  expect(await dbTitles(page)).toEqual(['Exported task'])
  expect((await dbBackups(page)).filter((b) => b.trigger !== 'auto')).toEqual([])

  // The warning strip keeps saying so until dismissed.
  await page.keyboard.press('Escape')
  const strip = page.getByRole('alert').filter({ hasText: 'No backup was taken before importing the file' })
  await expect(strip).toBeVisible()
  await strip.getByRole('button', { name: 'Dismiss' }).click()
  await expect(strip).toBeHidden()
})

test('bulk delete: a failed backup asks first — Cancel keeps the tasks, Continue deletes and the snackbar says no backup was taken', async ({ page }) => {
  await installBackupFailureSwitch(page)
  const titles = ['t1', 't2', 't3', 't4', 't5', 't6']
  await seedTaskList(page, { tasks: titles.map((title) => ({ title })) })
  await startupBackupTaken(page)
  await failBackups(page, true)

  // Deletes the selected tasks. (Never click a selected row's title before
  // pressing Delete: that starts renaming it 250 ms later, and a slower run
  // then types the Delete key into the title.)
  const deleteSelected = async () => {
    await expect(page.locator('[data-selected="true"]')).toHaveCount(6)
    await page.keyboard.press('Delete')
    const confirm = page.getByRole('dialog', { name: 'Delete tasks' })
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
  }

  await selectTaskRowByTitle(page, 't1')
  await taskRowByTitle(page, 't6').locator('span[title="t6"]').click({ modifiers: ['Shift'] })
  await deleteSelected()
  const prompt = backupPrompt(page)
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText('before deleting 6 tasks')
  await prompt.getByRole('button', { name: 'Cancel' }).click()
  await expect(prompt).toBeHidden()
  await expect(taskRowByTitle(page, 't6')).toBeVisible()
  // Cancel keeps the selection too.
  await expect(page.locator('[data-selected="true"]')).toHaveCount(6)
  expect(await dbTitles(page)).toEqual(titles)

  await deleteSelected()
  await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Delete 6 tasks — no backup was taken')).toBeVisible()
  await expect(taskRowByTitle(page, 't1')).toHaveCount(0)
  await expect(page.locator('[data-selected="true"]')).toHaveCount(0)
  expect(await dbTitles(page)).toEqual([])
  // Undo brings them back.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(taskRowByTitle(page, 't6')).toBeVisible()
  expect(await dbTitles(page)).toEqual(titles)
})

test('restoring a backup backs up the current data first', async ({ page }) => {
  await seedTaskList(page, { tasks: [{ title: 'In the backup' }] })
  const settings = await gotoSettingsDeepLink(page)
  await openSettings(page, 'Backups')
  await settings.getByRole('button', { name: 'Create Backup Now' }).click()
  await expect(settings.getByText('Backup created!')).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'New task' }).click()
  await page.keyboard.type('Added after')
  await page.keyboard.press('Enter')
  await expect(taskRowByTitle(page, 'Added after')).toBeVisible()
  await page.keyboard.press('Escape')

  await openSettings(page, 'Backups')
  const manual = settings.locator('[data-trigger="manual"]')
  await manual.getByRole('button', { name: 'Restore' }).click()
  await manual.getByRole('button', { name: 'Confirm' }).click()
  await expect(settings.getByText('Restored successfully! The data it replaced was backed up first.')).toBeVisible()
  expect(await dbTitles(page)).toEqual(['In the backup'])

  const preOp = (await dbBackups(page)).filter((b) => b.trigger === 'pre-destructive')
  expect(preOp).toHaveLength(1)
  expect(preOp[0]?.data).toContain('Added after')
  await expect(settings.getByText('pre-op')).toBeVisible()
})

test('Export & delete after a plain download asks "Did the file save?" before deleting', async ({ page }) => {
  // The picker write fails, so the archive goes out as a plain download.
  await page.addInitScript(() => {
    const fail = async () => { throw new DOMException('write failed', 'NotAllowedError') }
    Object.defineProperty(window, 'showSaveFilePicker', { value: fail, configurable: true })
  })
  await page.goto('/')
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  await page.evaluate(async (db) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => {
        const idb = req.result
        const tx = idb.transaction(['todos', 'settings'], 'readwrite')
        const now = Date.now()
        const row = (title: string, done: boolean, i: number) => ({
          uid: crypto.randomUUID(), title, isCompleted: done, sortOrder: i,
          createdAt: new Date(now - 100 * 86_400_000), modifiedAt: new Date(now),
          ...(done ? { completedAt: new Date(now - 60 * 86_400_000) } : {}),
        })
        tx.objectStore('todos').add(row('Old done', true, 1))
        tx.objectStore('todos').add(row('Keep', false, 2))
        tx.objectStore('settings').put({ key: 'completedRetentionDays', value: '30' })
        tx.oncomplete = () => { idb.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
  }, DB_NAME)
  await page.reload()

  const purge = page.getByRole('dialog', { name: 'Delete 1 old completed task?' })
  await expect(purge).toBeVisible()

  const firstDownload = page.waitForEvent('download')
  await purge.getByRole('button', { name: 'Export & delete' }).click()
  expect((await firstDownload).suggestedFilename()).toMatch(/^todo2-archive-.*\.json$/)
  const saved = page.getByRole('dialog', { name: 'Did the file save?' })
  await expect(saved).toBeVisible()
  await expect(saved.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Enter') // Enter picks the default: Cancel
  await expect(saved).toBeHidden()
  await expect(purge.getByRole('alert')).toContainText('Nothing was deleted')
  expect(await dbTitles(page)).toEqual(['Keep', 'Old done'])

  const secondDownload = page.waitForEvent('download')
  await purge.getByRole('button', { name: 'Export & delete' }).click()
  await secondDownload
  await saved.getByRole('button', { name: 'Delete 1 task' }).click()
  await expect(purge).toBeHidden()
  expect(await dbTitles(page)).toEqual(['Keep'])
})

test('launch purge: a failed backup asks first — Cancel keeps the tasks, Continue deletes and the strip says so', async ({ page }) => {
  await installBackupFailureSwitch(page)
  await page.goto('/')
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  await page.evaluate(async (db) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => {
        const idb = req.result
        const tx = idb.transaction(['todos', 'settings'], 'readwrite')
        const now = Date.now()
        tx.objectStore('todos').add({
          uid: crypto.randomUUID(), title: 'Old done', isCompleted: true, sortOrder: 1,
          createdAt: new Date(now - 100 * 86_400_000), modifiedAt: new Date(now), completedAt: new Date(now - 60 * 86_400_000),
        })
        tx.objectStore('settings').put({ key: 'completedRetentionDays', value: '30' })
        tx.oncomplete = () => { idb.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
  }, DB_NAME)
  await startupBackupTaken(page)
  await page.reload()
  await failBackups(page, true)

  const purge = page.getByRole('dialog', { name: 'Delete 1 old completed task?' })
  await expect(purge).toBeVisible()
  await purge.getByRole('button', { name: 'Delete', exact: true }).click()
  const prompt = backupPrompt(page)
  await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: 'Cancel' }).click()
  await expect(purge.getByRole('alert')).toContainText('Nothing was deleted — the backup could not be saved.')
  expect(await dbTitles(page)).toEqual(['Old done'])

  await purge.getByRole('button', { name: 'Delete', exact: true }).click()
  await prompt.getByRole('button', { name: 'Continue' }).click()
  await expect(purge).toBeHidden()
  expect(await dbTitles(page)).toEqual([])
  await expect(page.getByRole('alert').filter({ hasText: 'No backup was taken before deleting 1 completed task' })).toBeVisible()
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('launch purge: Continue without a backup says so in the snackbar (no warning strip on a phone)', async ({ page }) => {
    await installBackupFailureSwitch(page)
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Quick add' })).toBeVisible()
    await page.evaluate(async (db) => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(db)
        req.onsuccess = () => {
          const idb = req.result
          const tx = idb.transaction(['todos', 'settings'], 'readwrite')
          const now = Date.now()
          tx.objectStore('todos').add({
            uid: crypto.randomUUID(), title: 'Old done', isCompleted: true, sortOrder: 1,
            createdAt: new Date(now - 100 * 86_400_000), modifiedAt: new Date(now), completedAt: new Date(now - 60 * 86_400_000),
          })
          tx.objectStore('settings').put({ key: 'completedRetentionDays', value: '30' })
          tx.oncomplete = () => { idb.close(); resolve() }
          tx.onerror = () => reject(tx.error)
        }
        req.onerror = () => reject(req.error)
      })
    }, DB_NAME)
    await startupBackupTaken(page)
    await page.reload()
    await failBackups(page, true)

    const purge = page.getByRole('dialog', { name: 'Delete 1 old completed task?' })
    await expect(purge).toBeVisible()
    await purge.getByRole('button', { name: 'Delete', exact: true }).click()
    const prompt = backupPrompt(page)
    await expect(prompt).toBeVisible()
    // The copy names no place the phone doesn't have.
    await expect(prompt).not.toContainText('Settings')
    await prompt.getByRole('button', { name: 'Continue' }).click()
    await expect(purge).toBeHidden()
    await expect(page.getByText('Deleted 1 completed task. No backup was taken.')).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: 'No backup was taken' })).toHaveCount(0)
    expect(await dbTitles(page)).toEqual([])
  })
})
