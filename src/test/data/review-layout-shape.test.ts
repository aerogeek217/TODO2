import { describe, expect, it } from 'vitest'
import { rowFixes, sanitizeRow, validateRow } from '../../data/import-validation'
import { createTab, type LayoutTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { layoutListRefs, repointLayoutLists } from '../../utils/workspace-layout-lists'
import { single } from '../helpers/layout-builders'

/**
 * Item 12 · a Review widget as stored: its pick (layout config) and where it
 * stands (view state: lens switch, sort, current task, a day's skips) pass
 * the import check as they are; anything its read would drop is a fix.
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
  it('new: nothing picked', () => {
    expect(createTab('review', 'r')).toEqual({ id: 'r', kind: 'review', config: {} })
  })

  it('a pick and its view state pass as they are', () => {
    const tab = {
      id: 'r', kind: 'review',
      config: { pick: { kind: 'person', id: 3 } },
      viewState: { ignoreLens: true, sort: 'next', currentId: 12, skipped: { day: '2026-11-09', ids: [4, 7] } },
    }
    const row = layoutRow(tab)
    expect(validateRow('layouts', row)).toBe(true)
    expect(rowFixes('layouts', row)).toEqual([])
    expect(tabOf(row)).toEqual(tab)
  })

  it('every pick kind reads; nothing picked too', () => {
    for (const kind of ['person', 'tag', 'status', 'list']) {
      expect(validateRow('layouts', layoutRow({ id: 'r', kind: 'review', config: { pick: { kind, id: 1 } } }))).toBe(true)
    }
    expect(validateRow('layouts', layoutRow({ id: 'r', kind: 'review', config: {} }))).toBe(true)
  })

  it('a pick that doesn’t read is refused by the check and dropped by the repair (nothing picked)', () => {
    for (const pick of [{ kind: 'project', id: 1 }, { kind: 'person', id: 0 }, { kind: 'person', id: 'x' }, 'Aisha']) {
      const row = layoutRow({ id: 'r', kind: 'review', config: { pick } })
      expect(validateRow('layouts', row)).toBe('cells[0].tabs[0].config.pick')
      expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
      expect(tabOf(row)).toEqual({ id: 'r', kind: 'review', config: {} })
    }
  })

  it('a view state field that doesn’t read is dropped alone', () => {
    const bad = [
      [{ sort: 'random' }, 'sort'],
      [{ currentId: -1 }, 'currentId'],
      [{ skipped: { day: 'today', ids: [1] } }, 'skipped'],
      [{ skipped: { day: '2026-11-09', ids: ['1'] } }, 'skipped'],
    ] as const
    for (const [view, field] of bad) {
      const row = layoutRow({ id: 'r', kind: 'review', config: { pick: { kind: 'tag', id: 2 } }, viewState: { sort: 'due', ...view } })
      expect(validateRow('layouts', row)).toBe(`cells[0].tabs[0].viewState.${field}`)
      expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
      const kept = tabOf(row)
      expect(kept?.kind === 'review' && kept.viewState?.[field]).toBeFalsy()
    }
  })

  it('a list pick counts as the layout showing that list: Save keeps it, Save as repoints it', () => {
    const tab: LayoutTab = { id: 'r', kind: 'review', config: { pick: { kind: 'list', id: 5 } } }
    const body = single({ id: 'k', tabs: [tab] })
    expect([...layoutListRefs(body)]).toEqual([5])
    expect(repointLayoutLists(body, new Map([[5, 9]])).cells[0]?.tabs[0]).toEqual({ ...tab, config: { pick: { kind: 'list', id: 9 } } })
    // A person pick names no list.
    expect([...layoutListRefs(single({ id: 'k', tabs: [{ id: 'r', kind: 'review', config: { pick: { kind: 'person', id: 5 } } }] }))]).toEqual([])
  })
})
