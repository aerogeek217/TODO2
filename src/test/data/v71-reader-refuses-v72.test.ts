import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { readLayoutDraft, readListDrafts } from '../../data/draft-storage'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'
import { rowOf } from '../helpers/layout-builders'

/**
 * A build whose schema is v71 — the last one with a task's one-line Progress
 * field and no `statusUpdates` table — reading what the current build writes
 * (stamped v72 or later). It must refuse it rather than misread it: it knows
 * no `statusUpdates` table, so every task's status updates would vanish on
 * an import (or the sync file's load) and the loss would be written back to
 * the sync file or a backup.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 71,
}))

const columns = [{ id: 'A', weight: 1, rows: [rowOf({ id: 'k', weight: 1, tabs: [{ id: 'l', kind: 'lens', config: { listDefinitionId: 4 } }] })] }]
const list = {
  id: 4, name: 'Mine', sortOrder: 0, sort: 'manual', grouping: 'none', owner: { layoutId: 1 },
  membership: { kind: 'custom', predicate: { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null } },
}

describe('a v71 build reading v72 data', () => {
  it('refuses a v72 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 72,
      todos: [{ id: 1, uid: 'u1', title: 'Q4 budget', isCompleted: false, sortOrder: 0, createdAt: '2026-10-01T09:00:00.000Z', modifiedAt: '2026-11-02T09:00:00.000Z' }],
      statusUpdates: [{ id: 1, todoId: 1, date: '2026-11-02T00:00:00.000Z', text: 'Waiting on numbers', createdAt: '2026-11-02T09:00:00.000Z' }],
      settings: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v72')
    expect(result.error).toContain('up to v71')
  })

  it('refuses a browser database a v72 (or later) build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    const found = await checkTooNewDB()
    expect(found?.buildVersion).toBe(71)
    expect(found?.storedVersion).toBeGreaterThanOrEqual(72)
    await db.delete()
  })

  it.each([[71, true], [72, false]])('unsaved layout and list changes kept at v%i are read back: %s', (schemaVersion, kept) => {
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'new', name: 'N', columns, listNames: {}, schemaVersion }))
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ 4: { draft: list, base: list, schemaVersion } }))
    expect(readLayoutDraft() !== null).toBe(kept)
    expect(readListDrafts().size).toBe(kept ? 1 : 0)
  })
})
