import { describe, it, expect, afterEach } from 'vitest'
import { checkTooNewDB, checkTooOldDB } from '../../services/migration-check'
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

describe('checkTooOldDB', () => {
  it('returns null when no database exists', async () => {
    expect(await checkTooOldDB()).toBeNull()
  })

  it('returns null when the on-disk db is at the floor', async () => {
    await createRawDb(OLDEST_SUPPORTED_DB_VERSION * 10, (db) => {
      db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
    })
    expect(await checkTooOldDB()).toBeNull()
  })

  it('returns null when the on-disk db is at the current version', async () => {
    await createRawDb(CURRENT_DB_VERSION * 10, (db) => {
      db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
    })
    expect(await checkTooOldDB()).toBeNull()
  })

  it('returns the versions when the on-disk db is one version below the floor', async () => {
    const oldVersion = OLDEST_SUPPORTED_DB_VERSION - 1
    await createRawDb(oldVersion * 10, (db) => {
      db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
    })
    expect(await checkTooOldDB()).toEqual({ storedVersion: oldVersion, floorVersion: OLDEST_SUPPORTED_DB_VERSION })
  })

  it('returns the versions for a much older database', async () => {
    // Dexie v16 = IDB v160 (the original base schema)
    await createRawDb(160, (db) => {
      db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
    })
    expect(await checkTooOldDB()).toEqual({ storedVersion: 16, floorVersion: OLDEST_SUPPORTED_DB_VERSION })
  })
})

describe('checkTooNewDB', () => {
  it('returns null when no database exists, or it is at this build’s version or older', async () => {
    expect(await checkTooNewDB()).toBeNull()
    await createRawDb(CURRENT_DB_VERSION * 10, (db) => {
      db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
    })
    expect(await checkTooNewDB()).toBeNull()
  })

  it('returns the versions when a newer build saved the database', async () => {
    await createRawDb((CURRENT_DB_VERSION + 1) * 10, (db) => {
      db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
    })
    expect(await checkTooNewDB()).toEqual({ storedVersion: CURRENT_DB_VERSION + 1, buildVersion: CURRENT_DB_VERSION })
  })
})

describe('a browser that can’t list its databases', () => {
  // Without `indexedDB.databases()` (or when it throws) the checks read the
  // version from a raw open with no version — which never upgrades, and
  // never creates a database that isn't there.
  const listers = {
    missing: () => Object.defineProperty(indexedDB, 'databases', { value: undefined, configurable: true, writable: true }),
    throwing: () => Object.defineProperty(indexedDB, 'databases', { value: () => Promise.reject(new Error('unavailable')), configurable: true, writable: true }),
  }
  let restoreList: (() => void) | null = null

  function withoutList(kind: keyof typeof listers): void {
    const own = Object.getOwnPropertyDescriptor(indexedDB, 'databases')
    listers[kind]()
    restoreList = () => {
      if (own) Object.defineProperty(indexedDB, 'databases', own)
      else delete (indexedDB as { databases?: unknown }).databases
    }
  }

  afterEach(() => {
    restoreList?.()
    restoreList = null
  })

  async function nativeVersions(): Promise<Array<number | undefined>> {
    return (await indexedDB.databases()).filter((d) => d.name === 'todo2').map((d) => d.version)
  }

  for (const kind of ['missing', 'throwing'] as const) {
    it(`finds a database below the floor (list ${kind})`, async () => {
      await createRawDb((OLDEST_SUPPORTED_DB_VERSION - 1) * 10, (db) => {
        db.createObjectStore('orgs', { keyPath: 'id', autoIncrement: true })
      })
      withoutList(kind)
      expect(await checkTooOldDB()).toEqual({ storedVersion: OLDEST_SUPPORTED_DB_VERSION - 1, floorVersion: OLDEST_SUPPORTED_DB_VERSION })
      expect(await checkTooNewDB()).toBeNull()
      restoreList?.()
      expect(await nativeVersions()).toEqual([(OLDEST_SUPPORTED_DB_VERSION - 1) * 10])
    })

    it(`finds a database a newer build saved (list ${kind})`, async () => {
      await createRawDb((CURRENT_DB_VERSION + 1) * 10 + 1, (db) => {
        db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
      })
      withoutList(kind)
      expect(await checkTooNewDB()).toEqual({ storedVersion: CURRENT_DB_VERSION + 1, buildVersion: CURRENT_DB_VERSION })
      expect(await checkTooOldDB()).toBeNull()
    })

    it(`passes a database at the current version and creates none (list ${kind})`, async () => {
      withoutList(kind)
      expect(await checkTooOldDB()).toBeNull()
      expect(await checkTooNewDB()).toBeNull()
      restoreList?.()
      expect(await nativeVersions()).toEqual([])

      await createRawDb(CURRENT_DB_VERSION * 10, (db) => {
        db.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
      })
      withoutList(kind)
      expect(await checkTooOldDB()).toBeNull()
      expect(await checkTooNewDB()).toBeNull()
      restoreList?.()
      expect(await nativeVersions()).toEqual([CURRENT_DB_VERSION * 10])
    })
  }
})
