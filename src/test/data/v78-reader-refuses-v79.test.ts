import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { readLayoutDraft, readListDrafts } from '../../data/draft-storage'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'

/**
 * A build whose schema is v78 — the one deployed before the final shapes —
 * reading what the current build writes (stamped v79 or later). It must
 * refuse it rather than read it as its own: it would read a Breakdown with
 * `columns` and no `badges` as before (fine), but v79 data has lost the rows
 * a v78 build still carries (the Eisenhower's), and a v78 build writing its
 * read back over a v79 sync file is exactly the downgrade the version gate
 * exists for. The gate is `CURRENT_DB_VERSION`: the file's
 * `__schemaVersion`, the browser database's version and a kept draft's
 * `schemaVersion` are each compared with it.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 78,
}))

/** A kept draft's body in the table shape (v78 on): the version gate is what's checked here. */
const TABLE = {
  grid: { columns: [{ id: 'A', weight: 1000 }], rows: [{ id: 'R', weight: 1000 }] },
  cells: [{ id: 'k', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [{ id: 'l', kind: 'lens', config: { listDefinitionId: 4 } }] }],
}
const list = {
  id: 4, name: 'Mine', sortOrder: 0, sort: 'manual', grouping: 'none', owner: { layoutId: 1 },
  membership: { kind: 'custom', predicate: { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null } },
}

describe('a v78 build reading v79 data', () => {
  it('refuses a v79 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 79,
      todos: [{ id: 1, uid: 'u1', title: 'Q4 budget', isCompleted: false, sortOrder: 0, createdAt: '2026-10-01T09:00:00.000Z', modifiedAt: '2026-11-02T09:00:00.000Z' }],
      settings: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v79')
    expect(result.error).toContain('up to v78')
  })

  it('refuses a browser database a v79 (or later) build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    const found = await checkTooNewDB()
    expect(found?.buildVersion).toBe(78)
    expect(found?.storedVersion).toBeGreaterThanOrEqual(79)
    await db.delete()
  })

  it.each([[78, true], [79, false]])('unsaved layout and list changes kept at v%i are read back: %s', (schemaVersion, kept) => {
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'new', name: 'N', ...TABLE, schemaVersion }))
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ 4: { draft: list, base: list, schemaVersion } }))
    expect(readLayoutDraft() !== null).toBe(kept)
    expect(readListDrafts().size).toBe(kept ? 1 : 0)
  })
})
