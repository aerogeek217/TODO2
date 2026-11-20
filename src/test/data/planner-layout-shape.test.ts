import { describe, expect, it } from 'vitest'
import { rowFixes, sanitizeRow } from '../../data/import-validation'
import { checkLayoutBody } from '../../data/layout-shape'
import { createTab, PLANNER_ORDER_MAX, type LayoutTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { single } from '../helpers/layout-builders'

const DATE = '2026-11-20T09:00:00.000Z'

function layoutRow(tab: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1, name: 'Week', sortOrder: 0, createdAt: DATE, modifiedAt: DATE,
    ...single({ id: 'k', tabs: [tab as unknown as LayoutTab] }),
  }
}

const tabOf = (row: Record<string, unknown>) => (sanitizeRow('layouts', row) as WorkspaceLayout).cells[0]!.tabs[0]
const planner = (viewState?: unknown, config: unknown = {}) => layoutRow({ id: 'p', kind: 'planner', config, ...(viewState !== undefined ? { viewState } : {}) })

/** The Planner (2026-11-20): no settings; its hand order is view state. No schema step. */
describe('the Planner’s stored tab', () => {
  it('a new Planner passes the check unchanged', () => {
    const tab = createTab('planner', 'p')
    expect(tab).toEqual({ id: 'p', kind: 'planner', config: {} })
    const row = layoutRow(tab as unknown as Record<string, unknown>)
    expect(checkLayoutBody(row)).toBe(true)
    expect(rowFixes('layouts', row)).toEqual([])
    expect(tabOf(row)).toEqual(tab)
  })

  it('keeps a hand order of task uids as it is, an empty one too', () => {
    for (const order of [['b', 'a', 'c'], []]) {
      const row = planner({ order })
      expect(checkLayoutBody(row)).toBe(true)
      expect(rowFixes('layouts', row)).toEqual([])
      expect(tabOf(row)).toEqual({ id: 'p', kind: 'planner', config: {}, viewState: { order } })
    }
  })

  it('keeps only the order’s strings, each once: anything else is dropped, a fix', () => {
    const row = planner({ order: ['a', 3, 'b', null, 'a', { uid: 'c' }, 'c'] })
    expect(checkLayoutBody(row)).toBe('cells[0].tabs[0].viewState.order')
    expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
    expect(tabOf(row)).toEqual({ id: 'p', kind: 'planner', config: {}, viewState: { order: ['a', 'b', 'c'] } })
  })

  it(`cuts an order past ${PLANNER_ORDER_MAX} uids`, () => {
    const order = Array.from({ length: PLANNER_ORDER_MAX + 5 }, (_, i) => `u${i}`)
    expect(checkLayoutBody(planner({ order: order.slice(0, PLANNER_ORDER_MAX) }))).toBe(true)
    const row = planner({ order })
    expect(checkLayoutBody(row)).toBe('cells[0].tabs[0].viewState.order')
    const kept = tabOf(row)
    expect(kept?.kind === 'planner' ? kept.viewState?.order : null).toEqual(order.slice(0, PLANNER_ORDER_MAX))
  })

  it('drops an order that is no list, and a key it doesn’t have', () => {
    for (const viewState of [{ order: 'a,b' }, { order: { 0: 'a' } }, { detailsWidth: 200 }, { sort: 'due' }]) {
      const row = planner(viewState)
      expect(checkLayoutBody(row)).not.toBe(true)
      expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
      expect(tabOf(row)).toEqual({ id: 'p', kind: 'planner', config: {} })
    }
    // A stray key beside a good order: the order stays.
    const row = planner({ order: ['a'], window: 7 })
    expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
    expect(tabOf(row)).toEqual({ id: 'p', kind: 'planner', config: {}, viewState: { order: ['a'] } })
  })

  it('has no settings: a stray config key is dropped, a fix', () => {
    const row = planner({ order: ['a'] }, { offset: 7 })
    expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
    expect(tabOf(row)).toEqual({ id: 'p', kind: 'planner', config: {}, viewState: { order: ['a'] } })
  })

  it('a view state that is no object fails the check and is dropped', () => {
    const row = planner('order')
    expect(checkLayoutBody(row)).toBe('cells[0].tabs[0].viewState')
    expect(tabOf(row)).toEqual({ id: 'p', kind: 'planner', config: {} })
  })
})
