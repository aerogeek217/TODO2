import { describe, expect, it } from 'vitest'
import { rowFixes, sanitizeRow, validateRow } from '../../data/import-validation'
import { withoutLegacyReview } from '../../data/layout-shape'
import { reviewBy } from '../../models/review'
import { createTab, type LayoutTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { layoutListRefs, repointLayoutLists } from '../../utils/workspace-layout-lists'
import { single } from '../helpers/layout-builders'

/**
 * Item 12 · a Review widget as stored (board BM): what it reviews by
 * (layout config `by`) and its view state (lens switch, sort) pass the
 * import check as they are. What an earlier build saved — one `pick`, where
 * it stood (`currentId`, `skipped`) — passes too and is read as the pick's
 * kind, the rest dropped, without a repair; anything else its read would
 * reset is a fix.
 */

const DATE = '2026-09-01T09:00:00.000Z'

function layoutRow(tab: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1, name: 'Review', sortOrder: 0, createdAt: DATE, modifiedAt: DATE,
    ...single({ id: 'k', tabs: [tab as unknown as LayoutTab] }),
  }
}

const tabOf = (row: Record<string, unknown>) => (sanitizeRow('layouts', row) as WorkspaceLayout).cells[0]?.tabs[0]

describe('reviewBy', () => {
  it('reads the kind; a saved pick as its kind; neither as Person', () => {
    expect(reviewBy({ by: 'status' })).toBe('status')
    expect(reviewBy({ pick: { kind: 'tag', id: 3 } })).toBe('tag')
    expect(reviewBy({ by: 'list', pick: { kind: 'tag', id: 3 } })).toBe('list')
    expect(reviewBy({})).toBe('person')
    expect(reviewBy({ by: 'project' })).toBe('person')
    expect(reviewBy({ pick: { kind: 'tag', id: 0 } })).toBe('person')
  })
})

describe('a Review widget’s tab', () => {
  it('new: by Person', () => {
    expect(createTab('review', 'r')).toEqual({ id: 'r', kind: 'review', config: { by: 'person' } })
  })

  it('its kind and view state pass as they are', () => {
    const tab = { id: 'r', kind: 'review', config: { by: 'tag' }, viewState: { ignoreLens: true, sort: 'next' } }
    const row = layoutRow(tab)
    expect(validateRow('layouts', row)).toBe(true)
    expect(rowFixes('layouts', row)).toEqual([])
    expect(tabOf(row)).toEqual(tab)
  })

  it('every kind reads', () => {
    for (const by of ['person', 'tag', 'status', 'list']) {
      const row = layoutRow({ id: 'r', kind: 'review', config: { by } })
      expect(validateRow('layouts', row)).toBe(true)
      expect(tabOf(row)).toEqual({ id: 'r', kind: 'review', config: { by } })
    }
  })

  it('what an earlier build saved — one pick, where it stood — passes the check and is no repair: the pick’s kind, the rest dropped', () => {
    for (const kind of ['person', 'tag', 'status', 'list']) {
      const row = layoutRow({
        id: 'r', kind: 'review',
        config: { pick: { kind, id: 3 } },
        viewState: { ignoreLens: true, sort: 'next', currentId: 12, skipped: { day: '2026-11-09', ids: [4, 7] } },
      })
      expect(validateRow('layouts', row)).toBe(true)
      expect(rowFixes('layouts', row)).toEqual([])
      expect(tabOf(row)).toEqual({ id: 'r', kind: 'review', config: { by: kind }, viewState: { ignoreLens: true, sort: 'next' } })
    }
    // Nothing picked, as that build stored it: by Person.
    const none = layoutRow({ id: 'r', kind: 'review', config: {} })
    expect(validateRow('layouts', none)).toBe(true)
    expect(rowFixes('layouts', none)).toEqual([])
    expect(tabOf(none)).toEqual({ id: 'r', kind: 'review', config: { by: 'person' } })
  })

  it('a saved place passes whatever it holds (it is dropped either way)', () => {
    for (const view of [{ currentId: -1 }, { skipped: { day: 'today', ids: [1] } }, { skipped: 'all' }]) {
      const row = layoutRow({ id: 'r', kind: 'review', config: { by: 'person' }, viewState: { sort: 'due', ...view } })
      expect(validateRow('layouts', row)).toBe(true)
      expect(rowFixes('layouts', row)).toEqual([])
      expect(tabOf(row)).toEqual({ id: 'r', kind: 'review', config: { by: 'person' }, viewState: { sort: 'due' } })
    }
  })

  it('a kind that doesn’t read is refused by the check and reset by the repair (Person)', () => {
    for (const by of ['project', 3, null]) {
      const row = layoutRow({ id: 'r', kind: 'review', config: { by } })
      expect(validateRow('layouts', row)).toBe('cells[0].tabs[0].config.by')
      expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
      expect(tabOf(row)).toEqual({ id: 'r', kind: 'review', config: { by: 'person' } })
    }
  })

  it('a saved pick that doesn’t read is refused by the check and dropped by the repair (Person)', () => {
    for (const pick of [{ kind: 'project', id: 1 }, { kind: 'person', id: 0 }, { kind: 'person', id: 'x' }, 'Aisha']) {
      const row = layoutRow({ id: 'r', kind: 'review', config: { by: 'tag', pick } })
      expect(validateRow('layouts', row)).toBe('cells[0].tabs[0].config.pick')
      expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
      expect(tabOf(row)).toEqual({ id: 'r', kind: 'review', config: { by: 'tag' } })
    }
  })

  it('a sort that doesn’t read is dropped alone', () => {
    const row = layoutRow({ id: 'r', kind: 'review', config: { by: 'tag' }, viewState: { sort: 'random', ignoreLens: true } })
    expect(validateRow('layouts', row)).toBe('cells[0].tabs[0].viewState.sort')
    expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
    expect(tabOf(row)).toEqual({ id: 'r', kind: 'review', config: { by: 'tag' }, viewState: { ignoreLens: true } })
  })

  it('a Review widget names no list: its list picks are temporary, never the layout’s', () => {
    const tab: LayoutTab = { id: 'r', kind: 'review', config: { by: 'list' } }
    const body = single({ id: 'k', tabs: [tab] })
    expect([...layoutListRefs(body)]).toEqual([])
    expect(repointLayoutLists(body, new Map([[5, 9]]))).toBe(body)
    // Not even through a pick an earlier build saved.
    const legacy = single({ id: 'k', tabs: [{ id: 'r', kind: 'review', config: { pick: { kind: 'list', id: 5 } } } as unknown as LayoutTab] })
    expect([...layoutListRefs(legacy)]).toEqual([])
  })
})

describe('withoutLegacyReview (a stored row as the app opens it)', () => {
  it('a saved pick becomes its kind, the saved place goes; other tabs and keys stay as they are', () => {
    const notes = { id: 'n', kind: 'notes', config: {} }
    const row = {
      id: 1, name: 'Review', cells: [
        { id: 'a', tabs: [notes, { id: 'r', kind: 'review', config: { pick: { kind: 'status', id: 2 } }, viewState: { sort: 'due', currentId: 4, skipped: { day: '2026-11-09', ids: [1] } } }] },
        { id: 'b', tabs: [{ id: 'q', kind: 'review', config: {}, viewState: { currentId: 4 } }] },
      ],
    }
    const next = withoutLegacyReview(row)
    expect(next).toEqual({
      id: 1, name: 'Review', cells: [
        { id: 'a', tabs: [notes, { id: 'r', kind: 'review', config: { by: 'status' }, viewState: { sort: 'due' } }] },
        { id: 'b', tabs: [{ id: 'q', kind: 'review', config: { by: 'person' } }] },
      ],
    })
    expect(next.cells[0]?.tabs[0]).toBe(notes)
    // The stored row itself is untouched.
    expect(row.cells[0]?.tabs[1]?.config).toEqual({ pick: { kind: 'status', id: 2 } })
  })

  it('the same object when no Review widget holds anything from before', () => {
    const row = { id: 1, cells: [{ id: 'a', tabs: [{ id: 'r', kind: 'review', config: { by: 'tag' }, viewState: { sort: 'due', ignoreLens: true } }, { id: 'n', kind: 'notes', config: {} }] }] }
    expect(withoutLegacyReview(row)).toBe(row)
    const odd = { id: 2, cells: 'none' }
    expect(withoutLegacyReview(odd)).toBe(odd)
  })
})
