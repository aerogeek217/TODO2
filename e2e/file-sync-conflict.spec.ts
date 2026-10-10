import { expect, test, type Page } from '@playwright/test'

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
const DB_NAME = 'todo2'

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
  return page.evaluate(async (name) => {
    const dir = await navigator.storage.getDirectory()
    const fh = await dir.getFileHandle(name, { create: true })
    return (await fh.getFile()).text()
  }, SYNC_FILE)
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
  return page.evaluate(async (db) => {
    return await new Promise<Record<string, unknown[]>>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => {
        const idb = req.result
        const names = Array.from(idb.objectStoreNames).filter((n) => n !== 'backups')
        const tx = idb.transaction(names, 'readonly')
        const out: Record<string, unknown[]> = {}
        for (const n of names) {
          const r = tx.objectStore(n).getAll()
          r.onsuccess = () => { out[n] = r.result }
        }
        tx.oncomplete = () => { idb.close(); resolve(JSON.parse(JSON.stringify(out))) }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
  }, DB_NAME)
}

async function addTodo(page: Page, title: string) {
  await page.evaluate(async ({ db, title }) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => {
        const idb = req.result
        const tx = idb.transaction(['todos'], 'readwrite')
        const now = new Date()
        tx.objectStore('todos').add({ uid: crypto.randomUUID(), title, isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 0 })
        tx.oncomplete = () => { idb.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
  }, { db: DB_NAME, title })
}

test('attaching a file that differs from a non-empty browser asks first; cancel and "Use browser data" behave', async ({ page }) => {
  await stubPicker(page)
  await page.goto('/')
  await page.locator('.react-flow__viewport').first().waitFor({ state: 'visible' })

  // Browser side: one task. File side: same DB, but the task renamed.
  await addTodo(page, 'Browser task')
  const dump = await dumpDb(page)
  const fileTodos = (dump.todos as Array<Record<string, unknown>>).map((t) => ({ ...t, title: 'File task' }))
  const fileText = JSON.stringify({ ...dump, todos: fileTodos, __schemaVersion: 49, savedAt: '2026-01-01T00:00:00.000Z' })
  await writeSyncFile(page, fileText)

  await page.goto('/#/settings')
  await page.getByRole('button', { name: 'Attach to File' }).click()

  // Conflict dialog before anything changed.
  const dialog = page.getByRole('dialog', { name: 'Browser data and sync file differ' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('no record of syncing')
  await expect(dialog.getByTestId('sync-conflict-sides')).toContainText('1 task')
  // Focus lands inside the dialog (Dialog primitive), not behind it.
  await expect(dialog.locator(':focus')).toHaveCount(1)
  expect(await readSyncFile(page)).toBe(fileText)

  // Cancel → paused, both sides untouched.
  await dialog.getByRole('button', { name: 'Cancel (pause sync)' }).click()
  const banner = page.getByTestId('file-sync-paused')
  await expect(banner).toContainText('File sync paused')
  expect(await readSyncFile(page)).toBe(fileText)
  const titles = ((await dumpDb(page)).todos as Array<{ title: string }>).map((t) => t.title)
  expect(titles).toEqual(['Browser task'])

  // Retry → asked again → keep the browser's data.
  await banner.getByRole('button', { name: 'Retry' }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Use browser data' }).click()
  await expect(dialog).toBeHidden()
  await expect(banner).toBeHidden()

  await expect.poll(async () => {
    const written = JSON.parse(await readSyncFile(page)) as { todos: Array<{ title: string }> }
    return written.todos.map((t) => t.title)
  }).toEqual(['Browser task'])

  // A file backup snapshot was taken before the overwrite.
  const backups = await page.evaluate(async (db) => new Promise<number>((resolve) => {
    const req = indexedDB.open(db)
    req.onsuccess = () => {
      const r = req.result.transaction(['backups'], 'readonly').objectStore('backups').getAll()
      r.onsuccess = () => resolve((r.result as Array<{ data: string }>).filter((b) => b.data.includes('File task')).length)
    }
  }), DB_NAME)
  expect(backups).toBeGreaterThan(0)

  // Now in sync: a reload loads silently.
  await page.reload()
  // Connected again (Settings shows the attached file) with no prompt.
  await expect(page.getByRole('button', { name: 'Attach to Different File' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('file-sync-paused')).toHaveCount(0)
})

test('an unreadable sync file pauses sync and is never overwritten by edits', async ({ page }) => {
  await stubPicker(page)
  await page.goto('/')
  await page.locator('.react-flow__viewport').first().waitFor({ state: 'visible' })
  await writeSyncFile(page, '{ not json')

  await page.goto('/#/settings')
  await page.getByRole('button', { name: 'Attach to File' }).click()

  await expect(page.getByTestId('file-sync-paused')).toContainText('invalid JSON')
  // A real app edit (QuickAdd → Dexie hooks), not a raw IDB write.
  await page.goto('/')
  await page.locator('.react-flow__viewport').first().waitFor({ state: 'visible' })
  await expect(page.getByTestId('file-sync-paused')).toBeVisible()
  await page.keyboard.press('Control+Space')
  const quickAdd = page.getByRole('dialog', { name: 'Quick add task' })
  await quickAdd.getByPlaceholder('New task…').fill('Edit while paused')
  await page.keyboard.press('Enter')
  await expect.poll(async () => ((await dumpDb(page)).todos as Array<{ title: string }>).map((t) => t.title))
    .toContain('Edit while paused')
  await page.waitForTimeout(1200) // > sync debounce
  expect(await readSyncFile(page)).toBe('{ not json')
  // …and the edit is recorded as unsynced for the next conflict check.
  const state = await page.evaluate(() => localStorage.getItem('todo2-file-sync-state'))
  expect(JSON.parse(state ?? '{}').dirtySince).toBeTruthy()
})
