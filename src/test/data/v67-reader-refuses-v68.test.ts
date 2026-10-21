import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { readLayoutDraft, readListDrafts } from '../../data/draft-storage'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'

/**
 * A build whose schema is v67 — the last one with saved lists (lists no
 * layout owns), the check-in scope and without the new-list defaults and
 * the purge prompt's interval — reading what the current build writes
 * (stamped v68 or later). It must refuse it rather than misread it (an
 * empty Settings › Lists, an unknown check-in setting dropped) and write the
 * loss back to the sync file or a backup.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 67,
}))

const columns = [{ id: 'A', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [{ id: 'l', kind: 'lens', config: { listDefinitionId: 4 } }] }] }]
const list = {
  id: 4, name: 'Mine', sortOrder: 0, sort: 'manual', grouping: 'none', owner: { layoutId: 1 },
  membership: { kind: 'custom', predicate: { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null } },
}

describe('a v67 build reading v68 data', () => {
  it('refuses a v68 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 68, todos: [], listDefinitions: [list],
      settings: [
        { key: 'checkinTaskFilter', value: '{"showCompleted":false,"personIds":null,"statusIds":null,"searchText":"","dates":{},"markers":"hot","tags":null}' },
        { key: 'newListSort', value: 'deadline' },
        { key: 'purgePromptIntervalDays', value: '14' },
      ],
      layouts: [{ id: 1, name: 'Main', sortOrder: 0, columns, createdAt: '2026-10-20T09:00:00.000Z', modifiedAt: '2026-10-20T09:00:00.000Z' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v68')
    expect(result.error).toContain('up to v67')
  })

  it('refuses a browser database a v68 (or later) build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    const found = await checkTooNewDB()
    expect(found?.buildVersion).toBe(67)
    expect(found?.storedVersion).toBeGreaterThanOrEqual(68)
    await db.delete()
  })

  it.each([[67, true], [68, false]])('unsaved layout and list changes kept at v%i are read back: %s', (schemaVersion, kept) => {
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'new', name: 'N', columns, listNames: {}, schemaVersion }))
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ 4: { draft: list, base: list, schemaVersion } }))
    expect(readLayoutDraft() !== null).toBe(kept)
    expect(readListDrafts().size).toBe(kept ? 1 : 0)
  })
})
