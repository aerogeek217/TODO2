import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'

/**
 * A build whose schema is v84 — the one before a task had a Do day —
 * reading what the current build writes (stamped v85 or later). It must
 * refuse it rather than read it as its own: a v84 build rebuilds each task
 * from the keys it knows, so a task's `doDate` would vanish, and writing its
 * read back over a v85 sync file is the downgrade the gate exists for. The
 * file's `__schemaVersion` and the browser database's version are each
 * compared with `CURRENT_DB_VERSION`.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 84,
}))

describe('a v84 build reading v85 data', () => {
  it('refuses a v85 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 85,
      todos: [{
        id: 1, uid: 'u1', title: 'Draft the plan', isCompleted: false, sortOrder: 0,
        createdAt: '2026-10-01T09:00:00.000Z', modifiedAt: '2026-11-02T09:00:00.000Z',
        doDate: '2026-11-23T06:00:00.000Z',
      }],
      people: [],
      settings: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v85')
    expect(result.error).toContain('up to v84')
  })

  it('refuses a browser database a v85 (or later) build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    const found = await checkTooNewDB()
    expect(found?.buildVersion).toBe(84)
    expect(found?.storedVersion).toBeGreaterThanOrEqual(85)
    await db.delete()
  })
})
