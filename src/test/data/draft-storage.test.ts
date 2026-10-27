import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  clearUnsavedDrafts,
  readLayoutDraft,
  readListDrafts,
  unsavedDraftsKept,
  writeLayoutDraft,
  writeListDrafts,
} from '../../data/draft-storage'
import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION } from '../../data/database'
import { createTab, type LayoutBand, type LayoutColumn } from '../../models/workspace-layout'
import { emptyPredicate, type TodoPredicate } from '../../models'
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
    writeLayoutDraft({ kind: 'new', name: 'Untitled layout', body: { columns } })
    expect(readLayoutDraft()).toEqual({ kind: 'new', name: 'Untitled layout', body: { columns } })
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
    writeLayoutDraft({ kind: 'new', name: 'N', body: { columns: [], top, bottom } })
    expect(readLayoutDraft()).toEqual({ kind: 'new', name: 'N', body: { columns: [], top, bottom } })
  })

  it('a draft an earlier build kept with a lens pick reads as its body without it; none is written', () => {
    writeLayoutDraft(savedDraft)
    const stored = JSON.parse(localStorage.getItem('todo2-unsaved-layout')!)
    expect('lensId' in stored || 'baseLensId' in stored).toBe(false)
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ ...stored, lensId: 'lens-b', baseLensId: 'lens-a' }))
    expect(readLayoutDraft()).toEqual(savedDraft)
    // Even a pick that was no lens id: ignored, not a reason to drop the draft.
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ ...stored, lensId: 7 }))
    expect(readLayoutDraft()).toEqual(savedDraft)
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'new', name: 'N', columns, lensId: 'lens-b', schemaVersion: CURRENT_DB_VERSION }))
    expect(readLayoutDraft()).toEqual({ kind: 'new', name: 'N', body: { columns } })
  })

  it('a current draft whose Eisenhower tab holds a config key (it has none) is no draft', () => {
    const bad = [{ id: 'A', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [{ id: 'e', kind: 'eisenhower', config: { listDefinitionId: 3 } }] }] }]
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'saved', layoutId: 2, baseColumns: other, columns: bad, schemaVersion: CURRENT_DB_VERSION }))
    expect(readLayoutDraft()).toBeNull()
  })

  it('reads a band the layout repair would change as no layout draft', () => {
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'saved', layoutId: 2, baseColumns: other, columns, top: { id: 'T', height: 100, tabs: [] }, schemaVersion: CURRENT_DB_VERSION }))
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

    const v = CURRENT_DB_VERSION
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({
      4: { draft, base, schemaVersion: v },
      5: { draft: { ...draft, id: 5, sort: 'nope' }, base: { ...base, id: 5 }, schemaVersion: v },
      6: { draft, base, schemaVersion: v },
    }))
    expect([...readListDrafts().keys()]).toEqual([4])
    writeListDrafts(new Map())
    expect(localStorage.getItem('todo2-unsaved-lists')).toBeNull()
  })

  it('a list draft keeps its sort direction; one kept without the field stays valid; an unknown direction is not taken back', () => {
    const base = listDef({ sort: 'deadline' })
    const draft = listDef({ sort: 'deadline', sortDirection: 'desc' })
    writeListDrafts(new Map([[4, { draft, base }]]))
    expect(readListDrafts()).toEqual(new Map([[4, { draft, base }]]))

    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({
      4: { draft: listDef({ sort: 'name' }), base, schemaVersion: CURRENT_DB_VERSION },
      5: { draft: { ...draft, id: 5, sortDirection: 'up' }, base: { ...base, id: 5 }, schemaVersion: CURRENT_DB_VERSION },
    }))
    const back = readListDrafts()
    expect([...back.keys()]).toEqual([4])
    expect('sortDirection' in back.get(4)!.draft).toBe(false)
  })

  it('a list draft keeps its "is not" switches; one kept without them stays valid; an unknown switch is not taken back', () => {
    const base = listDef()
    const not = (negate: unknown) => ({ kind: 'custom' as const, predicate: { ...emptyPredicate(), statusIds: [2], negate } as TodoPredicate })
    const draft = listDef({ membership: not({ statusIds: true }) })
    writeListDrafts(new Map([[4, { draft, base }]]))
    expect(readListDrafts()).toEqual(new Map([[4, { draft, base }]]))

    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({
      4: { draft: listDef({ membership: { kind: 'custom', predicate: { ...emptyPredicate(), statusIds: [2] } } }), base, schemaVersion: CURRENT_DB_VERSION },
      5: { draft: { ...listDef({ membership: not({ statusIds: 'yes' }) }), id: 5 }, base: { ...base, id: 5 }, schemaVersion: CURRENT_DB_VERSION },
    }))
    const back = readListDrafts()
    expect([...back.keys()]).toEqual([4])
    const kept = back.get(4)!.draft.membership
    expect(kept.kind === 'custom' && 'negate' in kept.predicate).toBe(false)
  })

  it('a list draft keeps a Priority filter with No markers; one it cannot read is not taken back', () => {
    const base = listDef()
    const withMarkers = (markers: unknown) => ({ kind: 'custom' as const, predicate: { ...emptyPredicate(), markers } as TodoPredicate })
    const draft = listDef({ membership: withMarkers({ urgent: true, important: false }) })
    writeListDrafts(new Map([[4, { draft, base }]]))
    expect(readListDrafts()).toEqual(new Map([[4, { draft, base }]]))

    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({
      5: { draft: { ...listDef({ membership: withMarkers({ urgent: 'no' }) }), id: 5 }, base: { ...base, id: 5 }, schemaVersion: CURRENT_DB_VERSION },
    }))
    expect([...readListDrafts().keys()]).toEqual([])
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

  it('a draft another tab replaced or removed is no longer kept for this one', () => {
    writeLayoutDraft(savedDraft)
    writeListDrafts(new Map([[4, { draft: listDef({ name: 'B' }), base: listDef() }]]))
    expect(unsavedDraftsKept()).toBe(true)
    // Another tab (same storage) discards its layout changes.
    localStorage.removeItem('todo2-unsaved-layout')
    expect(unsavedDraftsKept()).toBe(false)
    writeLayoutDraft(savedDraft)
    expect(unsavedDraftsKept()).toBe(true)
    // … or keeps list drafts of its own over these.
    localStorage.setItem('todo2-unsaved-lists', '{}')
    expect(unsavedDraftsKept()).toBe(false)
  })

  it('a draft another tab keeps doesn’t matter to a tab with nothing of that kind kept', () => {
    writeLayoutDraft(null)
    writeListDrafts(new Map())
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'saved' }))
    expect(unsavedDraftsKept()).toBe(true)
  })

  it('storage that can’t be read reads as nothing kept', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
    expect(readLayoutDraft()).toBeNull()
    expect(readListDrafts().size).toBe(0)
  })

  it('writes carry the schema version', () => {
    writeLayoutDraft(savedDraft)
    writeListDrafts(new Map([[4, { draft: listDef({ sort: 'priority' }), base: listDef() }]]))
    expect(JSON.parse(localStorage.getItem('todo2-unsaved-layout')!).schemaVersion).toBe(CURRENT_DB_VERSION)
    expect(JSON.parse(localStorage.getItem('todo2-unsaved-lists')!)[4].schemaVersion).toBe(CURRENT_DB_VERSION)
  })

  it.each([
    ['a newer build', CURRENT_DB_VERSION + 1],
    ['below the floor', OLDEST_SUPPORTED_DB_VERSION - 1],
    ['without a version', undefined],
    ['a version that isn’t a number', 'v64'],
  ])('drops a record %s kept', (_what, schemaVersion) => {
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'saved', layoutId: 2, baseColumns: other, columns, schemaVersion }))
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ 4: { draft: listDef({ sort: 'priority' }), base: listDef(), schemaVersion } }))
    expect(readLayoutDraft()).toBeNull()
    expect(readListDrafts().size).toBe(0)
  })

})
