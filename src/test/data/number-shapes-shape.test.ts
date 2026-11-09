import { describe, expect, it } from 'vitest'
import { rowFixes, sanitizeRow, validateRow } from '../../data/import-validation'
import { checkLayoutBody } from '../../data/layout-shape'
import { emptyPredicate } from '../../models/filter-predicate'
import type { NumberConfig } from '../../models/glance-widgets'
import { isNumberGoal, pickNumberGoal } from '../../models/number-shapes'
import type { LayoutTab, NumberTab, WorkspaceLayout } from '../../models/workspace-layout'
import { numberTab, single } from '../helpers/layout-builders'

const DATE = '2026-09-01T09:00:00.000Z'

function layoutRow(tab: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1, name: 'Glance', sortOrder: 0, createdAt: DATE, modifiedAt: DATE,
    ...single({ id: 'k', tabs: [tab as unknown as LayoutTab] }),
  }
}

const tabOf = (row: Record<string, unknown>) => (sanitizeRow('layouts', row) as WorkspaceLayout).cells[0]!.tabs[0] as NumberTab

const overdue = numberTab('t', 'overdue').config
const tagged = { ...emptyPredicate(), tags: [3] }

/** A Number of shape `show` with its field. */
const shaped = (patch: Partial<NumberConfig>): NumberConfig => ({ ...overdue, ...patch })

describe('a Number’s shapes in a stored layout (D26 P6)', () => {
  it.each([
    ['share, every open task', shaped({ show: 'share' })],
    ['share of a filter', shaped({ show: 'share', of: tagged })],
    ['oldest', shaped({ show: 'oldest', oldestBy: 'deadline' })],
    ['goal at least, weekly', shaped({ show: 'goal', goal: { atLeast: 12, period: 'week' } })],
    ['goal at most', shaped({ show: 'goal', goal: { atMost: 0 } })],
    ['group', shaped({ show: 'group', items: [{ name: 'Today', filter: tagged, color: '#e86bf0' }, { name: '', filter: emptyPredicate() }] })],
    ['list', shaped({ show: 'list', list: { listDefinitionId: 4 } })],
    ['list, none picked yet', shaped({ show: 'list' })],
  ])('%s round-trips', (_, config) => {
    const good = layoutRow({ id: 't', kind: 'number', config })
    expect(validateRow('layouts', good)).toBe(true)
    expect(rowFixes('layouts', good)).toEqual([])
    expect(tabOf(good)).toEqual({ id: 't', kind: 'number', config })
  })

  it.each([
    // Another shape's field: a stray, dropped.
    ['a count with a goal', shaped({ goal: { atLeast: 3 } }), 'goal', overdue],
    ['a share with a list', shaped({ show: 'share', list: { listDefinitionId: 2 } }), 'list', shaped({ show: 'share' })],
    // Its own field missing or unreadable: its default.
    ['an oldest without its date', shaped({ show: 'oldest' }), 'oldestBy', shaped({ show: 'oldest', oldestBy: 'lastFollowup' })],
    ['an oldest by a date it doesn’t know', { ...shaped({ show: 'oldest' }), oldestBy: 'due' }, 'oldestBy', shaped({ show: 'oldest', oldestBy: 'lastFollowup' })],
    ['a goal without one', shaped({ show: 'goal' }), 'goal', shaped({ show: 'goal', goal: { atLeast: 10, period: 'week' } })],
    ['a goal with both bounds', { ...shaped({ show: 'goal' }), goal: { atMost: 2, atLeast: 4 } }, 'goal', shaped({ show: 'goal', goal: { atMost: 2 } })],
    ['a goal by the month', { ...shaped({ show: 'goal' }), goal: { atLeast: 4, period: 'month' } }, 'goal', shaped({ show: 'goal', goal: { atLeast: 4 } })],
    ['a list by a bad id', { ...shaped({ show: 'list' }), list: { listDefinitionId: 'x' } }, 'list', shaped({ show: 'list' })],
    ['a group without items', shaped({ show: 'group' }), 'items', shaped({ show: 'group', items: [{ name: 'Open', filter: emptyPredicate() }] })],
  ] as const)('%s is repaired (a fix)', (_, config, key, repaired) => {
    const row = layoutRow({ id: 't', kind: 'number', config })
    expect(checkLayoutBody(row)).toBe(`cells[0].tabs[0].config.${key}`)
    expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
    expect(tabOf(row).config).toEqual(repaired)
  })

  it('a group keeps its first six counts; a bad name, colour or filter is reset', () => {
    const item = { name: 'A', filter: tagged }
    const seven = layoutRow({ id: 't', kind: 'number', config: shaped({ show: 'group', items: Array.from({ length: 7 }, () => item) }) })
    expect(checkLayoutBody(seven)).toBe('cells[0].tabs[0].config.items')
    expect(tabOf(seven).config.items).toHaveLength(6)

    const bad = layoutRow({ id: 't', kind: 'number', config: { ...shaped({ show: 'group' }), items: [{ name: 7, filter: tagged, color: 'teal' }, { name: 'B', filter: { tags: [1] } }] } })
    expect(checkLayoutBody(bad)).toBe('cells[0].tabs[0].config.items')
    expect(tabOf(bad).config.items).toEqual([
      { name: 'Number', filter: tagged },
      { name: 'B', filter: { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, tags: [1] } },
    ])
    // A bad item filter alone is named by its path.
    const badFilter = layoutRow({ id: 't', kind: 'number', config: shaped({ show: 'group', items: [{ name: 'B', filter: { tags: [1] } as unknown as typeof tagged }] }) })
    expect(checkLayoutBody(badFilter)).toBe('cells[0].tabs[0].config.items.0.filter.showCompleted')
  })

  it('a share’s second filter is read as a list’s is', () => {
    const bad = layoutRow({ id: 't', kind: 'number', config: shaped({ show: 'share', of: { tags: [2] } as unknown as typeof tagged }) })
    expect(checkLayoutBody(bad)).toBe('cells[0].tabs[0].config.of.showCompleted')
    expect(tabOf(bad).config.of).toEqual({ showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, tags: [2] })
  })

  it('a goal: one bound, a whole number in range, an optional week', () => {
    expect(isNumberGoal({ atLeast: 0 })).toBe(true)
    expect(isNumberGoal({ atMost: 5, period: 'week' })).toBe(true)
    expect(isNumberGoal({ atMost: 1.5 })).toBe(false)
    expect(isNumberGoal({ atMost: -1 })).toBe(false)
    expect(isNumberGoal({ atLeast: 1, extra: 1 })).toBe(false)
    expect(pickNumberGoal({ atLeast: 2, period: 'week', extra: 1 })).toEqual({ goal: { atLeast: 2, period: 'week' }, fixed: true })
    expect(pickNumberGoal(null)).toEqual({ goal: { atLeast: 10, period: 'week' }, fixed: true })
  })
})
