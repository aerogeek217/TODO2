import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { readLayoutDraft, readListDrafts } from '../../data/draft-storage'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'
import { rowOf } from '../helpers/legacy-layout-builders'

/**
 * A build whose schema is v68 — the last one without or groups in stored
 * filters — reading what the current build writes (stamped v69 or later).
 * It must refuse it rather than misread it: it rebuilds a predicate from
 * the keys it knows, so a list's or groups would vanish (the list showing
 * more tasks than it should) and the loss would be written back to the sync
 * file or a backup.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 68,
}))

const group = { personIds: null, statusIds: null, searchText: '', dates: {}, markers: [{ values: ['focus'] }], tags: [0] }
const columns = [{ id: 'A', weight: 1, rows: [rowOf({ id: 'k', weight: 1, tabs: [{ id: 'l', kind: 'lens', config: { listDefinitionId: 4 } }] })] }]
/**
 * A kept draft's body in the shape this build reads (a table, v78): the
 * version gate is what's checked here — an older build read its own shape.
 */
const TABLE = {
  grid: { columns: [{ id: 'A', weight: 1000 }], rows: [{ id: 'R', weight: 1000 }] },
  cells: [{ id: 'k', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [{ id: 'l', kind: 'lens', config: { listDefinitionId: 4 } }] }],
}
const list = {
  id: 4, name: 'Hot or untagged', sortOrder: 0, sort: 'manual', grouping: 'none', owner: { layoutId: 1 },
  membership: { kind: 'custom', predicate: { showCompleted: false, personIds: null, statusIds: [1], searchText: '', dates: {}, markers: null, tags: null, orGroups: [group] } },
}

describe('a v68 build reading v69 data', () => {
  it('refuses a v69 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 69, todos: [], listDefinitions: [list],
      settings: [
        { key: 'lenses', value: JSON.stringify([{ id: 'lens-a', name: 'Triage', predicate: { ...list.membership.predicate } }]) },
      ],
      layouts: [{ id: 1, name: 'Main', sortOrder: 0, columns, createdAt: '2026-10-26T09:00:00.000Z', modifiedAt: '2026-10-26T09:00:00.000Z' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v69')
    expect(result.error).toContain('up to v68')
  })

  it('refuses a browser database a v69 (or later) build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    const found = await checkTooNewDB()
    expect(found?.buildVersion).toBe(68)
    expect(found?.storedVersion).toBeGreaterThanOrEqual(69)
    await db.delete()
  })

  it.each([[68, true], [69, false]])('unsaved layout and list changes kept at v%i are read back: %s', (schemaVersion, kept) => {
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'new', name: 'N', ...TABLE, listNames: {}, schemaVersion }))
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ 4: { draft: list, base: list, schemaVersion } }))
    expect(readLayoutDraft() !== null).toBe(kept)
    expect(readListDrafts().size).toBe(kept ? 1 : 0)
  })
})
