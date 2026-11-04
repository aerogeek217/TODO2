import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { readLayoutDraft, readListDrafts } from '../../data/draft-storage'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { db } from '../../data/database'
import { checkTooNewDB } from '../../services/migration-check'

/**
 * A build whose schema is v72 — the last one without a `subtasks` table —
 * reading what the current build writes (stamped v73 or later). It must
 * refuse it rather than misread it: it knows no `subtasks` table, so every
 * task's checklist would vanish on an import (or the sync file's load) and
 * the loss would be written back to the sync file or a backup.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 72,
}))

const columns = [{ id: 'A', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [{ id: 'l', kind: 'lens', config: { listDefinitionId: 4 } }] }] }]
const list = {
  id: 4, name: 'Mine', sortOrder: 0, sort: 'manual', grouping: 'none', owner: { layoutId: 1 },
  membership: { kind: 'custom', predicate: { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null } },
}

describe('a v72 build reading v73 data', () => {
  it('refuses a v73 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 73,
      todos: [{ id: 1, uid: 'u1', title: 'Q4 budget', isCompleted: false, sortOrder: 0, createdAt: '2026-10-01T09:00:00.000Z', modifiedAt: '2026-11-02T09:00:00.000Z' }],
      subtasks: [{ id: 1, todoId: 1, title: 'Collect the numbers', isCompleted: false, sortOrder: 0, createdAt: '2026-11-02T09:00:00.000Z' }],
      settings: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v73')
    expect(result.error).toContain('up to v72')
  })

  it('refuses a browser database a v73 (or later) build opened, before anything reads it', async () => {
    await db.open()
    db.close()
    const found = await checkTooNewDB()
    expect(found?.buildVersion).toBe(72)
    expect(found?.storedVersion).toBeGreaterThanOrEqual(73)
    await db.delete()
  })

  it.each([[72, true], [73, false]])('unsaved layout and list changes kept at v%i are read back: %s', (schemaVersion, kept) => {
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'new', name: 'N', columns, listNames: {}, schemaVersion }))
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ 4: { draft: list, base: list, schemaVersion } }))
    expect(readLayoutDraft() !== null).toBe(kept)
    expect(readListDrafts().size).toBe(kept ? 1 : 0)
  })
})
