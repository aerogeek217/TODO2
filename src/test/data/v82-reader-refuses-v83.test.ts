import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'

/**
 * A build whose schema is v82 — the one before Project pulse and the
 * Pressure radar were removed — reading what the current build writes
 * (stamped v83 or later). It must refuse it rather than read it as its own:
 * the version gate is `CURRENT_DB_VERSION`, and a v82 build writing its
 * read back over a v83 sync file is the downgrade the gate exists for. The
 * file's `__schemaVersion` and the browser database's version are each
 * compared with it.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 82,
}))

describe('a v82 build reading v83 data', () => {
  it('refuses a v83 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 83,
      todos: [{ id: 1, uid: 'u1', title: 'Q4 budget', isCompleted: false, sortOrder: 0, createdAt: '2026-10-01T09:00:00.000Z', modifiedAt: '2026-11-02T09:00:00.000Z' }],
      people: [{ id: 1, name: 'Ada', initials: 'A' }],
      settings: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v83')
    expect(result.error).toContain('up to v82')
  })

  it('refuses a browser database a v83 (or later) build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    const found = await checkTooNewDB()
    expect(found?.buildVersion).toBe(82)
    expect(found?.storedVersion).toBeGreaterThanOrEqual(83)
    await db.delete()
  })
})
