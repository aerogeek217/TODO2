import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { readLayoutDraft, readListDrafts } from '../../data/draft-storage'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'

/**
 * A build whose schema is v69 — the last one without the Last followed up
 * and Completed date types — reading what the current build writes
 * (stamped v70 or later). It must refuse it rather than misread it: it
 * rebuilds a predicate's dates from the types it knows, so a list's or a
 * lens's new date clause would vanish (showing more tasks than it should)
 * and the loss would be written back to the sync file or a backup.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 69,
}))

const dates = {
  lastFollowup: { match: 'range', start: null, end: { kind: 'offset', days: -14 }, includeNoDate: true },
  completed: { match: 'range', start: { kind: 'relative', token: 'start-of-week' }, end: null },
}
const columns = [{ id: 'A', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [{ id: 'l', kind: 'lens', config: { listDefinitionId: 4 } }] }] }]
const list = {
  id: 4, name: 'Done this week', sortOrder: 0, sort: 'manual', grouping: 'none', owner: { layoutId: 1 },
  membership: { kind: 'custom', predicate: { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates, markers: null, tags: null } },
}

describe('a v69 build reading v70 data', () => {
  it('refuses a v70 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 70, todos: [], listDefinitions: [list],
      settings: [
        { key: 'lenses', value: JSON.stringify([{ id: 'lens-a', name: 'Stale', predicate: { ...list.membership.predicate } }]) },
      ],
      layouts: [{ id: 1, name: 'Main', sortOrder: 0, columns, createdAt: '2026-11-02T09:00:00.000Z', modifiedAt: '2026-11-02T09:00:00.000Z' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v70')
    expect(result.error).toContain('up to v69')
  })

  it('refuses a browser database a v70 (or later) build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    const found = await checkTooNewDB()
    expect(found?.buildVersion).toBe(69)
    expect(found?.storedVersion).toBeGreaterThanOrEqual(70)
    await db.delete()
  })

  it.each([[69, true], [70, false]])('unsaved layout and list changes kept at v%i are read back: %s', (schemaVersion, kept) => {
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'new', name: 'N', columns, listNames: {}, schemaVersion }))
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ 4: { draft: list, base: list, schemaVersion } }))
    expect(readLayoutDraft() !== null).toBe(kept)
    expect(readListDrafts().size).toBe(kept ? 1 : 0)
  })
})
