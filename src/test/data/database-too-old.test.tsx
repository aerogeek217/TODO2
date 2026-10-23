import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import App from '../../App'
import { OLDEST_SUPPORTED_DB_VERSION, db, findDatabaseTooOld } from '../../data/database'

/**
 * A browser database below the floor (`OLDEST_SUPPORTED_DB_VERSION`) is never
 * read, written or upgraded: the app says so before anything opens it (from
 * the browser's list of databases, or a raw open where it can't list them),
 * and the database's own open refuses it too — the refused upgrade is rolled
 * back, so the database keeps its version, stores and rows.
 */

const OLDER = OLDEST_SUPPORTED_DB_VERSION - 1

/**
 * A raw `todo2` database at schema `version`: a `todos` store with one task
 * and an `orgs` store this build doesn't declare (a store an upgrade would
 * drop), and none of this build's other stores.
 */
function createOlderDb(version: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('todo2', version * 10)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('todos', { keyPath: 'id', autoIncrement: true }).add({ title: 'From the past' })
      req.result.createObjectStore('orgs', { keyPath: 'id', autoIncrement: true }).add({ name: 'Acme' })
    }
    req.onsuccess = () => { req.result.close(); resolve() }
    req.onerror = () => reject(req.error)
  })
}

/** The raw database's version, stores and tasks, read without Dexie. */
function readRawDb(): Promise<{ version: number; stores: string[]; todos: unknown[] }> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('todo2')
    req.onsuccess = () => {
      const idb = req.result
      const stores = Array.from(idb.objectStoreNames).sort()
      const get = idb.transaction('todos', 'readonly').objectStore('todos').getAll()
      get.onsuccess = () => { idb.close(); resolve({ version: idb.version, stores, todos: get.result }) }
      get.onerror = () => { idb.close(); reject(get.error) }
    }
    req.onerror = () => reject(req.error)
  })
}

const untouched = { version: OLDER * 10, stores: ['orgs', 'todos'], todos: [{ id: 1, title: 'From the past' }] }

/** Runs `fn` with `indexedDB.databases` gone, as in a browser that can't list its databases. */
async function withoutDatabaseList(fn: () => Promise<void>): Promise<void> {
  const own = Object.getOwnPropertyDescriptor(indexedDB, 'databases')
  Object.defineProperty(indexedDB, 'databases', { value: undefined, configurable: true, writable: true })
  try {
    await fn()
  } finally {
    if (own) Object.defineProperty(indexedDB, 'databases', own)
    else delete (indexedDB as { databases?: unknown }).databases
  }
}

afterEach(async () => {
  cleanup()
  db.close()
  await db.delete()
})

describe('a database below the floor', () => {
  it('fails to open with DatabaseTooOldError: the upgrade is undone, nothing read or written', async () => {
    await createOlderDb(OLDER)
    const opened = await db.open().then(() => null, (e: unknown) => e)
    expect(findDatabaseTooOld(opened)).not.toBeNull()
    // A table call (auto-open) fails the same way.
    const read = await db.todos.toArray().then(() => null, (e: unknown) => e)
    expect(findDatabaseTooOld(read)).not.toBeNull()
    const write = await db.settings.put({ key: 'themeMode', value: 'light' }).then(() => null, (e: unknown) => e)
    expect(findDatabaseTooOld(write)).not.toBeNull()
    expect(await readRawDb()).toEqual(untouched)
  })

  it('the app says so instead of starting, naming the version, with Reload as the only way on', async () => {
    await createOlderDb(OLDER)
    render(<App />)
    const dialog = await screen.findByRole('dialog', { name: 'Data from an older version of TODO2' })
    expect(dialog.textContent).toContain(`(schema v${OLDER}); this version reads v${OLDEST_SUPPORTED_DB_VERSION} and newer`)
    expect(dialog.textContent).toContain('Nothing was read or changed.')
    expect(dialog.textContent).toContain('a TODO2 build from before 2026-10-23')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Settings$/ })).toBeNull()
    expect(await readRawDb()).toEqual(untouched)
  })

  it('where the browser can’t list its databases, the app still says so, naming the version', async () => {
    await createOlderDb(OLDER)
    await withoutDatabaseList(async () => {
      render(<App />)
      const dialog = await screen.findByRole('dialog', { name: 'Data from an older version of TODO2' })
      expect(dialog.textContent).toContain(`(schema v${OLDER}); this version reads v${OLDEST_SUPPORTED_DB_VERSION} and newer`)
      expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    })
    expect(await readRawDb()).toEqual(untouched)
  })
})
