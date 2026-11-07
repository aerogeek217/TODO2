import { describe, it, expect } from 'vitest'
import { rowFixes, sanitizeRow, validateImportData, validateRow } from '../../data/import-validation'
import {
  formatEisenhowerSource,
  formatPanesSetting,
  PANES_SETTING_MAX_LEN,
  parseEisenhowerSource,
  pickPanes,
  readPanesSetting,
} from '../../data/eisenhower-shape'

const filter = (extra: Record<string, unknown>) => ({ showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, ...extra })

const PANES = {
  delegate: { name: 'Hand off', filter: filter({ markers: [{ values: ['urgent'] }, { values: ['important'], not: true }], statusIds: [4], negate: { statusIds: true } }) },
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
      do: { name: ' Do ', filter: filter({ markers: [{ values: ['urgent'] }, { values: ['important'] }] }) },
      schedule: { name: '   ' },
      delegate: {},
      drop: { name: '  Later\nsoon ', filter: filter({ showCompleted: true, markers: [{ values: ['urgent', 'important'], not: true }] }) },
    })
    expect(rowFixes('settings', row)).toEqual([])
    expect(sanitizeRow('settings', row)).toEqual(panesRow({ drop: { name: 'Later soon' } }))
  })

  it('reads a pane filter’s old or groups into an expression; a malformed one is dropped with a warning', () => {
    const group = { personIds: [2], statusIds: null, searchText: '', dates: {}, markers: null, tags: [3] }
    const row = panesRow({ do: { filter: filter({ markers: [{ values: ['urgent'] }], orGroups: [group] }) } })
    const asExpression = panesRow({ do: { filter: filter({ markers: null, tags: null, expression: { kind: 'and', items: [{ kind: 'priority', value: 'urgent' }, { kind: 'or', items: [{ kind: 'tag', id: 3 }, { kind: 'person', id: 2 }] }] } }) } })
    expect(rowFixes('settings', row)).toEqual([])
    expect(sanitizeRow('settings', row)).toEqual(asExpression)
    expect(sanitizeRow('settings', asExpression)).toEqual(asExpression)
    const bad = panesRow({ do: { filter: filter({ markers: [{ values: ['urgent'] }], orGroups: [group, 4] }) } })
    expect(rowFixes('settings', bad)).toEqual(['Eisenhower pane setting dropped'])
    expect(sanitizeRow('settings', bad)).toEqual(asExpression)
  })

  it('has no length limit (names and filters have none)', () => {
    const row = panesRow({ drop: { name: 'n'.repeat(5000) } })
    expect(validateRow('settings', row)).toBe(true)
  })

  it('drops unknown panes, unknown keys and malformed filter clauses with a warning', () => {
    const row = panesRow({
      later: { name: 'Later' },
      do: { name: 'Now', colour: 'red', filter: filter({ personIds: ['ann'], markers: [{ values: ['urgent'] }, { values: ['important'] }] }) },
    })
    expect(validateRow('settings', row)).toBe(true)
    expect(rowFixes('settings', row)).toEqual(['3 Eisenhower pane settings dropped'])
    const res = importSettings([row])
    if (!res.ok) throw new Error(res.error)
    expect(res.warnings).toEqual(['Fixed settings: Eisenhower panes (3 Eisenhower pane settings dropped)'])
    expect(res.data.settings).toEqual([panesRow({ do: { name: 'Now' } })])
  })

  it.each([
    ['not JSON', '{oops', 'Eisenhower panes reset'],
    ['not an object', ['do'], 'Eisenhower pane reset'],
    ['a pane not an object', { do: 'Now' }, 'Eisenhower pane reset'],
    ['a name not a string', { do: { name: 7 } }, 'Eisenhower pane reset'],
    ['a filter without its core shape', { drop: { filter: { showCompleted: false, searchText: '' } } }, 'Eisenhower pane reset'],
    ['over a million characters', JSON.stringify({ drop: { name: 'n'.repeat(PANES_SETTING_MAX_LEN) } }), 'Eisenhower panes too long — reset'],
  ])('import resets what it can’t read, with a warning, and keeps the file: %s', (_what, value, fix) => {
    const res = importSettings([panesRow(value)])
    if (!res.ok) throw new Error(res.error)
    expect(res.warnings).toEqual([`Fixed settings: Eisenhower panes (${fix})`])
    expect(res.data.settings).toEqual([panesRow({})])
  })

  it('a pane it can’t read is reset; the other panes are kept', () => {
    const res = importSettings([panesRow({ do: 'Now', drop: { name: 'Someday' } })])
    if (!res.ok) throw new Error(res.error)
    expect(res.warnings).toEqual(['Fixed settings: Eisenhower panes (Eisenhower pane reset)'])
    expect(res.data.settings).toEqual([panesRow({ drop: { name: 'Someday' } })])
  })

  it('a value up to a million characters is read (no name limit below that)', () => {
    const name = 'n'.repeat(PANES_SETTING_MAX_LEN - 100)
    expect(readPanesSetting(JSON.stringify({ drop: { name } }))).toEqual({ panes: { drop: { name } }, fixes: [] })
  })

  it('the store’s lenient read resets what the check rejects and keeps the rest', () => {
    expect(readPanesSetting('{oops')).toEqual({ panes: {}, fixes: ['Eisenhower panes reset'] })
    expect(readPanesSetting(JSON.stringify({ do: 'Now', drop: { name: 7 }, schedule: { name: 'Later' } }))).toEqual({
      panes: { schedule: { name: 'Later' } },
      fixes: ['2 Eisenhower panes reset'],
    })
    expect(pickPanes(null)).toEqual({ panes: {}, fixes: ['Eisenhower pane reset'] })
    expect(pickPanes(PANES)).toEqual({ panes: PANES, fixes: [] })
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
