import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'

/**
 * A build whose schema is v80 — the one deployed before lenses were removed —
 * reading what the current build writes (stamped v81 or later). It must
 * refuse it rather than read it as its own: v81 data has lost what a v80
 * build still reads (the lenses, the top bar's pick, every lens switch), and
 * a v80 build writing its read back over a v81 sync file is exactly the
 * downgrade the version gate exists for. The gate is `CURRENT_DB_VERSION`:
 * the file's `__schemaVersion` and the browser database's version are each
 * compared with it.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 80,
}))

describe('a v80 build reading v81 data', () => {
  it('refuses a v81 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 81,
      todos: [{ id: 1, uid: 'u1', title: 'Q4 budget', isCompleted: false, sortOrder: 0, createdAt: '2026-10-01T09:00:00.000Z', modifiedAt: '2026-11-02T09:00:00.000Z' }],
      people: [{ id: 1, name: 'Ada', initials: 'A' }],
      settings: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v81')
    expect(result.error).toContain('up to v80')
  })

  it('refuses a browser database a v81 (or later) build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    const found = await checkTooNewDB()
    expect(found?.buildVersion).toBe(80)
    expect(found?.storedVersion).toBeGreaterThanOrEqual(81)
    await db.delete()
  })
})
