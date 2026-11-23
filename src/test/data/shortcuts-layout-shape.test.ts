import { describe, expect, it } from 'vitest'
import { rowFixes, sanitizeRow } from '../../data/import-validation'
import { checkLayoutBody } from '../../data/layout-shape'
import { storedListRefs } from '../../data/layout-repository'
import { createTab, SHORTCUTS_LISTS_MAX, type LayoutTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { layoutListRefs } from '../../utils/workspace-layout-lists'
import { single } from '../helpers/layout-builders'

const DATE = '2026-11-23T09:00:00.000Z'

function layoutRow(tab: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1, name: 'Home', sortOrder: 0, createdAt: DATE, modifiedAt: DATE,
    ...single({ id: 'k', tabs: [tab as unknown as LayoutTab] }),
  }
}

const tabOf = (row: Record<string, unknown>) => (sanitizeRow('layouts', row) as WorkspaceLayout).cells[0]!.tabs[0]

/** The List board (kind `shortcuts`): layout config only. */
describe('a List board’s stored tab', () => {
  it('a new one, one with lists and one of each source pass the check unchanged', () => {
    for (const tab of [
      createTab('shortcuts', 's'),
      { id: 's', kind: 'shortcuts', config: { lists: [4, 2, 9] } },
      { id: 's', kind: 'shortcuts', config: { source: 'picked' } },
      { id: 's', kind: 'shortcuts', config: { source: 'layout', lists: [4] } },
    ]) {
      const row = layoutRow(tab as unknown as Record<string, unknown>)
      expect(checkLayoutBody(row)).toBe(true)
      expect(rowFixes('layouts', row)).toEqual([])
      expect(tabOf(row)).toEqual(tab)
    }
  })

  it('keeps positive whole numbers, each once, in order: anything else is dropped, a fix', () => {
    const row = layoutRow({ id: 's', kind: 'shortcuts', config: { lists: [3, 'x', 3, -1, 1.5, 0, 7] } })
    expect(checkLayoutBody(row)).not.toBe(true)
    expect(rowFixes('layouts', row).length).toBeGreaterThan(0)
    expect(tabOf(row)).toEqual({ id: 's', kind: 'shortcuts', config: { lists: [3, 7] } })
  })

  it('lists that aren’t a list are dropped; a stray key and view state go; a long one is cut', () => {
    expect(tabOf(layoutRow({ id: 's', kind: 'shortcuts', config: { lists: 'a' } }))).toEqual({ id: 's', kind: 'shortcuts', config: { lists: [] } })
    const stray = layoutRow({ id: 's', kind: 'shortcuts', config: { lists: [1], stray: 1 }, viewState: { detailsWidth: 200 } })
    expect(rowFixes('layouts', stray).length).toBeGreaterThan(0)
    expect(tabOf(stray)).toEqual({ id: 's', kind: 'shortcuts', config: { lists: [1] } })
    const long = Array.from({ length: SHORTCUTS_LISTS_MAX + 5 }, (_, i) => i + 1)
    expect((tabOf(layoutRow({ id: 's', kind: 'shortcuts', config: { lists: long } })) as { config: { lists: number[] } }).config.lists).toHaveLength(SHORTCUTS_LISTS_MAX)
  })

  it('an unknown source is dropped, a fix: the board shows the lists picked, kept', () => {
    for (const source of ['all', 3, null, { kind: 'layout' }]) {
      const row = layoutRow({ id: 's', kind: 'shortcuts', config: { source, lists: [2] } })
      expect(checkLayoutBody(row)).toBe('cells[0].tabs[0].config.source')
      expect(rowFixes('layouts', row).length).toBeGreaterThan(0)
      expect(tabOf(row)).toEqual({ id: 's', kind: 'shortcuts', config: { lists: [2] } })
    }
  })

  it('names none of the layout’s own lists: another layout’s list is never handed to it', () => {
    const row = layoutRow({ id: 's', kind: 'shortcuts', config: { lists: [4, 2] } })
    expect([...storedListRefs(row)]).toEqual([])
    expect([...layoutListRefs(row as unknown as WorkspaceLayout)]).toEqual([])
  })
})
