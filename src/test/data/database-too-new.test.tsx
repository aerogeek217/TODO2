import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import App from '../../App'
import { CURRENT_DB_VERSION, db, findDatabaseTooNew } from '../../data/database'

/**
 * A browser database saved by a newer build (its version above
 * `CURRENT_DB_VERSION`) is never read or written: the app says so before
 * anything opens it, and the database's own open refuses it too (where the
 * browser can't list its databases). Dexie on its own would open it at its
 * version and this build would read data it doesn't understand.
 */

const NEWER = CURRENT_DB_VERSION + 1

/**
 * A `todo2` database as a newer build at schema `version` leaves it: this
 * build's tables (one task in them), the version raised past this build's.
 */
async function createNewerDb(version: number): Promise<void> {
  await db.open()
  await db.todos.add({ title: 'From the future' } as never)
  db.close()
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('todo2', version * 10)
    req.onsuccess = () => { req.result.close(); resolve() }
    req.onerror = () => reject(req.error)
  })
}

/** The raw database's version and tasks, read without Dexie. */
function readRawDb(): Promise<{ version: number; todos: unknown[] }> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('todo2')
    req.onsuccess = () => {
      const idb = req.result
      const get = idb.transaction('todos', 'readonly').objectStore('todos').getAll()
      get.onsuccess = () => { idb.close(); resolve({ version: idb.version, todos: get.result }) }
      get.onerror = () => { idb.close(); reject(get.error) }
    }
    req.onerror = () => reject(req.error)
  })
}

afterEach(async () => {
  cleanup()
  db.close()
  await db.delete()
})

describe('a database saved by a newer build', () => {
  it('fails to open with DatabaseTooNewError: nothing is read or written', async () => {
    await createNewerDb(NEWER)
    const opened = await db.open().then(() => null, (e: unknown) => e)
    expect(findDatabaseTooNew(opened)?.storedVersion).toBe(NEWER)
    // A table call (auto-open) fails the same way.
    const read = await db.todos.toArray().then(() => null, (e: unknown) => e)
    expect(findDatabaseTooNew(read)).not.toBeNull()
    const write = await db.settings.put({ key: 'themeMode', value: 'light' }).then(() => null, (e: unknown) => e)
    expect(findDatabaseTooNew(write)).not.toBeNull()
    expect(await readRawDb()).toEqual({ version: NEWER * 10, todos: [expect.objectContaining({ title: 'From the future' })] })
  })

  it('the app says so instead of starting, with Reload as the only way on', async () => {
    await createNewerDb(NEWER)
    render(<App />)
    const dialog = await screen.findByRole('dialog', { name: 'Data from a newer version of TODO2' })
    expect(dialog.textContent).toContain(`(schema v${NEWER}); this version supports up to v${CURRENT_DB_VERSION}`)
    expect(dialog.textContent).toContain('Nothing was read or changed.')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Settings$/ })).toBeNull()
    expect((await readRawDb()).version).toBe(NEWER * 10)
  })

  it('where the browser can’t list its databases, the launch’s open refuses it and the app says so', async () => {
    await createNewerDb(NEWER)
    const own = Object.getOwnPropertyDescriptor(indexedDB, 'databases')
    Object.defineProperty(indexedDB, 'databases', { value: undefined, configurable: true, writable: true })
    try {
      render(<App />)
      await screen.findByRole('dialog', { name: 'Data from a newer version of TODO2' })
    } finally {
      if (own) Object.defineProperty(indexedDB, 'databases', own)
      else delete (indexedDB as { databases?: unknown }).databases
    }
    expect((await readRawDb()).version).toBe(NEWER * 10)
  })
})
