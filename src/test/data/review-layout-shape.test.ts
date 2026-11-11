import { describe, expect, it } from 'vitest'
import { rowFixes, sanitizeRow, validateRow } from '../../data/import-validation'
import { withoutLegacyReview } from '../../data/layout-shape'
import { createTab, type LayoutTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { layoutListRefs, repointLayoutLists } from '../../utils/workspace-layout-lists'
import { single } from '../helpers/layout-builders'

/**
 * Item 12 · a Review widget as stored (widget feedback 2A): no settings —
 * what it reviews is a temporary filter, never saved — and its view state
 * (lens switch, sort). What earlier builds saved — board BM's kind (`by`),
 * board BK's `pick`, where it stood (`currentId`, `skipped`) — passes the
 * import check whatever it holds and is never a repair: the config keys
 * aren't read, the place is dropped. Only a sort that doesn't read is a fix.
 */

const DATE = '2026-09-01T09:00:00.000Z'

function layoutRow(tab: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1, name: 'Review', sortOrder: 0, createdAt: DATE, modifiedAt: DATE,
    ...single({ id: 'k', tabs: [tab as unknown as LayoutTab] }),
  }
}

const tabOf = (row: Record<string, unknown>) => (sanitizeRow('layouts', row) as WorkspaceLayout).cells[0]?.tabs[0]

describe('a Review widget’s tab', () => {
  it('new: no settings', () => {
    expect(createTab('review', 'r')).toEqual({ id: 'r', kind: 'review', config: {} })
  })

  it('its view state passes as it is', () => {
    const tab = { id: 'r', kind: 'review', config: {}, viewState: { ignoreLens: true, sort: 'next' } }
    const row = layoutRow(tab)
    expect(validateRow('layouts', row)).toBe(true)
    expect(rowFixes('layouts', row)).toEqual([])
    expect(tabOf(row)).toEqual(tab)
  })

  it('a kind or a pick an earlier build saved passes the check whatever it holds — never a repair', () => {
    const configs = [
      { by: 'person' }, { by: 'list' }, { by: 'project' }, { by: 3 }, { by: null },
      { pick: { kind: 'tag', id: 3 } }, { pick: 'Aisha' }, { by: 'tag', pick: { kind: 'person', id: 0 } },
    ]
    for (const config of configs) {
      const row = layoutRow({ id: 'r', kind: 'review', config, viewState: { sort: 'due' } })
      expect(validateRow('layouts', row)).toBe(true)
      expect(rowFixes('layouts', row)).toEqual([])
    }
  })

  it('a saved place passes whatever it holds (it is dropped as the layout opens)', () => {
    for (const view of [{ currentId: -1 }, { skipped: { day: 'today', ids: [1] } }, { skipped: 'all' }]) {
      const row = layoutRow({ id: 'r', kind: 'review', config: { by: 'person' }, viewState: { sort: 'due', ...view } })
      expect(validateRow('layouts', row)).toBe(true)
      expect(rowFixes('layouts', row)).toEqual([])
    }
  })

  it('a sort that doesn’t read is dropped alone (the repair: no settings either)', () => {
    const row = layoutRow({ id: 'r', kind: 'review', config: { by: 'tag' }, viewState: { sort: 'random', ignoreLens: true } })
    expect(validateRow('layouts', row)).toBe('cells[0].tabs[0].viewState.sort')
    expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
    expect(tabOf(row)).toEqual({ id: 'r', kind: 'review', config: {}, viewState: { ignoreLens: true } })
  })

  it('a Review widget names no list, not even through a pick an earlier build saved', () => {
    const tab: LayoutTab = { id: 'r', kind: 'review', config: {} }
    const body = single({ id: 'k', tabs: [tab] })
    expect([...layoutListRefs(body)]).toEqual([])
    expect(repointLayoutLists(body, new Map([[5, 9]]))).toBe(body)
    const legacy = single({ id: 'k', tabs: [{ id: 'r', kind: 'review', config: { by: 'list', pick: { kind: 'list', id: 5 } } } as unknown as LayoutTab] })
    expect([...layoutListRefs(legacy)]).toEqual([])
  })
})

describe('withoutLegacyReview (a stored row as the app opens it)', () => {
  it('the kind and a saved pick go, so does the saved place; other tabs and keys stay as they are', () => {
    const notes = { id: 'n', kind: 'notes', config: {} }
    const row = {
      id: 1, name: 'Review', cells: [
        { id: 'a', tabs: [notes, { id: 'r', kind: 'review', config: { pick: { kind: 'status', id: 2 } }, viewState: { sort: 'due', currentId: 4, skipped: { day: '2026-11-09', ids: [1] } } }] },
        { id: 'b', tabs: [{ id: 'q', kind: 'review', config: { by: 'tag' }, viewState: { currentId: 4 } }] },
        { id: 'c', tabs: [{ id: 's', kind: 'review', config: { by: 'list' }, viewState: { ignoreLens: true } }] },
      ],
    }
    const next = withoutLegacyReview(row)
    expect(next).toEqual({
      id: 1, name: 'Review', cells: [
        { id: 'a', tabs: [notes, { id: 'r', kind: 'review', config: {}, viewState: { sort: 'due' } }] },
        { id: 'b', tabs: [{ id: 'q', kind: 'review', config: {} }] },
        { id: 'c', tabs: [{ id: 's', kind: 'review', config: {}, viewState: { ignoreLens: true } }] },
      ],
    })
    expect(next.cells[0]?.tabs[0]).toBe(notes)
    // The stored row itself is untouched.
    expect(row.cells[0]?.tabs[1]?.config).toEqual({ pick: { kind: 'status', id: 2 } })
  })

  it('the same object when no Review widget holds anything from before', () => {
    const row = { id: 1, cells: [{ id: 'a', tabs: [{ id: 'r', kind: 'review', config: {}, viewState: { sort: 'due', ignoreLens: true } }, { id: 'n', kind: 'notes', config: {} }] }] }
    expect(withoutLegacyReview(row)).toBe(row)
    const odd = { id: 2, cells: 'none' }
    expect(withoutLegacyReview(odd)).toBe(odd)
  })
})
