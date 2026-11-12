import { describe, expect, it } from 'vitest'
import { rowFixes, sanitizeRow, validateRow } from '../../data/import-validation'
import { createTab, type LayoutTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { layoutListRefs, repointLayoutLists } from '../../utils/workspace-layout-lists'
import { single } from '../helpers/layout-builders'

/**
 * Item 12 · a Review widget as stored (widget feedback 2A): no settings —
 * what it reviews is a temporary filter, never saved — and its view state
 * (lens switch, sort). What earlier builds saved — board BM's kind (`by`),
 * board BK's `pick`, where it stood (`currentId`, `skipped`) — v79 removed
 * from every stored row (`v79-upgrade.test`); one left in a v79 row (a hand
 * edit) passes the import check and is dropped by the repair, a fix.
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

  it('a kind or a pick an earlier build saved (v79 removed them) passes the check whatever it holds, and is dropped — a fix', () => {
    const configs = [
      { by: 'person' }, { by: 'list' }, { by: 'project' }, { by: 3 }, { by: null },
      { pick: { kind: 'tag', id: 3 } }, { pick: 'Aisha' }, { by: 'tag', pick: { kind: 'person', id: 0 } },
    ]
    for (const config of configs) {
      const row = layoutRow({ id: 'r', kind: 'review', config, viewState: { sort: 'due' } })
      expect(validateRow('layouts', row)).toBe(true)
      expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
      expect(tabOf(row)).toEqual({ id: 'r', kind: 'review', config: {}, viewState: { sort: 'due' } })
    }
  })

  it('a saved place (v79 removed it) passes whatever it holds, and is dropped — a fix', () => {
    for (const view of [{ currentId: -1 }, { skipped: { day: 'today', ids: [1] } }, { skipped: 'all' }]) {
      const row = layoutRow({ id: 'r', kind: 'review', config: {}, viewState: { sort: 'due', ...view } })
      expect(validateRow('layouts', row)).toBe(true)
      expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
      expect(tabOf(row)).toEqual({ id: 'r', kind: 'review', config: {}, viewState: { sort: 'due' } })
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
