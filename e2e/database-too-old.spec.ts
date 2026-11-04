import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { DB_NAME } from './fixtures/db'

/**
 * A browser database saved below the schema floor is refused at startup:
 * the app shows "Data from an older version of TODO2" and neither opens nor
 * changes the database — its version, stores and rows stay as they were,
 * through a reload too. Also where the browser can't list its databases, and
 * in the database's own open (the backstop: its refused upgrade is rolled
 * back by the real engine). The ways on: Download this data, or Import a
 * file…, which replaces the database after asking.
 */

/** Native IndexedDB version of a schema-v67 database (Dexie stores schema × 10). */
const V67_NATIVE = 670

/** The dialog's buttons, in order. */
const WAYS_ON = ['Download this data', 'Import a file…', 'Reload']

/**
 * Creates the app's database straight in IndexedDB at `version`, before the
 * app ever opens it: a `todos` row and an `orgs` store (one the current
 * schema doesn't have, so an upgrade would drop it).
 */
async function createRawDatabase(page: Page, version: number): Promise<void> {
  await page.evaluate(async ({ name, version }) => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, version)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
        req.result.createObjectStore('orgs', { keyPath: 'id', autoIncrement: true })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(['todos', 'orgs'], 'readwrite')
      tx.objectStore('todos').add({ title: 'Kept as it was', isCompleted: false })
      tx.objectStore('orgs').add({ name: 'Northwind' })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    idb.close()
  }, { name: DB_NAME, version })
}

/** The database's native version, store names and row counts, read without upgrading it. */
async function rawDatabase(page: Page): Promise<{ version: number; stores: Record<string, number> }> {
  return page.evaluate(async (name) => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    try {
      const names = Array.from(idb.objectStoreNames)
      const tx = idb.transaction(names, 'readonly')
      const counts = names.map((n) => tx.objectStore(n).count())
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      return { version: idb.version, stores: Object.fromEntries(names.map((n, i) => [n, counts[i]?.result as number])) }
    } finally {
      idb.close()
    }
  }, DB_NAME)
}

test('a database below the schema floor is refused at startup and left untouched', async ({ page }) => {
  // A page of the app's origin that doesn't start the app, to set the database up.
  await page.goto('/favicon.svg')
  await createRawDatabase(page, V67_NATIVE)

  await page.goto('/')
  const dialog = page.getByRole('dialog', { name: 'Data from an older version of TODO2' })
  await expect(dialog).toContainText('schema v67')
  await expect(dialog).toContainText('Nothing was read or changed')
  await expect(dialog.getByRole('button')).toHaveText(WAYS_ON)
  await expect(page.locator('[data-ws-area]')).toHaveCount(0)
  expect(await rawDatabase(page)).toEqual({ version: V67_NATIVE, stores: { orgs: 1, todos: 1 } })

  // Reload asks again; still nothing opened or changed.
  const reloaded = page.waitForEvent('load')
  await dialog.getByRole('button', { name: 'Reload' }).click()
  await reloaded
  await expect(page.getByRole('dialog', { name: 'Data from an older version of TODO2' })).toContainText('schema v67')
  expect(await rawDatabase(page)).toEqual({ version: V67_NATIVE, stores: { orgs: 1, todos: 1 } })
})

test('where the browser can’t list its databases, it is still refused, naming the version, and left untouched', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(IDBFactory.prototype, 'databases', { value: undefined, configurable: true })
  })
  await page.goto('/favicon.svg')
  await createRawDatabase(page, V67_NATIVE)

  await page.goto('/')
  const dialog = page.getByRole('dialog', { name: 'Data from an older version of TODO2' })
  await expect(dialog).toContainText('schema v67')
  await expect(dialog.getByRole('button')).toHaveText(WAYS_ON)
  await expect(page.locator('[data-ws-area]')).toHaveCount(0)
  expect(await rawDatabase(page)).toEqual({ version: V67_NATIVE, stores: { orgs: 1, todos: 1 } })
})

test('the database’s own open refuses a database below the floor and the engine rolls it back', async ({ page }) => {
  await page.goto('/favicon.svg')
  await createRawDatabase(page, V67_NATIVE)

  // The app's database module, opened straight — no version check first.
  const refused = await page.evaluate(async () => {
    const path = '/src/data/database.ts'
    const mod = (await import(/* @vite-ignore */ path)) as typeof import('../src/data/database')
    const error = await mod.db.open().then(() => null, (e: unknown) => e)
    mod.db.close()
    return mod.findDatabaseTooOld(error) !== null
  })
  expect(refused).toBe(true)
  expect(await rawDatabase(page)).toEqual({ version: V67_NATIVE, stores: { orgs: 1, todos: 1 } })
})

test('Download this data saves the old data; Import a file… asks, then replaces the database and the app starts', async ({ page }) => {
  await page.goto('/favicon.svg')
  await createRawDatabase(page, V67_NATIVE)
  await page.goto('/')
  const dialog = page.getByRole('dialog', { name: 'Data from an older version of TODO2' })
  await expect(dialog).toContainText('schema v67')

  // The old data as a file, stamped with its own version; nothing changed.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download this data' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^todo2-old-data-v67-.*\.json$/)
  const path = await download.path()
  const saved = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  expect(saved).toMatchObject({
    __schemaVersion: 67,
    todos: [{ id: 1, title: 'Kept as it was' }],
    orgs: [{ id: 1, name: 'Northwind' }],
  })
  await expect(dialog).toContainText('Downloaded the data in this browser')
  expect(await rawDatabase(page)).toEqual({ version: V67_NATIVE, stores: { orgs: 1, todos: 1 } })

  // A file from below the floor is refused, saying why; nothing asked.
  const input = page.locator('input[type="file"]')
  await input.setInputFiles({ name: 'too-old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) })
  await expect(dialog.getByRole('alert')).toContainText('That file can’t be imported')
  await expect(dialog.getByRole('button', { name: 'Replace' })).toHaveCount(0)

  // A good file (at the floor: its Progress upgrades on the way in) asks first; Cancel goes back.
  const now = new Date().toISOString()
  const file = {
    __schemaVersion: 68,
    todos: [{ id: 1, uid: 'from-a-file', title: 'From a file', progress: 'half done', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 0 }],
    settings: [],
  }
  const good = { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) }
  await input.setInputFiles(good)
  await expect(dialog).toContainText('Replace this browser’s data with backup.json (1 task)?')
  await expect(dialog).toContainText('You downloaded a copy of it')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog.getByRole('button')).toHaveText(WAYS_ON)
  expect(await rawDatabase(page)).toEqual({ version: V67_NATIVE, stores: { orgs: 1, todos: 1 } })

  // Replace: the page reloads into the app, on the file's data.
  await input.setInputFiles(good)
  const reloaded = page.waitForEvent('load')
  await dialog.getByRole('button', { name: 'Replace' }).click()
  await reloaded
  await expect(page.locator('[data-ws-area]').first()).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Data from an older version of TODO2' })).toHaveCount(0)
  const after = await rawDatabase(page)
  expect(after.version).toBeGreaterThan(V67_NATIVE)
  expect(after.stores).toMatchObject({ todos: 1, statusUpdates: 1 })
  expect(after.stores).not.toHaveProperty('orgs')
})
