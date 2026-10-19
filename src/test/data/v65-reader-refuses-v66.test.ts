import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { readLayoutDraft, readListDrafts } from '../../data/draft-storage'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'

/**
 * A build whose schema is v65 — the last one that kept the Eisenhower's
 * panes and list in each tab — reading what the current build writes
 * (stamped v66 or later): the panes and source as the settings
 * `eisenhowerPanes` / `eisenhowerSource`. It must refuse it rather than drop
 * those settings as unknown keys (and write the loss back to the sync file
 * or a backup).
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 65,
}))

const panes = { delegate: { name: 'Hand off', filter: { showCompleted: false, personIds: null, statusIds: [3], searchText: '', dates: {}, markers: { urgent: true, important: false }, negate: { statusIds: true } } } }
const columns = [{ id: 'A', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [{ id: 'e', kind: 'eisenhower', config: {} }] }] }]
const list = {
  id: 4, name: 'Mine', sortOrder: 0, sort: 'manual', grouping: 'none',
  membership: { kind: 'custom', predicate: { showCompleted: false, personIds: [2], statusIds: null, searchText: '', dates: {}, markers: null, tags: null } },
}

describe('a v65 build reading v66 data', () => {
  it('refuses a v66 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 66, todos: [], listDefinitions: [list],
      settings: [{ key: 'eisenhowerPanes', value: JSON.stringify(panes) }, { key: 'eisenhowerSource', value: 'list:4' }],
      layouts: [{ id: 1, name: 'Main', columns, createdAt: '2026-10-19T09:00:00.000Z', modifiedAt: '2026-10-19T09:00:00.000Z' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v66')
    expect(result.error).toContain('up to v65')
  })

  it('refuses a browser database a v66 build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    expect(await checkTooNewDB()).toEqual({ storedVersion: 66, buildVersion: 65 })
    await db.delete()
  })

  it.each([[65, true], [66, false]])('unsaved layout and list changes kept at v%i are read back: %s', (schemaVersion, kept) => {
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'new', name: 'N', columns, listNames: {}, schemaVersion }))
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ 4: { draft: list, base: list, schemaVersion } }))
    expect(readLayoutDraft() !== null).toBe(kept)
    expect(readListDrafts().size).toBe(kept ? 1 : 0)
  })
})
