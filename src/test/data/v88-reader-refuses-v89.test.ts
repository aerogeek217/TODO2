import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'

/**
 * A build whose schema is v88 — the one with tasks held in the Planner's
 * Unplanned tray — reading what the current build writes (stamped v89 or
 * later). A v89 file holds nothing a v88 build reads wrong: it only lacks
 * `unplanned` and Planned's `held` clause, which v88 treats as absent. The
 * refusal is the version stamp itself: a build never reads data stamped
 * above its own version, so it never writes a newer file back as its own.
 * The file's `__schemaVersion` and the browser database's version are each
 * compared with `CURRENT_DB_VERSION`.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 88,
}))

describe('a v88 build reading v89 data', () => {
  it('refuses a v89 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 89,
      todos: [{
        id: 1, uid: 'u1', title: 'Call', isCompleted: false, sortOrder: 0, nextFollowupAt: '2026-11-23T09:00:00.000Z',
        createdAt: '2026-11-23T09:00:00.000Z', modifiedAt: '2026-11-23T09:00:00.000Z',
      }],
      settings: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v89')
    expect(result.error).toContain('up to v88')
  })

  it('refuses a browser database a v89 (or later) build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    const found = await checkTooNewDB()
    expect(found?.buildVersion).toBe(88)
    expect(found?.storedVersion).toBeGreaterThanOrEqual(89)
    await db.delete()
  })
})
