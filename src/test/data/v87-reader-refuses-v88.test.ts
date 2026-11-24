import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'

/**
 * A build whose schema is v87 — the one with the List wall — reading what
 * the current build writes (stamped v88 or later). It must refuse it rather
 * than read it as its own: a v87 build's layout repair drops a List board's
 * `source`, so a List board of the layout's lists would come back as an empty
 * board of picked lists, and writing that back over a v88 sync file is the
 * downgrade the gate exists for. The file's `__schemaVersion` and the browser
 * database's version are each compared with `CURRENT_DB_VERSION`.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 87,
}))

describe('a v87 build reading v88 data', () => {
  it('refuses a v88 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 88,
      layouts: [{
        id: 1, name: 'Home', sortOrder: 0, createdAt: '2026-11-23T09:00:00.000Z', modifiedAt: '2026-11-23T09:00:00.000Z',
        grid: { columns: [{ id: 'c', weight: 1 }], rows: [{ id: 'r', weight: 1 }] },
        cells: [{ id: 'k', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [{ id: 'w', kind: 'shortcuts', config: { source: 'layout' } }] }],
      }],
      settings: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v88')
    expect(result.error).toContain('up to v87')
  })

  it('refuses a browser database a v88 (or later) build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    const found = await checkTooNewDB()
    expect(found?.buildVersion).toBe(87)
    expect(found?.storedVersion).toBeGreaterThanOrEqual(88)
    await db.delete()
  })
})
