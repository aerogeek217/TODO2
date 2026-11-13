import { describe, it, expect } from 'vitest'
import { checkLayoutBody, pickLayoutBody } from '../../data/layout-shape'
import { validateRow } from '../../data/import-validation'
import { CHART_NAME_MAX } from '../../models/chart-widgets'
import { NUMBER_NAME_MAX, readStoredName } from '../../models/glance-widgets'
import { createTab, TAB_NAME_MAX, type LayoutTab } from '../../models/workspace-layout'

const AREA = { col: 0, row: 0, colSpan: 1, rowSpan: 1 }
const DATE = '2026-09-01T09:00:00.000Z'

/** One cell holding a Notes tab with `extra` on the tab. */
function body(extra: Record<string, unknown>) {
  return {
    grid: { columns: [{ id: 'c', weight: 1000 }], rows: [{ id: 'r', weight: 1000 }] },
    cells: [{ id: 'k', area: AREA, tabs: [{ id: 't', kind: 'notes', config: {}, ...extra }] }],
  }
}

describe('a tab’s stored name and icon (items 11, 14)', () => {
  it('passes the check when absent, and with a valid name and icon', () => {
    expect(checkLayoutBody(body({}))).toBe(true)
    expect(checkLayoutBody(body({ name: 'Scratch' }))).toBe(true)
    expect(checkLayoutBody(body({ icon: { kind: 'none' } }))).toBe(true)
    expect(checkLayoutBody(body({ icon: { kind: 'line', key: 'flag' } }))).toBe(true)
    expect(checkLayoutBody(body({ icon: { kind: 'emoji', emoji: '🚀', show: 'color' } }))).toBe(true)
  })

  it.each([
    [{ name: 5 }, 'cells[0].tabs[0].name'],
    [{ name: 'x'.repeat(201) }, 'cells[0].tabs[0].name'],
    [{ icon: 'flag' }, 'cells[0].tabs[0].icon'],
    [{ icon: { kind: 'line', key: 'nope' } }, 'cells[0].tabs[0].icon'],
    [{ icon: { kind: 'emoji', emoji: 'abc' } }, 'cells[0].tabs[0].icon'],
  ])('rejects %j at %s', (extra, path) => {
    expect(checkLayoutBody(body(extra))).toBe(path)
  })

  it('keeps a valid name (trimmed) and icon when read, and no fix', () => {
    const picked = pickLayoutBody(body({ name: ' Scratch ', icon: { kind: 'emoji', emoji: '🚀', show: 'muted' } }))
    expect(picked.fixes).toEqual([])
    expect(picked.cells[0]!.tabs[0]).toEqual({ id: 't', kind: 'notes', config: {}, name: 'Scratch', icon: { kind: 'emoji', emoji: '🚀' } })
  })

  it('a blank name is none, never a fix', () => {
    const picked = pickLayoutBody(body({ name: '   ' }))
    expect(picked.fixes).toEqual([])
    expect(picked.cells[0]!.tabs[0]).not.toHaveProperty('name')
  })

  it('drops a name or icon that doesn’t read, as a settings fix, keeping the tab', () => {
    const picked = pickLayoutBody(body({ name: 7, icon: { kind: 'line', key: 'nope' } }))
    expect(picked.cells[0]!.tabs[0]).toEqual({ id: 't', kind: 'notes', config: {} })
    expect(picked.fixes).toEqual(['2 tab or cell settings reset'])
  })

  it('cuts a name past 200 characters to 200 (a fix of its own), keeping the tab', () => {
    const picked = pickLayoutBody(body({ name: `  ${'x'.repeat(250)}` }))
    expect(picked.fixes).toEqual(['tab name shortened'])
    // Cut first, then trimmed, as a name within the limit is.
    expect(picked.cells[0]!.tabs[0]).toEqual({ id: 't', kind: 'notes', config: {}, name: 'x'.repeat(198) })
    expect(checkLayoutBody(picked)).toBe(true)
  })

  it('a layout row from a file: import validates the new fields', () => {
    const row = { id: 1, name: 'Daily', sortOrder: 0, createdAt: DATE, modifiedAt: DATE }
    expect(validateRow('layouts', { ...row, ...body({ icon: { kind: 'emoji', emoji: '📅' }, name: 'Plan' }) })).toBe(true)
    expect(validateRow('layouts', { ...row, ...body({ icon: { kind: 'emoji', emoji: 'x' } }) })).not.toBe(true)
  })
})

describe('a Number’s or a chart’s stored name past its limit is cut, never reset (cr34 D1)', () => {
  /** One cell holding `tab`. */
  const bodyOf = (tab: LayoutTab) => ({
    grid: { columns: [{ id: 'c', weight: 1000 }], rows: [{ id: 'r', weight: 1000 }] },
    cells: [{ id: 'k', area: AREA, tabs: [tab] }],
  })
  /** A sentence of `n` characters, as Name and icon… took it (up to `TAB_NAME_MAX`). */
  const sentence = (n: number) => 'Follow-ups waiting on the regional leads '.repeat(8).slice(0, n)

  it('the limits: a Number’s and a chart’s name 80, a tab’s own 200', () => {
    expect([NUMBER_NAME_MAX, CHART_NAME_MAX, TAB_NAME_MAX]).toEqual([80, 80, 200])
  })

  it.each(['number', 'breakdown', 'pivot', 'trend'] as const)('a %s named with 81 – 200 characters keeps its first 80, and every other setting', (kind) => {
    for (const length of [81, 120, 200]) {
      const tab = createTab(kind, 't')
      const named = { ...tab, config: { ...tab.config, name: sentence(length) } } as LayoutTab
      expect(checkLayoutBody(bodyOf(named))).toBe('cells[0].tabs[0].config.name')
      const picked = pickLayoutBody(bodyOf(named))
      expect(picked.fixes).toEqual(['tab name shortened'])
      expect(picked.cells[0]!.tabs[0]).toEqual({ ...tab, config: { ...tab.config, name: sentence(80) } })
      // The repaired row reads back with nothing to fix.
      expect(checkLayoutBody(picked)).toBe(true)
      expect(pickLayoutBody(picked).fixes).toEqual([])
    }
  })

  it('a name at the limit is kept whole, no fix', () => {
    const tab = createTab('number', 't')
    const named = { ...tab, config: { ...tab.config, name: sentence(80) } } as LayoutTab
    expect(checkLayoutBody(bodyOf(named))).toBe(true)
    expect(pickLayoutBody(bodyOf(named)).fixes).toEqual([])
  })

  it('a cut name beside a setting that is reset reports both', () => {
    const tab = createTab('number', 't')
    const picked = pickLayoutBody(bodyOf({ ...tab, config: { ...tab.config, name: sentence(90), compare: 'lastYear' } } as unknown as LayoutTab))
    expect(picked.fixes).toEqual(['tab or cell settings reset', 'tab name shortened'])
    expect(picked.cells[0]!.tabs[0]!.config).toMatchObject({ name: sentence(80), compare: 'yesterday' })
  })

  it('a name that is no text is still reset to the kind’s default', () => {
    const tab = createTab('pivot', 't')
    const picked = pickLayoutBody(bodyOf({ ...tab, config: { ...tab.config, name: 7 } } as unknown as LayoutTab))
    expect(picked.fixes).toEqual(['tab or cell settings reset'])
    expect(picked.cells[0]!.tabs[0]!.config).toMatchObject({ name: 'Pivot' })
  })

  it('readStoredName never cuts through a surrogate pair', () => {
    expect(readStoredName('abc')).toEqual({ name: 'abc', cut: false })
    expect(readStoredName(7)).toBeNull()
    // The 80th and 81st units are one emoji: the cut stops before it.
    expect(readStoredName(`${'x'.repeat(79)}🚀 launch`)).toEqual({ name: 'x'.repeat(79), cut: true })
    expect(readStoredName(`${'x'.repeat(78)}🚀 launch`)).toEqual({ name: `${'x'.repeat(78)}🚀`, cut: true })
    expect(readStoredName('x'.repeat(12), 10)).toEqual({ name: 'x'.repeat(10), cut: true })
  })
})
