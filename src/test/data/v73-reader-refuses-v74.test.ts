import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'

/**
 * A build whose schema is v73 — the last one whose Priority filter is one set
 * of conditions — reading what the current build writes (stamped v74 or
 * later). It must refuse it rather than misread it: it drops a list of
 * conditions as a malformed filter, so a list would show more tasks than it
 * should, and it could write that back to the sync file or a backup.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 73,
}))

describe('a v73 build reading v74 data', () => {
  it('refuses a v74 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 74,
      todos: [{ id: 1, uid: 'u1', title: 'Q4 budget', isCompleted: false, sortOrder: 0, createdAt: '2026-10-01T09:00:00.000Z', modifiedAt: '2026-11-02T09:00:00.000Z' }],
      subtasks: [{ id: 1, todoId: 1, title: 'Collect the numbers', isCompleted: false, sortOrder: 0, createdAt: '2026-11-02T09:00:00.000Z' }],
      settings: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v74')
    expect(result.error).toContain('up to v73')
  })

  it('refuses a browser database a v74 (or later) build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    const found = await checkTooNewDB()
    expect(found?.buildVersion).toBe(73)
    expect(found?.storedVersion).toBeGreaterThanOrEqual(74)
    await db.delete()
  })
})
