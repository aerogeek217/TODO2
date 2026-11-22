import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'

/**
 * A build whose schema is v86 — the one before the planned date was a
 * filter, sort and group — reading what the current build writes (stamped
 * v87 or later). It must refuse it rather than read it as its own: a v86
 * build drops a `planned` date clause it doesn't know and refuses a list
 * sorted or grouped by `planned`, and writing its read back over a v87 sync
 * file is the downgrade the gate exists for. The file's `__schemaVersion` and
 * the browser database's version are each compared with `CURRENT_DB_VERSION`.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 86,
}))

describe('a v86 build reading v87 data', () => {
  it('refuses a v87 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 87,
      listDefinitions: [{
        id: 1, name: 'Planned', sortOrder: 0,
        membership: { kind: 'custom', predicate: { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: { planned: { match: 'held' } } } },
        sort: 'planned', grouping: 'planned',
      }],
      settings: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v87')
    expect(result.error).toContain('up to v86')
  })

  it('refuses a browser database a v87 (or later) build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    const found = await checkTooNewDB()
    expect(found?.buildVersion).toBe(86)
    expect(found?.storedVersion).toBeGreaterThanOrEqual(87)
    await db.delete()
  })
})
