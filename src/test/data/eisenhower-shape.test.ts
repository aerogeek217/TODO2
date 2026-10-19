import { describe, it, expect } from 'vitest'
import { rowFixes, sanitizeRow, validateImportData, validateRow } from '../../data/import-validation'
import {
  checkPanes,
  formatEisenhowerSource,
  formatPanesSetting,
  parseEisenhowerSource,
  pickPanes,
  readPanesSetting,
} from '../../data/eisenhower-shape'

const filter = (extra: Record<string, unknown>) => ({ showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, ...extra })

const PANES = {
  delegate: { name: 'Hand off', filter: filter({ markers: { urgent: true, important: false }, statusIds: [4], negate: { statusIds: true } }) },
  drop: { name: 'Someday' },
}

const panesRow = (value: unknown) => ({ key: 'eisenhowerPanes', value: typeof value === 'string' ? value : JSON.stringify(value) })

function importSettings(settings: unknown[]) {
  return validateImportData({ todos: [], settings })
}

describe('the eisenhowerPanes setting', () => {
  it('import keeps the panes’ names and filters as stored', () => {
    const row = panesRow(PANES)
    expect(validateRow('settings', row)).toBe(true)
    expect(rowFixes('settings', row)).toEqual([])
    const res = importSettings([row])
    if (!res.ok) throw new Error(res.error)
    expect(res.warnings).toEqual([])
    expect(res.data.settings).toEqual([row])
  })

  it('a name or filter equal to the default, a blank name and an empty pane are left out; names are one trimmed line', () => {
    const row = panesRow({
      do: { name: ' Do ', filter: filter({ markers: { important: true, urgent: true } }) },
      schedule: { name: '   ' },
      delegate: {},
      drop: { name: '  Later\nsoon ', filter: filter({ showCompleted: true, markers: { urgent: false, important: false } }) },
    })
    expect(rowFixes('settings', row)).toEqual([])
    expect(sanitizeRow('settings', row)).toEqual(panesRow({ drop: { name: 'Later soon' } }))
  })

  it('has no length limit (names and filters have none)', () => {
    const row = panesRow({ drop: { name: 'n'.repeat(5000) } })
    expect(validateRow('settings', row)).toBe(true)
  })

  it('drops unknown panes, unknown keys and malformed filter clauses with a warning', () => {
    const row = panesRow({
      later: { name: 'Later' },
      do: { name: 'Now', colour: 'red', filter: filter({ personIds: ['ann'], markers: { urgent: true, important: true } }) },
    })
    expect(validateRow('settings', row)).toBe(true)
    expect(rowFixes('settings', row)).toEqual(['3 Eisenhower pane settings dropped'])
    const res = importSettings([row])
    if (!res.ok) throw new Error(res.error)
    expect(res.warnings).toEqual(['Fixed settings: Eisenhower panes (3 Eisenhower pane settings dropped)'])
    expect(res.data.settings).toEqual([panesRow({ do: { name: 'Now' } })])
  })

  it.each([
    ['not JSON', '{oops', 'not JSON'],
    ['not an object', ['do'], 'panes'],
    ['a pane not an object', { do: 'Now' }, 'do'],
    ['a name not a string', { do: { name: 7 } }, 'do.name'],
    ['a filter without its core shape', { drop: { filter: { showCompleted: false, searchText: '' } } }, 'drop.filter.dates'],
  ])('fails the import when %s', (_what, value, bad) => {
    const res = importSettings([panesRow(value)])
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain(`value (eisenhowerPanes: ${bad})`)
  })

  it('the store’s lenient read resets what the check rejects and keeps the rest', () => {
    expect(readPanesSetting('{oops')).toEqual({ panes: {}, fixes: ['Eisenhower panes reset'] })
    expect(readPanesSetting(JSON.stringify({ do: 'Now', drop: { name: 7 }, schedule: { name: 'Later' } }))).toEqual({
      panes: { schedule: { name: 'Later' } },
      fixes: ['2 Eisenhower panes reset'],
    })
    expect(pickPanes(null)).toEqual({ panes: {}, fixes: ['Eisenhower pane reset'] })
    expect(checkPanes(PANES)).toBe(true)
  })

  it('is written in its stored form: positions in order, only what differs', () => {
    expect(formatPanesSetting({ drop: { name: 'Someday' }, do: { name: 'Do' } })).toBe('{"drop":{"name":"Someday"}}')
    expect(formatPanesSetting({})).toBe('{}')
  })
})

describe('the eisenhowerSource setting', () => {
  it('reads list:<id> as that list and all as all tasks; anything else is unreadable', () => {
    expect(parseEisenhowerSource('list:3')).toBe(3)
    expect(parseEisenhowerSource('all')).toBeNull()
    for (const bad of ['list:', 'list:0', 'list:-1', 'list:1.5', 'list:01', 'list:x', 'Team', '3', 'list:99999999999999999']) {
      expect(parseEisenhowerSource(bad), bad).toBeUndefined()
    }
    expect(formatEisenhowerSource(12)).toBe('list:12')
  })

  it('import keeps a readable one and fails on an unreadable one', () => {
    const ok = importSettings([{ key: 'eisenhowerSource', value: 'list:3' }])
    expect(ok).toMatchObject({ ok: true, warnings: [] })
    const bad = importSettings([{ key: 'eisenhowerSource', value: 'Team' }])
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('eisenhowerSource must be all or list:<id>')
  })
})
