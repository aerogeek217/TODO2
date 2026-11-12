import { describe, it, expect } from 'vitest'
import { checkLayoutBody, pickLayoutBody } from '../../data/layout-shape'
import { validateRow } from '../../data/import-validation'

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

  it('a layout row from a file: import validates the new fields', () => {
    const row = { id: 1, name: 'Daily', sortOrder: 0, createdAt: DATE, modifiedAt: DATE }
    expect(validateRow('layouts', { ...row, ...body({ icon: { kind: 'emoji', emoji: '📅' }, name: 'Plan' }) })).toBe(true)
    expect(validateRow('layouts', { ...row, ...body({ icon: { kind: 'emoji', emoji: 'x' } }) })).not.toBe(true)
  })
})
