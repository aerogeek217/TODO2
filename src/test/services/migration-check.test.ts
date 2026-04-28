import { describe, it, expect, afterEach } from 'vitest'
import { checkMigrationNeeded, exportCurrentDatabase, detectLegacyFormat, SCHEMA_VERSION_KEY } from '../../services/migration-check'
import { CURRENT_DB_VERSION, db } from '../../data/database'

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
  // db must be closed before delete; harmless if it was never opened.
  if (db.isOpen()) db.close()
  await deleteDb()
})

describe('schema-upgrade source-of-truth', () => {
  // Single load-bearing assertion that protects every future schema bump:
  // if someone adds `this.version(N+1)` without bumping CURRENT_DB_VERSION,
  // the migration-check prompt would silently regress (this is exactly how
  // the prompt rotted from v23 → v48). This test fails loud instead.
  it('CURRENT_DB_VERSION matches the latest declared db.version()', async () => {
    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
  })
})

describe('checkMigrationNeeded', () => {
  it('returns null when no database exists', async () => {
    expect(await checkMigrationNeeded()).toBeNull()
  })

  it('returns null when the on-disk db is at the current version', async () => {
    await createRawDb(CURRENT_DB_VERSION * 10, (db) => {
      db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
    })
    expect(await checkMigrationNeeded()).toBeNull()
  })

  it('returns migration info when the on-disk db is one version behind', async () => {
    const oldVersion = CURRENT_DB_VERSION - 1
    await createRawDb(oldVersion * 10, (db) => {
      db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
    })

    const result = await checkMigrationNeeded()
    expect(result).not.toBeNull()
    expect(result!.currentVersion).toBe(oldVersion)
    expect(result!.targetVersion).toBe(CURRENT_DB_VERSION)
  })

  it('detects migration from much older versions', async () => {
    // Dexie v16 = IDB v160 (the original base schema)
    await createRawDb(160, (db) => {
      db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
    })

    const result = await checkMigrationNeeded()
    expect(result).not.toBeNull()
    expect(result!.currentVersion).toBe(16)
    expect(result!.targetVersion).toBe(CURRENT_DB_VERSION)
  })
})

describe('exportCurrentDatabase', () => {
  it('exports all table data as JSON', async () => {
    // Dexie v19 = IDB v190; exportCurrentDatabase takes Dexie version
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

describe('detectLegacyFormat', () => {
  it('returns null for non-object input', () => {
    expect(detectLegacyFormat(null)).toBeNull()
    expect(detectLegacyFormat('string')).toBeNull()
  })

  it('returns null for current-version files (embedded marker)', () => {
    expect(detectLegacyFormat({ [SCHEMA_VERSION_KEY]: CURRENT_DB_VERSION, todos: [] })).toBeNull()
  })

  it('returns null for files at a future version (forward-compat — restore handles it)', () => {
    // A file written by a newer build has schema features we may not understand
    // but is not "legacy"; the prompt is for backward upgrades.
    expect(detectLegacyFormat({ [SCHEMA_VERSION_KEY]: CURRENT_DB_VERSION + 1, todos: [] })).toBeNull()
  })

  it('flags files at an older embedded version', () => {
    const result = detectLegacyFormat({ [SCHEMA_VERSION_KEY]: 30, todos: [] })
    expect(result).not.toBeNull()
    expect(result!.sourceVersion).toBe(30)
    expect(result!.targetVersion).toBe(CURRENT_DB_VERSION)
    expect(result!.descriptions).toEqual([])
  })

  it('returns null for marker-less files with no recognised legacy fields', () => {
    expect(detectLegacyFormat({ todos: [{ title: 'Task' }], listInsets: [] })).toBeNull()
  })

  it('falls back to heuristic detection when __schemaVersion is missing', () => {
    const result = detectLegacyFormat({
      todos: [
        { title: 'A', isStarred: true },
        { title: 'B', isStarred: false },
        { title: 'C', isStarred: true },
      ],
    })
    expect(result).not.toBeNull()
    expect(result!.sourceVersion).toBeNull()
    expect(result!.targetVersion).toBe(CURRENT_DB_VERSION)
    expect(result!.descriptions.some(d => d.includes('starred'))).toBe(true)
  })

  it('detects isAssigned todos (heuristic path)', () => {
    const result = detectLegacyFormat({
      todos: [{ title: 'A', isAssigned: true }],
    })
    expect(result!.descriptions.some(d => d.includes('Assigned'))).toBe(true)
  })

  it('detects starred list insets (heuristic path)', () => {
    const result = detectLegacyFormat({
      todos: [],
      listInsets: [
        { preset: 'starred' },
        { preset: 'due-this-week' },
      ],
    })
    expect(result!.descriptions.some(d => d.includes('starred list inset'))).toBe(true)
  })

  it('builds multiple human-readable descriptions when several legacy signals are present', () => {
    const result = detectLegacyFormat({
      todos: [{ isStarred: true }, { isAssigned: true }],
      listInsets: [{ preset: 'starred' }],
    })
    expect(result!.descriptions).toHaveLength(3)
  })

  it('returns null when legacy booleans are all false', () => {
    expect(detectLegacyFormat({
      todos: [{ isStarred: false, isAssigned: false }],
    })).toBeNull()
  })
})
