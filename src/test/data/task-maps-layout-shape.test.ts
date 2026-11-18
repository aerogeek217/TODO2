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
  it('a new Work clusters and List wall pass the check unchanged', () => {
    for (const tab of [createTab('clusters', 'c'), createTab('listwall', 'w')]) {
      const row = layoutRow(tab as unknown as Record<string, unknown>)
      expect(checkLayoutBody(row)).toBe(true)
      expect(rowFixes('layouts', row)).toEqual([])
      expect(tabOf(row)).toEqual(tab)
    }
  })

  it.each(['radar', 'pulse'])('a stored %s tab (removed; v83 dropped every one) is an unknown kind: dropped by the repair, a fix', (kind) => {
    const row = {
      id: 1, name: 'Maps', sortOrder: 0, createdAt: DATE, modifiedAt: DATE,
      ...single({ id: 'k', tabs: [{ id: 'gone', kind, config: {} } as unknown as LayoutTab, createTab('notes', 'n')] }),
    }
    expect(checkLayoutBody(row)).not.toBe(true)
    expect(rowFixes('layouts', row).length).toBeGreaterThan(0)
    expect((sanitizeRow('layouts', row) as WorkspaceLayout).cells[0]!.tabs).toEqual([createTab('notes', 'n')])
  })

  it('Work clusters has no settings: a stray key is dropped, a fix; view state goes', () => {
    const row = layoutRow({ id: 'c', kind: 'clusters', config: { stray: 1 }, viewState: { detailsWidth: 200 } })
    expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
    expect(tabOf(row)).toEqual({ id: 'c', kind: 'clusters', config: {} })
  })
})
