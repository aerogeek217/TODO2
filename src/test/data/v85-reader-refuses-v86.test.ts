import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'

/**
 * A build whose schema is v85 — the one before a task could be held in the
 * Planner's Unplanned tray — reading what the current build writes (stamped
 * v86 or later). It must refuse it rather than read it as its own: a v85
 * build rebuilds each task from the keys it knows, so a task's `unplanned`
 * would vanish (the task back on the day its dates put it), and writing its
 * read back over a v86 sync file is the downgrade the gate exists for. The
 * file's `__schemaVersion` and the browser database's version are each
 * compared with `CURRENT_DB_VERSION`.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 85,
}))

describe('a v85 build reading v86 data', () => {
  it('refuses a v86 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 86,
      todos: [{
        id: 1, uid: 'u1', title: 'Draft the plan', isCompleted: false, sortOrder: 0,
        createdAt: '2026-10-01T09:00:00.000Z', modifiedAt: '2026-11-02T09:00:00.000Z',
        nextFollowupAt: '2026-11-23T06:00:00.000Z', unplanned: true,
      }],
      people: [],
      settings: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v86')
    expect(result.error).toContain('up to v85')
  })

  it('refuses a browser database a v86 (or later) build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    const found = await checkTooNewDB()
    expect(found?.buildVersion).toBe(85)
    expect(found?.storedVersion).toBeGreaterThanOrEqual(86)
    await db.delete()
  })
})
