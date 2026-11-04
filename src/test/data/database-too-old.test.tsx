import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import App from '../../App'
import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION, Todo2Database, db, findDatabaseTooOld } from '../../data/database'
import { prepareImportText } from '../../data/import-pipeline'
import { readRawDatabaseExport, replaceUnreadableDatabase } from '../../data/old-database'
import { makeTodo } from '../helpers'

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

  it('the app says so instead of starting, naming the version, with Reload, Download this data and Import a file…', async () => {
    await createOlderDb(OLDER)
    render(<App />)
    const dialog = await screen.findByRole('dialog', { name: 'Data from an older version of TODO2' })
    expect(dialog.textContent).toContain(`(schema v${OLDER}); this version reads v${OLDEST_SUPPORTED_DB_VERSION} and newer`)
    expect(dialog.textContent).toContain('Nothing was read or changed.')
    expect(dialog.textContent).toContain('the last TODO2 build from before 2026-10-23')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download this data' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Import a file…' })).toBeTruthy()
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

/** A full export at this build's version holding one task, as a file's text. */
function exportWithOneTask(title: string): string {
  return JSON.stringify({ __schemaVersion: CURRENT_DB_VERSION, todos: [makeTodo({ id: 1, title })], settings: [] })
}

describe('getting past a database below the floor', () => {
  it('Download this data: the raw database as a file stamped with its own version, without its backups', async () => {
    await createOlderDb(OLDER)
    const old = await readRawDatabaseExport(new Date('2026-11-03T12:00:00Z'))
    expect(old?.storedVersion).toBe(OLDER)
    const file = JSON.parse(old!.json) as Record<string, unknown>
    expect(file).toEqual({
      __schemaVersion: OLDER,
      todos: [{ id: 1, title: 'From the past' }],
      orgs: [{ id: 1, name: 'Acme' }],
      exportedAt: '2026-11-03T12:00:00.000Z',
    })
    // Reading it changed nothing.
    expect(await readRawDb()).toEqual(untouched)
  })

  it('Download this data with no database: nothing to save, and none is made', async () => {
    expect(await readRawDatabaseExport()).toBeNull()
    expect((await indexedDB.databases()).some((d) => d.name === 'todo2')).toBe(false)
  })

  it('a file replaces it — after the refused open too — at this build’s version', async () => {
    await createOlderDb(OLDER)
    expect(findDatabaseTooOld(await db.open().then(() => null, (e: unknown) => e))).not.toBeNull()
    const prepared = prepareImportText(exportWithOneTask('From a file'))
    if (!prepared.ok) throw new Error(prepared.error)
    await replaceUnreadableDatabase(prepared.data)
    // What the reload finds: this build's version and stores, the file's rows.
    const fresh = new Todo2Database()
    try {
      await fresh.open()
      expect(fresh.verno).toBe(CURRENT_DB_VERSION)
      expect(Array.from(fresh.backendDB().objectStoreNames)).toContain('statusUpdates')
      expect(Array.from(fresh.backendDB().objectStoreNames)).not.toContain('orgs')
      expect((await fresh.todos.toArray()).map((t) => t.title)).toEqual(['From a file'])
      expect(await fresh.statuses.count()).toBeGreaterThan(0)
    } finally {
      fresh.close()
    }
  })

  it('Import a file… asks first, with the task count and the download beside Replace; Cancel goes back', async () => {
    await createOlderDb(OLDER)
    render(<App />)
    await screen.findByRole('dialog', { name: 'Data from an older version of TODO2' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([exportWithOneTask('From a file')], 'todo2-backup.json', { type: 'application/json' })
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
    const ask = await screen.findByText(/Replace this browser’s data with/)
    expect(ask.textContent).toBe('Replace this browser’s data with todo2-backup.json (1 task)?')
    expect(screen.getByRole('button', { name: 'Replace' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download this data' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Import a file…' })).toBeTruthy()
    // Nothing was written.
    expect(await readRawDb()).toEqual(untouched)
  })

  it('a file this build can’t import says why and asks nothing', async () => {
    await createOlderDb(OLDER)
    render(<App />)
    await screen.findByRole('dialog', { name: 'Data from an older version of TODO2' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([JSON.stringify({ __schemaVersion: OLDER, todos: [], settings: [] })], 'old.json', { type: 'application/json' })
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
    expect((await screen.findByRole('alert')).textContent).toMatch(/^That file can’t be imported — /)
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull()
    expect(await readRawDb()).toEqual(untouched)
  })
})
