import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'

/**
 * A build whose schema is v89 — the one with Number tabs and strips of
 * them — reading what the current build writes (stamped v90 or later). A
 * v89 build doesn't know the `numbers` kind: its layout repair would drop
 * every Numbers widget. The refusal is the version stamp itself: a build
 * never reads data stamped above its own version, so it never writes a
 * newer file back as its own. The file's `__schemaVersion` and the browser
 * database's version are each compared with `CURRENT_DB_VERSION`.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 89,
}))

describe('a v89 build reading v90 data', () => {
  it('refuses a v90 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 90,
      layouts: [{
        id: 1, name: 'Daily', sortOrder: 0, createdAt: '2026-11-24T09:00:00.000Z', modifiedAt: '2026-11-24T09:00:00.000Z',
        grid: { columns: [{ id: 'c1', weight: 1000 }], rows: [{ id: 'r1', weight: 1000 }] },
        cells: [{ id: 'k', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [{ id: 'w', kind: 'numbers', config: { items: [] } }] }],
      }],
      settings: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v90')
    expect(result.error).toContain('up to v89')
  })

  it('refuses a browser database a v90 (or later) build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    const found = await checkTooNewDB()
    expect(found?.buildVersion).toBe(89)
    expect(found?.storedVersion).toBeGreaterThanOrEqual(90)
    await db.delete()
  })
})
