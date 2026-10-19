import { describe, it, expect, vi } from 'vitest'
import { prepareImport } from '../../data/import-pipeline'
import { readLayoutDraft, readListDrafts } from '../../data/draft-storage'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'

/**
 * A build whose schema is v64 — the last one without list "is not" switches,
 * Priority No markers, Eisenhower tabs on a list and custom Eisenhower
 * panes — reading what the
 * current build writes (stamped v65 or later). It must refuse it rather than
 * drop those fields: "is not Ann" read as "is Ann" would turn every such list
 * inside out, and a v64 build drops a Priority filter with a No marker.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 64,
}))

const negatedList = {
  id: 4, name: 'Not mine', sortOrder: 0, sort: 'manual', grouping: 'none',
  membership: {
    kind: 'custom',
    predicate: { showCompleted: false, personIds: [2], statusIds: null, searchText: '', dates: {}, markers: null, tags: null, negate: { personIds: true } },
  },
}
const notImportantList = {
  id: 5, name: 'Delegate', sortOrder: 1, sort: 'manual', grouping: 'none',
  membership: {
    kind: 'custom',
    predicate: { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: { urgent: true, important: false }, tags: null },
  },
}
const eisenhowerColumns = [{ id: 'A', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [{ id: 'e', kind: 'eisenhower', config: {
  listDefinitionId: 4,
  // Custom panes: a v64 build would drop them (and a pane's "is not" / No marker means the opposite to it).
  panes: { delegate: { name: 'Hand off', filter: { ...notImportantList.membership.predicate, statusIds: [3], negate: { statusIds: true } } } },
} }] }] }]

describe('a v64 build reading v65 data', () => {
  it('refuses a v65 file (export, backup, sync file) as too new', () => {
    const result = prepareImport({
      [SCHEMA_VERSION_KEY]: 65, todos: [], settings: [], listDefinitions: [negatedList, notImportantList],
      layouts: [{ id: 1, name: 'Main', columns: eisenhowerColumns, createdAt: '2026-10-19T09:00:00.000Z', modifiedAt: '2026-10-19T09:00:00.000Z' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('schema v65')
    expect(result.error).toContain('up to v64')
  })

  it.each([[64, true], [65, false]])('unsaved layout and list changes kept at v%i are read back: %s', (schemaVersion, kept) => {
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({
      kind: 'new', name: 'N', columns: eisenhowerColumns, listNames: { 4: 'Not mine' }, schemaVersion,
    }))
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({
      4: { draft: negatedList, base: negatedList, schemaVersion },
      5: { draft: notImportantList, base: notImportantList, schemaVersion },
    }))
    expect(readLayoutDraft() !== null).toBe(kept)
    expect(readListDrafts().size).toBe(kept ? 2 : 0)
  })
})
