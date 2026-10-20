import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { readLayoutDraft, readListDrafts } from '../../data/draft-storage'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'

/**
 * A build whose schema is v66 — the last one without layout order, hidden
 * lists, the filter-line switch, the Priority grouping and the new-task
 * follow-up setting — reading what the current build writes (stamped v67 or
 * later). It must refuse it rather than drop those parts (a hidden list would
 * show up in its list choosers, a Priority grouping read as none) and write
 * the loss back to the sync file or a backup.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 66,
}))

const columns = [{ id: 'A', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [{ id: 'l', kind: 'lens', config: { listDefinitionId: 4 } }] }] }]
const list = {
  id: 4, name: 'Mine', sortOrder: 0, sort: 'manual', grouping: 'priority', owner: { layoutId: 1 }, showFilterLine: false,
  membership: { kind: 'custom', predicate: { showCompleted: false, personIds: [2], statusIds: null, searchText: '', dates: {}, markers: null, tags: null } },
}

describe('a v66 build reading v67 data', () => {
  it('refuses a v67 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 67, todos: [], listDefinitions: [list],
      settings: [{ key: 'newTaskFollowup', value: 'false' }, { key: 'eisenhowerSource', value: 'list:4' }],
      layouts: [{ id: 1, name: 'Main', sortOrder: 0, columns, createdAt: '2026-10-19T09:00:00.000Z', modifiedAt: '2026-10-19T09:00:00.000Z' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v67')
    expect(result.error).toContain('up to v66')
  })

  it('refuses a browser database a v67 (or later) build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    const found = await checkTooNewDB()
    expect(found?.buildVersion).toBe(66)
    expect(found?.storedVersion).toBeGreaterThanOrEqual(67)
    await db.delete()
  })

  it.each([[66, true], [67, false]])('unsaved layout and list changes kept at v%i are read back: %s', (schemaVersion, kept) => {
    const v66List = { ...list, grouping: 'none', owner: undefined, showFilterLine: undefined }
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'new', name: 'N', columns, listNames: {}, schemaVersion }))
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ 4: { draft: v66List, base: v66List, schemaVersion } }))
    expect(readLayoutDraft() !== null).toBe(kept)
    expect(readListDrafts().size).toBe(kept ? 1 : 0)
  })
})
