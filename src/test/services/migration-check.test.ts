import { describe, it, expect, afterEach } from 'vitest'
import { checkMigrationNeeded, exportCurrentDatabase, detectLegacyFormat } from '../../services/migration-check'

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
  await deleteDb()
})

describe('checkMigrationNeeded', () => {
  it('returns null when no database exists', async () => {
    expect(await checkMigrationNeeded()).toBeNull()
  })

  it('returns null when database is at current version', async () => {
    // Dexie v22 = IDB v220
    await createRawDb(220, (db) => {
      db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
    })
    expect(await checkMigrationNeeded()).toBeNull()
  })

  it('returns migration info when data migration is pending', async () => {
    // Dexie v21 = IDB v210 (only v22 pending — v22 is a pure data migration in DATA_MIGRATIONS)
    await createRawDb(210, (db) => {
      db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
    })

    const result = await checkMigrationNeeded()
    expect(result).not.toBeNull()
    expect(result!.currentVersion).toBe(21)
    expect(result!.targetVersion).toBe(22)
    expect(result!.migrations).toHaveLength(1)
    expect(result!.migrations[0].version).toBe(22)
  })

  it('detects migration from much older versions', async () => {
    // Dexie v16 = IDB v160 (v20 + v21 + v22 pending)
    await createRawDb(160, (db) => {
      db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
    })

    const result = await checkMigrationNeeded()
    expect(result).not.toBeNull()
    expect(result!.currentVersion).toBe(16)
    expect(result!.migrations).toHaveLength(3)
    expect(result!.migrations.map(m => m.version)).toEqual([20, 21, 22])
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
  it('returns null for data with no legacy fields', () => {
    expect(detectLegacyFormat({ todos: [{ title: 'Task' }], listInsets: [] })).toBeNull()
  })

  it('returns null for non-object input', () => {
    expect(detectLegacyFormat(null)).toBeNull()
    expect(detectLegacyFormat('string')).toBeNull()
  })

  it('detects isStarred todos', () => {
    const result = detectLegacyFormat({
      todos: [
        { title: 'A', isStarred: true },
        { title: 'B', isStarred: false },
        { title: 'C', isStarred: true },
      ],
    })
    expect(result).not.toBeNull()
    expect(result!.starredCount).toBe(2)
    expect(result!.assignedCount).toBe(0)
  })

  it('detects isAssigned todos', () => {
    const result = detectLegacyFormat({
      todos: [{ title: 'A', isAssigned: true }],
    })
    expect(result!.assignedCount).toBe(1)
  })

  it('detects starred list insets', () => {
    const result = detectLegacyFormat({
      todos: [],
      listInsets: [
        { preset: 'starred' },
        { preset: 'due-this-week' },
      ],
    })
    expect(result!.starredInsetCount).toBe(1)
  })

  it('builds human-readable descriptions', () => {
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
