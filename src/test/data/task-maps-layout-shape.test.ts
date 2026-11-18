import { describe, expect, it } from 'vitest'
import { rowFixes, sanitizeRow } from '../../data/import-validation'
import { checkLayoutBody } from '../../data/layout-shape'
import { createTab, type LayoutTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { single } from '../helpers/layout-builders'

const DATE = '2026-11-18T09:00:00.000Z'

function layoutRow(tab: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1, name: 'Maps', sortOrder: 0, createdAt: DATE, modifiedAt: DATE,
    ...single({ id: 'k', tabs: [tab as unknown as LayoutTab] }),
  }
}

const tabOf = (row: Record<string, unknown>) => (sanitizeRow('layouts', row) as WorkspaceLayout).cells[0]!.tabs[0]

/** The task maps (2026-11-18): layout config only, no schema step. */
describe('the task maps’ stored tabs', () => {
  it('a new Pressure radar and Work clusters pass the check unchanged', () => {
    for (const tab of [createTab('radar', 'r', { waitingStatusIds: [3] }), createTab('clusters', 'c'), createTab('listwall', 'w')]) {
      const row = layoutRow(tab as unknown as Record<string, unknown>)
      expect(checkLayoutBody(row)).toBe(true)
      expect(rowFixes('layouts', row)).toEqual([])
      expect(tabOf(row)).toEqual(tab)
    }
  })

  it('a radar’s Waiting statuses keep their numbers once each; anything else is a fix', () => {
    expect(tabOf(layoutRow({ id: 'r', kind: 'radar', config: { waitingStatusIds: [4, 2, 4] } }))).toEqual({ id: 'r', kind: 'radar', config: { waitingStatusIds: [4, 2] } })
    const bad = layoutRow({ id: 'r', kind: 'radar', config: { waitingStatusIds: [4, 'x'] } })
    expect(checkLayoutBody(bad)).toBe('cells[0].tabs[0].config.waitingStatusIds')
    expect(rowFixes('layouts', bad)).toEqual(['tab or cell settings reset'])
    expect(tabOf(bad)).toEqual({ id: 'r', kind: 'radar', config: { waitingStatusIds: [4] } })
    expect(tabOf(layoutRow({ id: 'r', kind: 'radar', config: {} }))).toEqual({ id: 'r', kind: 'radar', config: { waitingStatusIds: [] } })
  })

  it('Work clusters has no settings: a stray key is dropped, a fix; view state goes', () => {
    const row = layoutRow({ id: 'c', kind: 'clusters', config: { stray: 1 }, viewState: { detailsWidth: 200 } })
    expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
    expect(tabOf(row)).toEqual({ id: 'c', kind: 'clusters', config: {} })
  })
})
