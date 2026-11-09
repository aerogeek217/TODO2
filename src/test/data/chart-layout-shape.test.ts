import { describe, expect, it } from 'vitest'
import { rowFixes, sanitizeRow, validateRow } from '../../data/import-validation'
import { checkLayoutBody } from '../../data/layout-shape'
import { emptyPredicate } from '../../models/filter-predicate'
import { breakdownPreset, newBreakdownConfig } from '../../models/chart-widgets'
import { createTab, kindTabTitle, type LayoutTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { single } from '../helpers/layout-builders'

const DATE = '2026-09-01T09:00:00.000Z'

function layoutRow(tab: Record<string, unknown>): Record<string, unknown> {
  return { id: 1, name: 'Charts', sortOrder: 0, createdAt: DATE, modifiedAt: DATE, ...single({ id: 'k', tabs: [tab as unknown as LayoutTab] }) }
}

const tabOf = (row: Record<string, unknown>) => (sanitizeRow('layouts', row) as WorkspaceLayout).cells[0]!.tabs[0]

describe('a Breakdown in a stored layout (D26 P8)', () => {
  const full = {
    ...newBreakdownConfig({ ...emptyPredicate(), statusIds: [3] }),
    name: 'Waiting on', show: 'oldest', oldestBy: 'lastFollowup', checkins: true, style: 'donut', showNone: false,
    badges: { due: 'overdue', followup: 2 },
  }

  it('every field round-trips, with its sorts (view state)', () => {
    for (const tab of [
      createTab('breakdown', 't') as unknown as Record<string, unknown>,
      { id: 't', kind: 'breakdown', config: full, viewState: { sorts: { people: { by: 'due', reversed: true }, status: { by: 'name' } } } },
      { id: 't', kind: 'breakdown', config: { ...newBreakdownConfig(emptyPredicate()), splitBy: 'age', badges: 'off' } },
      // One range of its own: the other follows Settings.
      { id: 't', kind: 'breakdown', config: { ...newBreakdownConfig(emptyPredicate()), badges: { followup: 2 } } },
      { id: 't', kind: 'breakdown', config: { ...newBreakdownConfig(emptyPredicate()), badges: { due: 'overdue' } } },
    ]) {
      const row = layoutRow(tab)
      expect(validateRow('layouts', row)).toBe(true)
      expect(rowFixes('layouts', row)).toEqual([])
      expect(tabOf(row)).toEqual(tab)
    }
  })

  it.each([
    ['name', 7, { name: 'Breakdown' }],
    ['splitBy', 'month', { splitBy: 'people' }],
    ['style', 'pie', { style: 'bars' }],
    ['show', 'sum', { show: 'count', oldestBy: undefined }],
    ['oldestBy', 'birthday', { oldestBy: undefined }],
    ['showNone', 'yes', { showNone: true }],
    ['checkins', false, { checkins: undefined }],
    ['badges', { due: 'soon', followup: 0 }, { badges: undefined }],
    ['badges', {}, { badges: undefined }],
    ['badges', { due: 3, weekly: true }, { badges: undefined }],
  ] as const)('its %s %j is reset (a fix)', (key, value, reset) => {
    const row = layoutRow({ id: 't', kind: 'breakdown', config: { ...full, [key]: value } })
    expect(checkLayoutBody(row)).toBe(`cells[0].tabs[0].config.${key}`)
    expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
    const expected: Record<string, unknown> = { ...full, ...reset }
    for (const [k, v] of Object.entries(expected)) if (v === undefined) delete expected[k]
    expect(tabOf(row)).toEqual({ id: 't', kind: 'breakdown', config: expected })
  })

  it('an oldestBy without oldest goes; a missing filter is none (a fix); a bad sort is dropped', () => {
    const counts = layoutRow({ id: 't', kind: 'breakdown', config: { ...full, show: 'count' } })
    expect(checkLayoutBody(counts)).toBe('cells[0].tabs[0].config.oldestBy')
    expect(tabOf(counts)?.config).not.toHaveProperty('oldestBy')
    const { filter: _f, ...noFilter } = full
    void _f
    expect((tabOf(layoutRow({ id: 't', kind: 'breakdown', config: noFilter }))?.config as { filter: unknown }).filter).toEqual(emptyPredicate())
    const sorts = layoutRow({ id: 't', kind: 'breakdown', config: full, viewState: { sorts: { people: { by: 'height' }, tags: { by: 'open' } } } })
    expect(checkLayoutBody(sorts)).toBe('cells[0].tabs[0].viewState.sorts.people')
    expect(tabOf(sorts)).toEqual({ id: 't', kind: 'breakdown', config: full, viewState: { sorts: { tags: { by: 'open' } } } })
  })

  it('its tab reads its name, Breakdown while blank', () => {
    expect(kindTabTitle(createTab('breakdown', 'b', { breakdown: { name: 'Waiting on' } }))).toBe('Waiting on')
    expect(kindTabTitle(createTab('breakdown', 'b', { breakdown: { name: '  ' } }))).toBe('Breakdown')
  })
})

describe('a Pivot in a stored layout (D26 P8)', () => {
  it('round-trips; a bad axis or name is reset (a fix)', () => {
    const tab = { id: 't', kind: 'pivot', config: { name: 'Who × status', filter: { ...emptyPredicate(), tags: [2] }, rows: 'tags', cols: 'priority' } }
    expect(validateRow('layouts', layoutRow(tab))).toBe(true)
    expect(tabOf(layoutRow(tab))).toEqual(tab)
    expect(createTab('pivot', 'p').config).toEqual({ name: 'Pivot', filter: emptyPredicate(), rows: 'people', cols: 'status' })
    for (const [key, value, reset] of [['rows', 'weeks', 'people'], ['cols', 7, 'status'], ['name', null, 'Pivot']] as const) {
      const row = layoutRow({ ...tab, config: { ...tab.config, [key]: value } })
      expect(checkLayoutBody(row)).toBe(`cells[0].tabs[0].config.${key}`)
      expect(rowFixes('layouts', row)).toEqual(['tab or cell settings reset'])
      expect((tabOf(row)?.config as unknown as Record<string, unknown>)[key]).toBe(reset)
    }
  })
})

describe('a Status flow in a stored layout (D26 P8)', () => {
  it('round-trips; bad weeks or a bad name are reset (a fix)', () => {
    const tab = { id: 't', kind: 'statusFlow', config: { name: 'Flow', filter: emptyPredicate(), weeks: 12 } }
    expect(validateRow('layouts', layoutRow(tab))).toBe(true)
    expect(tabOf(layoutRow(tab))).toEqual(tab)
    expect(createTab('statusFlow', 's').config).toEqual({ name: 'Status flow', filter: emptyPredicate(), weeks: 8 })
    const bad = layoutRow({ ...tab, config: { ...tab.config, weeks: 10 } })
    expect(checkLayoutBody(bad)).toBe('cells[0].tabs[0].config.weeks')
    expect(rowFixes('layouts', bad)).toEqual(['tab or cell settings reset'])
    expect((tabOf(bad)?.config as { weeks: number }).weeks).toBe(8)
  })
})

describe('a Tag map in a stored layout (D26 P8)', () => {
  it('round-trips with or without its picks; a repeat or a non-number in them is dropped (a fix)', () => {
    for (const config of [{ name: 'Map', filter: emptyPredicate() }, { name: 'Map', filter: emptyPredicate(), tagIds: [3, 1] }]) {
      const tab = { id: 't', kind: 'tagMap', config }
      expect(validateRow('layouts', layoutRow(tab))).toBe(true)
      expect(tabOf(layoutRow(tab))).toEqual(tab)
    }
    expect(createTab('tagMap', 'm').config).toEqual({ name: 'Tag map', filter: emptyPredicate() })
    const bad = layoutRow({ id: 't', kind: 'tagMap', config: { name: 'Map', filter: emptyPredicate(), tagIds: [3, 3, 'x', 1] } })
    expect(checkLayoutBody(bad)).toBe('cells[0].tabs[0].config.tagIds')
    expect(rowFixes('layouts', bad)).toEqual(['tab or cell settings reset'])
    expect((tabOf(bad)?.config as { tagIds: number[] }).tagIds).toEqual([3, 1])
  })
})

describe('the Add widget presets', () => {
  const statuses = [{ id: 1, name: 'To do' }, { id: 7, name: 'waiting ' }]

  it('People, Tags and Status split every open task by theirs; Custom is a new Breakdown', () => {
    expect(breakdownPreset('people', statuses, emptyPredicate)).toEqual({ config: { name: 'People', splitBy: 'people' } })
    expect(breakdownPreset('tags', statuses, emptyPredicate)).toEqual({ config: { name: 'Tags', splitBy: 'tags' } })
    expect(breakdownPreset('status', statuses, emptyPredicate)).toEqual({ config: { name: 'Status', splitBy: 'status' } })
    expect(breakdownPreset('custom', statuses, emptyPredicate)).toEqual({ config: {} })
  })

  it('Waiting on: !Waiting (its name matched without case), by people, oldest by last follow-up, with check-ins', () => {
    expect(breakdownPreset('waiting', statuses, emptyPredicate)).toEqual({
      config: {
        name: 'Waiting on', splitBy: 'people', show: 'oldest', oldestBy: 'lastFollowup', checkins: true,
        filter: { ...emptyPredicate(), statusIds: [7] },
      },
    })
  })

  it('Waiting on with no status named Waiting: no filter yet, and the editor opens the Status picker', () => {
    const seed = breakdownPreset('waiting', [{ id: 1, name: 'To do' }], emptyPredicate)
    expect(seed.startField).toBe('status')
    expect(seed.config.filter).toEqual(emptyPredicate())
  })
})
