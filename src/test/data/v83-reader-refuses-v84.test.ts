import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'

/**
 * A build whose schema is v83 — the one before a repeat became any interval
 * — reading what the current build writes (stamped v84 or later). It must
 * refuse it rather than read it as its own: a v83 build reads a repeat by its
 * `type`, which a v84 rule no longer has, and writing its read back over a
 * v84 sync file is the downgrade the gate exists for. The file's
 * `__schemaVersion` and the browser database's version are each compared
 * with `CURRENT_DB_VERSION`.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 83,
}))

describe('a v83 build reading v84 data', () => {
  it('refuses a v84 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 84,
      todos: [{
        id: 1, uid: 'u1', title: 'Weekly sync', isCompleted: false, sortOrder: 0,
        createdAt: '2026-10-01T09:00:00.000Z', modifiedAt: '2026-11-02T09:00:00.000Z',
        dueDate: '2026-11-23T06:00:00.000Z', recurrenceRule: { every: { count: 2, unit: 'w' } },
      }],
      people: [],
      settings: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v84')
    expect(result.error).toContain('up to v83')
  })

  it('refuses a browser database a v84 (or later) build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    const found = await checkTooNewDB()
    expect(found?.buildVersion).toBe(83)
    expect(found?.storedVersion).toBeGreaterThanOrEqual(84)
    await db.delete()
  })
})
