import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'

/**
 * A build whose schema is v76 — the last one with a Dashboard — reading
 * what the current build writes (stamped v77 or later). It must refuse it
 * rather than read it as its own: it can't tell what the newer steps
 * changed (a later layout may hold a widget kind it doesn't know, which its
 * layout repair would drop), and it could write that back to the sync file
 * or a backup.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 76,
}))

describe('a v76 build reading v77 data', () => {
  it('refuses a v77 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 77,
      todos: [{ id: 1, uid: 'u1', title: 'Q4 budget', isCompleted: false, sortOrder: 0, createdAt: '2026-10-01T09:00:00.000Z', modifiedAt: '2026-11-02T09:00:00.000Z' }],
      subtasks: [{ id: 1, todoId: 1, title: 'Collect the numbers', isCompleted: false, sortOrder: 0, createdAt: '2026-11-02T09:00:00.000Z' }],
      settings: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v77')
    expect(result.error).toContain('up to v76')
  })

  it('refuses a browser database a v77 (or later) build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    const found = await checkTooNewDB()
    expect(found?.buildVersion).toBe(76)
    expect(found?.storedVersion).toBeGreaterThanOrEqual(77)
    await db.delete()
  })
})
