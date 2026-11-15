import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'

/**
 * A build whose schema is v79 — the one deployed before check-ins by copy —
 * reading what the current build writes (stamped v80 or later). It must
 * refuse it rather than read it as its own: v80 data has lost what a v79
 * build still reads (people's addresses, how a check-in opens), and a v79
 * build writing its read back over a v80 sync file is exactly the downgrade
 * the version gate exists for. The gate is `CURRENT_DB_VERSION`: the file's
 * `__schemaVersion` and the browser database's version are each compared
 * with it.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 79,
}))

describe('a v79 build reading v80 data', () => {
  it('refuses a v80 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 80,
      todos: [{ id: 1, uid: 'u1', title: 'Q4 budget', isCompleted: false, sortOrder: 0, createdAt: '2026-10-01T09:00:00.000Z', modifiedAt: '2026-11-02T09:00:00.000Z' }],
      people: [{ id: 1, name: 'Ada', initials: 'A' }],
      settings: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v80')
    expect(result.error).toContain('up to v79')
  })

  it('refuses a browser database a v80 (or later) build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    const found = await checkTooNewDB()
    expect(found?.buildVersion).toBe(79)
    expect(found?.storedVersion).toBeGreaterThanOrEqual(80)
    await db.delete()
  })
})
