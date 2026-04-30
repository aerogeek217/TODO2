import { describe, it, expect, afterEach } from 'vitest'
import {
  checkUnsupportedOldDB,
  detectUnsupportedImport,
  exportCurrentDatabase,
  SCHEMA_VERSION_KEY,
} from '../../services/migration-check'
import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION, db } from '../../data/database'

function createRawDb(version: number, setup?: (db: IDBDatabase) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('todo2', version)
    req.onupgradeneeded = () => setup?.(req.result)
    req.onsuccess = () => { req.result.close(); resolve() }
    req.onerror = () => reject(req.error)
  })
}

function deleteDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('todo2')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
  })
}

afterEach(async () => {
  if (db.isOpen()) db.close()
  await deleteDb()
})

describe('schema-upgrade source-of-truth', () => {
  // Single load-bearing assertion that protects every future schema bump:
  // if someone adds `this.version(N+1)` without bumping CURRENT_DB_VERSION,
  // the cross-floor warning would silently regress.
  it('CURRENT_DB_VERSION matches the latest declared db.version()', async () => {
    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
  })
})

describe('checkUnsupportedOldDB', () => {
  it('returns null when no database exists', async () => {
    expect(await checkUnsupportedOldDB()).toBeNull()
  })

  it('returns null when the on-disk db is at the floor', async () => {
    await createRawDb(OLDEST_SUPPORTED_DB_VERSION * 10, (db) => {
      db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
    })
    expect(await checkUnsupportedOldDB()).toBeNull()
  })

  it('returns null when the on-disk db is at the current version', async () => {
    await createRawDb(CURRENT_DB_VERSION * 10, (db) => {
      db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
    })
    expect(await checkUnsupportedOldDB()).toBeNull()
  })

  it('returns info when the on-disk db is one version below the floor', async () => {
    const oldVersion = OLDEST_SUPPORTED_DB_VERSION - 1
    await createRawDb(oldVersion * 10, (db) => {
      db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
    })

    const result = await checkUnsupportedOldDB()
    expect(result).not.toBeNull()
    expect(result!.currentVersion).toBe(oldVersion)
    expect(result!.targetVersion).toBe(CURRENT_DB_VERSION)
  })

  it('returns info for a much older database', async () => {
    // Dexie v16 = IDB v160 (the original base schema)
    await createRawDb(160, (db) => {
      db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
    })

    const result = await checkUnsupportedOldDB()
    expect(result).not.toBeNull()
    expect(result!.currentVersion).toBe(16)
    expect(result!.targetVersion).toBe(CURRENT_DB_VERSION)
  })
})

describe('exportCurrentDatabase', () => {
  it('exports all table data as JSON', async () => {
    await createRawDb(190, (db) => {
      const store = db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
      store.add({ title: 'Test Task', priority: 0 })
    })

    const json = await exportCurrentDatabase(19)
    const data = JSON.parse(json)
    expect(data.todos).toHaveLength(1)
    expect(data.todos[0].title).toBe('Test Task')
  })

  it('exports multiple tables', async () => {
    await createRawDb(190, (db) => {
      const todos = db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
      todos.add({ title: 'Task 1' })
      const projects = db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true })
      projects.add({ name: 'Project 1' })
    })

    const json = await exportCurrentDatabase(19)
    const data = JSON.parse(json)
    expect(data.todos).toHaveLength(1)
    expect(data.projects).toHaveLength(1)
  })

  it('returns empty object for database with no tables', async () => {
    await createRawDb(10)

    const json = await exportCurrentDatabase(1)
    expect(JSON.parse(json)).toEqual({})
  })
})

describe('detectUnsupportedImport', () => {
  it('returns null for non-object input', () => {
    expect(detectUnsupportedImport(null)).toBeNull()
    expect(detectUnsupportedImport('string')).toBeNull()
  })

  it('returns null when the embedded marker is at the floor', () => {
    expect(
      detectUnsupportedImport({ [SCHEMA_VERSION_KEY]: OLDEST_SUPPORTED_DB_VERSION, todos: [] }),
    ).toBeNull()
  })

  it('returns null when the embedded marker is at the current version', () => {
    expect(
      detectUnsupportedImport({ [SCHEMA_VERSION_KEY]: CURRENT_DB_VERSION, todos: [] }),
    ).toBeNull()
  })

  it('returns null when the embedded marker is a future version (forward-compat)', () => {
    expect(
      detectUnsupportedImport({ [SCHEMA_VERSION_KEY]: CURRENT_DB_VERSION + 1, todos: [] }),
    ).toBeNull()
  })

  it('flags an embedded marker one version below the floor', () => {
    const result = detectUnsupportedImport({
      [SCHEMA_VERSION_KEY]: OLDEST_SUPPORTED_DB_VERSION - 1,
      todos: [],
    })
    expect(result).not.toBeNull()
    expect(result!.sourceVersion).toBe(OLDEST_SUPPORTED_DB_VERSION - 1)
    expect(result!.targetVersion).toBe(CURRENT_DB_VERSION)
    expect(result!.descriptions).toEqual([])
  })

  // Marker-less files always trigger the warning — we can't tell which version
  // they came from, so we surface the "earlier format" message and let the
  // user decide whether to proceed.
  it('flags marker-less files with sourceVersion null and empty descriptions', () => {
    const result = detectUnsupportedImport({ todos: [{ title: 'Task' }], listInsets: [] })
    expect(result).not.toBeNull()
    expect(result!.sourceVersion).toBeNull()
    expect(result!.targetVersion).toBe(CURRENT_DB_VERSION)
    expect(result!.descriptions).toEqual([])
  })
})
