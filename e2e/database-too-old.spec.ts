import { expect, test, type Page } from '@playwright/test'
import { DB_NAME } from './fixtures/db'

/**
 * A browser database saved below the schema floor is refused at startup:
 * the app shows "Data from an older version of TODO2" (Reload only) and
 * neither opens nor changes the database — its version, stores and rows
 * stay as they were, through a reload too.
 */

/** Native IndexedDB version of a schema-v67 database (Dexie stores schema × 10). */
const V67_NATIVE = 670

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
  await expect(dialog.getByRole('button')).toHaveText(['Reload'])
  await expect(page.locator('[data-ws-area]')).toHaveCount(0)
  expect(await rawDatabase(page)).toEqual({ version: V67_NATIVE, stores: { orgs: 1, todos: 1 } })

  // Reload asks again; still nothing opened or changed.
  const reloaded = page.waitForEvent('load')
  await dialog.getByRole('button', { name: 'Reload' }).click()
  await reloaded
  await expect(page.getByRole('dialog', { name: 'Data from an older version of TODO2' })).toContainText('schema v67')
  expect(await rawDatabase(page)).toEqual({ version: V67_NATIVE, stores: { orgs: 1, todos: 1 } })
})
