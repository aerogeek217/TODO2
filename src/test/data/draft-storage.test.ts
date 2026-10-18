import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  clearUnsavedDrafts,
  readLayoutDraft,
  readListDrafts,
  unsavedDraftsKept,
  writeLayoutDraft,
  writeListDrafts,
} from '../../data/draft-storage'
import { CURRENT_DB_VERSION } from '../../data/database'
import { createTab, type LayoutBand, type LayoutColumn } from '../../models/workspace-layout'
import { emptyPredicate } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'

const columns: LayoutColumn[] = [{ id: 'A', weight: 1, cells: [{ id: 'k', weight: 1, activeTabId: 'n', tabs: [createTab('notes', 'n')] }] }]
const other: LayoutColumn[] = [{ id: 'B', weight: 1, cells: [{ id: 'k2', weight: 1, activeTabId: 'c', tabs: [createTab('calendar', 'c')] }] }]
const savedDraft = { kind: 'saved', layoutId: 2, base: { columns: other }, body: { columns } } as const

function listDef(over: Partial<PersistedListDefinition> = {}): PersistedListDefinition {
  return {
    id: 4, name: 'Waiting', sortOrder: 0, sort: 'manual', grouping: 'none',
    membership: { kind: 'custom', predicate: emptyPredicate() },
    ...over,
  }
}

// The storage stubs below must not outlive their test: in the shared project
// spies are only restored at file boundaries, and a `getItem` that still
// throws makes every later read in this file come back empty.
afterEach(() => { vi.restoreAllMocks() })

describe('draft storage', () => {
  it('keeps a layout draft for the next page load, outside the database', () => {
    writeLayoutDraft(savedDraft)
    expect(localStorage.getItem('todo2-unsaved-layout')).not.toBeNull()
    expect(readLayoutDraft()).toEqual(savedDraft)
    writeLayoutDraft({ kind: 'new', name: 'Untitled layout', body: { columns }, listNames: { 3: 'Inbox' } })
    expect(readLayoutDraft()).toEqual({ kind: 'new', name: 'Untitled layout', body: { columns }, listNames: { 3: 'Inbox' } })
    writeLayoutDraft(null)
    expect(localStorage.getItem('todo2-unsaved-layout')).toBeNull()
    expect(readLayoutDraft()).toBeNull()
  })

  it('keeps the bands of a layout draft and of its base', () => {
    const top: LayoutBand = { id: 'T', height: 200, activeTabId: 't', tabs: [createTab('dashboard', 't')] }
    const bottom: LayoutBand = { id: 'B2', height: 90, collapsed: true, tabs: [createTab('notes', 'b')] }
    const record = { kind: 'saved', layoutId: 2, base: { columns: other, bottom }, body: { columns, top } } as const
    writeLayoutDraft(record)
    const stored = JSON.parse(localStorage.getItem('todo2-unsaved-layout')!)
    expect(stored.top).toEqual(top)
    expect(stored.baseBottom).toEqual(bottom)
    expect(readLayoutDraft()).toEqual(record)
    writeLayoutDraft({ kind: 'new', name: 'N', body: { columns: [], top, bottom }, listNames: {} })
    expect(readLayoutDraft()).toEqual({ kind: 'new', name: 'N', body: { columns: [], top, bottom }, listNames: {} })
  })

  it('reads a band the layout repair would change as no layout draft', () => {
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'saved', layoutId: 2, baseColumns: other, columns, top: { id: 'T', height: 100, tabs: [] } }))
    expect(readLayoutDraft()).toBeNull()
  })

  it.each([
    ['not JSON', '{oops'],
    ['an unknown kind', JSON.stringify({ kind: 'other', columns })],
    ['columns the layout repair would change', JSON.stringify({ kind: 'saved', layoutId: 2, baseColumns: columns, columns: [{ id: 'A', weight: 1, cells: [{ id: 'k', tabs: [{ id: 'x', kind: 'nope' }] }] }] })],
    ['a bad layout id', JSON.stringify({ kind: 'saved', layoutId: 0, baseColumns: columns, columns })],
    ['a new layout without a name', JSON.stringify({ kind: 'new', name: ' ', columns, listNames: {} })],
  ])('reads %s as no layout draft', (_what, raw) => {
    localStorage.setItem('todo2-unsaved-layout', raw)
    expect(readLayoutDraft()).toBeNull()
  })

  it('keeps list drafts by id with the saved list they were made against; unreadable entries are left out', () => {
    const base = listDef()
    const draft = listDef({ sort: 'priority' })
    writeListDrafts(new Map([[4, { draft, base }]]))
    expect(readListDrafts()).toEqual(new Map([[4, { draft, base }]]))

    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({
      4: { draft, base },
      5: { draft: { ...draft, id: 5, sort: 'nope' }, base: { ...base, id: 5 } },
      6: { draft, base },
    }))
    expect([...readListDrafts().keys()]).toEqual([4])
    writeListDrafts(new Map())
    expect(localStorage.getItem('todo2-unsaved-lists')).toBeNull()
  })

  it('clearUnsavedDrafts forgets both kinds', () => {
    writeLayoutDraft(savedDraft)
    writeListDrafts(new Map([[4, { draft: listDef({ name: 'B' }), base: listDef() }]]))
    clearUnsavedDrafts()
    expect(readLayoutDraft()).toBeNull()
    expect(readListDrafts().size).toBe(0)
  })

  it('storage that refuses a write is reported (nothing is kept), and never throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => writeLayoutDraft(savedDraft)).not.toThrow()
    expect(unsavedDraftsKept()).toBe(false)
    spy.mockRestore()
    writeLayoutDraft(savedDraft)
    expect(unsavedDraftsKept()).toBe(true)
  })

  it('storage that can’t be read reads as nothing kept', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
    expect(readLayoutDraft()).toBeNull()
    expect(readListDrafts().size).toBe(0)
  })

  it('writes carry the schema version; a record without one is read as the first kept build’s (v63)', () => {
    writeLayoutDraft(savedDraft)
    writeListDrafts(new Map([[4, { draft: listDef({ sort: 'priority' }), base: listDef() }]]))
    expect(JSON.parse(localStorage.getItem('todo2-unsaved-layout')!).schemaVersion).toBe(CURRENT_DB_VERSION)
    expect(JSON.parse(localStorage.getItem('todo2-unsaved-lists')!)[4].schemaVersion).toBe(CURRENT_DB_VERSION)
    // The layout record of the build before: no version, columns of the same shape.
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'saved', layoutId: 2, baseColumns: other, columns }))
    expect(readLayoutDraft()).toEqual(savedDraft)
  })

  it('a list draft the build before kept is read in the current shape (old date fields → dates; caps dropped)', () => {
    const old = {
      showCompleted: false, personIds: null, statusIds: null, searchText: '', dateField: 'followup',
      dateRangeStart: null, dateRangeEnd: { kind: 'offset', days: 7 }, dateRangeIncludeNoDate: false, hasDeadline: true,
    }
    const base = { ...listDef(), maxTasks: 5, limitMode: 'scroll', membership: { kind: 'custom', predicate: { ...old, dateRangeEnd: null } } }
    const draft = { ...base, membership: { kind: 'custom', predicate: old } }
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ 4: { draft, base } }))
    const read = readListDrafts().get(4)!
    expect(read.base).toEqual(listDef({ membership: { kind: 'custom', predicate: { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: { deadline: { match: 'set' } } } } }))
    expect(read.draft.membership.predicate.dates).toEqual({ deadline: { match: 'set' }, followup: { match: 'range', start: null, end: { kind: 'offset', days: 7 } } })
  })

  it.each([
    ['a newer build', CURRENT_DB_VERSION + 1],
    ['a version before kept drafts existed', 62],
    ['a version that isn’t a number', 'v64'],
  ])('drops a record %s kept', (_what, schemaVersion) => {
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'saved', layoutId: 2, baseColumns: other, columns, schemaVersion }))
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ 4: { draft: listDef({ sort: 'priority' }), base: listDef(), schemaVersion } }))
    expect(readLayoutDraft()).toBeNull()
    expect(readListDrafts().size).toBe(0)
  })

})
