import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { readLayoutDraft, readListDrafts } from '../../data/draft-storage'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'
import { rowOf } from '../helpers/legacy-layout-builders'

/**
 * A build whose schema is v70 — the last one without "is not" on a date
 * range — reading what the current build writes (stamped v71 or later). It
 * must refuse it rather than misread it: it rebuilds a range from the keys
 * it knows, so `not` would vanish and a list's or a lens's range would keep
 * the opposite tasks — and the change would be written back to the sync
 * file or a backup.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 70,
}))

const clauses = { personIds: null, statusIds: null, searchText: '', markers: null, tags: null }
const orGroups = [{
  ...clauses,
  dates: {
    lastFollowup: { match: 'range', start: { kind: 'offset', days: -7 }, end: { kind: 'relative', token: 'today' }, not: true },
    followup: { match: 'range', start: { kind: 'relative', token: 'today' }, end: { kind: 'offset', days: 14 }, not: true },
  },
}]
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
  id: 4, name: 'Follow-ups to chase', sortOrder: 0, sort: 'manual', grouping: 'none', owner: { layoutId: 1 },
  membership: { kind: 'custom', predicate: { showCompleted: false, ...clauses, dates: {}, orGroups } },
}

describe('a v70 build reading v71 data', () => {
  it('refuses a v71 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 71, todos: [], listDefinitions: [list],
      settings: [
        { key: 'lenses', value: JSON.stringify([{ id: 'lens-a', name: 'To chase', predicate: { ...list.membership.predicate } }]) },
      ],
      layouts: [{ id: 1, name: 'Main', sortOrder: 0, columns, createdAt: '2026-11-02T09:00:00.000Z', modifiedAt: '2026-11-02T09:00:00.000Z' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v71')
    expect(result.error).toContain('up to v70')
  })

  it('refuses a browser database a v71 (or later) build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    const found = await checkTooNewDB()
    expect(found?.buildVersion).toBe(70)
    expect(found?.storedVersion).toBeGreaterThanOrEqual(71)
    await db.delete()
  })

  it.each([[70, true], [71, false]])('unsaved layout and list changes kept at v%i are read back: %s', (schemaVersion, kept) => {
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'new', name: 'N', ...TABLE, listNames: {}, schemaVersion }))
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ 4: { draft: list, base: list, schemaVersion } }))
    expect(readLayoutDraft() !== null).toBe(kept)
    expect(readListDrafts().size).toBe(kept ? 1 : 0)
  })
})
