import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  clearListDrafts,
  clearUnsavedDrafts,
  readLayoutDraft,
  readListDrafts,
  writeLayoutDraft,
  writeListDrafts,
} from '../../data/draft-storage'
import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION } from '../../data/database'
import { createTab } from '../../models/workspace-layout'
import { emptyPredicate, type TodoPredicate } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'
import { cell, emptyBody, grid, picture, single } from '../helpers/layout-builders'

const body = single(cell('k', [createTab('notes', 'n')], { activeTabId: 'n' }), { colIds: ['A'], rowIds: ['RA'] })
const other = single(cell('k2', [createTab('calendar', 'c')], { activeTabId: 'c' }), { colIds: ['B'], rowIds: ['RB'] })
const savedDraft = { kind: 'saved', layoutId: 2, base: other, body } as const
/** A kept draft as stored, flat: the body's grid and cells, the base's prefixed. */
const kept = (extra: Record<string, unknown>) => JSON.stringify({ kind: 'saved', layoutId: 2, baseGrid: other.grid, baseCells: other.cells, ...body, ...extra })

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
    writeLayoutDraft({ kind: 'new', name: 'Untitled layout', body })
    expect(readLayoutDraft()).toEqual({ kind: 'new', name: 'Untitled layout', body })
    writeLayoutDraft(null)
    expect(localStorage.getItem('todo2-unsaved-layout')).toBeNull()
    expect(readLayoutDraft()).toBeNull()
  })

  it('keeps the tables of a layout draft and of its base: fixed and collapsed rows, spanning cells', () => {
    const t = cell('t', [createTab('trend', 't1')], { activeTabId: 't1' })
    const k = cell('k', [createTab('notes', 'n')])
    const m = cell('m', [createTab('notes', 'm1')])
    const tall = grid([[t, t], [k, m]], { rows: [{ px: 200 }, { weight: 1000, collapsed: true }] })
    const record = { kind: 'saved', layoutId: 2, base: other, body: tall } as const
    writeLayoutDraft(record)
    const stored = JSON.parse(localStorage.getItem('todo2-unsaved-layout')!)
    expect(stored.grid).toEqual(tall.grid)
    expect(stored.baseCells).toEqual(other.cells)
    expect(readLayoutDraft()).toEqual(record)
    writeLayoutDraft({ kind: 'new', name: 'N', body: emptyBody() })
    expect(readLayoutDraft()).toEqual({ kind: 'new', name: 'N', body: emptyBody() })
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
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'new', name: 'N', ...body, lensId: 'lens-b', schemaVersion: CURRENT_DB_VERSION }))
    expect(readLayoutDraft()).toEqual({ kind: 'new', name: 'N', body })
  })

  it('a current draft whose Eisenhower tab holds a config key (it has none) is no draft', () => {
    const bad = single(cell('k', [{ id: 'e', kind: 'eisenhower', config: { listDefinitionId: 3 } as never }]))
    localStorage.setItem('todo2-unsaved-layout', kept({ ...bad, schemaVersion: CURRENT_DB_VERSION }))
    expect(readLayoutDraft()).toBeNull()
  })

  it('reads a tiling the layout repair would change as no layout draft', () => {
    localStorage.setItem('todo2-unsaved-layout', kept({ grid: { columns: [{ id: 'A', weight: 1 }, { id: 'A2', weight: 1 }], rows: [{ id: 'RA', weight: 1 }] }, schemaVersion: CURRENT_DB_VERSION }))
    expect(readLayoutDraft()).toBeNull()
  })

  it.each([
    ['not JSON', '{oops'],
    ['an unknown kind', JSON.stringify({ kind: 'other', ...body, schemaVersion: CURRENT_DB_VERSION })],
    ['a table the layout repair would change', kept({ ...single(cell('k', [{ id: 'x', kind: 'nope' as never, config: {} }])), schemaVersion: CURRENT_DB_VERSION })],
    ['a bad layout id', kept({ layoutId: 0, schemaVersion: CURRENT_DB_VERSION })],
    ['a new layout without a name', JSON.stringify({ kind: 'new', name: ' ', ...body, listNames: {}, schemaVersion: CURRENT_DB_VERSION })],
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

  it('a list draft keeps a Priority filter with an "is not"; one it cannot read is not taken back', () => {
    const base = listDef()
    const withMarkers = (markers: unknown) => ({ kind: 'custom' as const, predicate: { ...emptyPredicate(), markers } as TodoPredicate })
    const draft = listDef({ membership: withMarkers([{ values: ['urgent'] }, { values: ['important'], not: true }]) })
    writeListDrafts(new Map([[4, { draft, base }]]))
    expect(readListDrafts()).toEqual(new Map([[4, { draft, base }]]))

    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({
      5: { draft: { ...listDef({ membership: withMarkers([{ values: ['warm'] }]) }), id: 5 }, base: { ...base, id: 5 }, schemaVersion: CURRENT_DB_VERSION },
    }))
    expect([...readListDrafts().keys()]).toEqual([])
  })

  it('a list draft an older build kept reads in the current Priority shape', () => {
    const base = listDef()
    const old = { ...listDef(), membership: { kind: 'custom', predicate: { ...emptyPredicate(), markers: { urgent: true, important: false } } } }
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ 4: { draft: old, base, schemaVersion: 73 } }))
    const read = readListDrafts().get(4)?.draft.membership
    expect(read?.kind === 'custom' ? read.predicate.markers : undefined).toEqual([{ values: ['urgent'] }, { values: ['important'], not: true }])
  })

  it('a layout draft an older build kept loses its dashboards’ Hot tile and section, then its dashboards turn into widgets, the body and the base', () => {
    const withHot = (id: string) => ({ id, kind: 'dashboard', config: { tiles: ['open', 'hot'], listTiles: [], sections: [{ id: 'hot' }, { id: 'status' }] } })
    // Written in the v73 shape (a column's cells, a band's tabs): read back in today's (rows, a band's cells — v76; widgets — v77).
    const v73Cols = (tab: unknown) => [{ id: 'A', weight: 1, cells: [{ id: 'k', weight: 1, activeTabId: 'd', tabs: [tab] }] }]
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({
      kind: 'saved', layoutId: 2, columns: v73Cols(withHot('d')), baseColumns: v73Cols(withHot('d')), top: { id: 'T', height: 100, tabs: [withHot('t')] }, schemaVersion: 73,
    }))
    const draft = readLayoutDraft()
    expect(draft?.kind).toBe('saved')
    if (draft?.kind !== 'saved') return
    // v76 rows, v77 widgets (a Number over Status, the Hot parts gone), v78 a table — the band a fixed row across the top — and Status a Breakdown.
    expect(picture(draft.base)).toEqual(['d-c1', 'd-c2'])
    expect(picture(draft.body)).toEqual(['t-c1 t-c2', 'd-c1 d-c1', 'd-c2 d-c2'])
    expect(draft.body.cells.map((c) => c.tabs[0]?.kind)).toEqual(['number', 'breakdown', 'number', 'breakdown'])
  })

  it('clearUnsavedDrafts forgets both kinds', () => {
    writeLayoutDraft(savedDraft)
    writeListDrafts(new Map([[4, { draft: listDef({ name: 'B' }), base: listDef() }]]))
    clearUnsavedDrafts()
    expect(readLayoutDraft()).toBeNull()
    expect(readListDrafts().size).toBe(0)
  })

  it('clearListDrafts forgets the list drafts only', () => {
    writeLayoutDraft(savedDraft)
    writeListDrafts(new Map([[4, { draft: listDef({ name: 'B' }), base: listDef() }]]))
    clearListDrafts()
    expect(readLayoutDraft()).not.toBeNull()
    expect(readListDrafts().size).toBe(0)
  })

  it('storage that refuses a write is logged, and never throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => writeLayoutDraft(savedDraft)).not.toThrow()
    expect(warn).toHaveBeenCalled()
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
    localStorage.setItem('todo2-unsaved-layout', kept({ schemaVersion }))
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ 4: { draft: listDef({ sort: 'priority' }), base: listDef(), schemaVersion } }))
    expect(readLayoutDraft()).toBeNull()
    expect(readListDrafts().size).toBe(0)
  })

})
