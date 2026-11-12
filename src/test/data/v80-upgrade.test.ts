import { describe, expect, it } from 'vitest'
import { upgradeV80 } from '../../data/upgrades/v80'
import { CURRENT_DB_VERSION } from '../../data/database'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { rowFixes, validateRow } from '../../data/import-validation'
import { emptyPredicate } from '../../models/filter-predicate'
import { formatCheckinFilterSetting } from '../../data/checkin-filter-shape'

/**
 * v80 — check-ins by copy (2026-11-12): every person without an email, the
 * `checkinOpenMethod` settings row deleted. The transform's own tests, then
 * the pipeline from v79 and from the floor; the real ways in (the browser
 * database's own upgrade, an import, a backup, an append import, an export
 * round trip) are `v80-real-paths.test`, the sync file `file-storage.test`.
 */

const DATE = '2026-11-01T09:00:00.000Z'
const FILTER = formatCheckinFilterSetting({ ...emptyPredicate(), searchText: 'review' })

describe('v80: registered', () => {
  it('is the current schema, after v79', () => {
    expect(CURRENT_DB_VERSION).toBe(80)
    expect(SCHEMA_UPGRADES.get(80)).toBe(upgradeV80)
  })
})

describe('v80: people and settings', () => {
  it('every person loses their email; the rest of the row stays', () => {
    const out = upgradeV80({
      people: [
        { id: 1, name: 'Ada Lovelace', initials: 'AL', color: '#336699', email: 'ada@example.com' },
        { id: 2, name: 'Bob Stone', initials: 'BS', email: '' },
        { id: 3, name: 'Cy Young', initials: 'CY' },
      ],
    })
    expect(out.people).toEqual([
      { id: 1, name: 'Ada Lovelace', initials: 'AL', color: '#336699' },
      { id: 2, name: 'Bob Stone', initials: 'BS' },
      { id: 3, name: 'Cy Young', initials: 'CY' },
    ])
    for (const row of out.people!) {
      expect(validateRow('people', row)).toBe(true)
      expect(rowFixes('people', row)).toEqual([])
    }
  })

  it('the open method row goes; the check-in filter and every other row stay, in order', () => {
    const out = upgradeV80({
      settings: [
        { key: 'historyLogSince', value: DATE },
        { key: 'checkinOpenMethod', value: 'eml' },
        { key: 'checkinTaskFilter', value: FILTER },
        { key: 'weekStartsOn', value: '1' },
      ],
    })
    expect(out.settings).toEqual([
      { key: 'historyLogSince', value: DATE },
      { key: 'checkinTaskFilter', value: FILTER },
      { key: 'weekStartsOn', value: '1' },
    ])
  })
})

describe('v80: the contract', () => {
  function v79(): DataSet {
    return {
      todos: [{ id: 1, uid: 'u1', title: 'T', isCompleted: false, sortOrder: 0, createdAt: DATE, modifiedAt: DATE }],
      todoEvents: [{ id: 1, todoId: 1, type: 'created', fromValue: null, toValue: null, timestamp: DATE }],
      todoPeople: [{ id: 1, todoId: 1, personId: 1 }],
      people: [{ id: 1, name: 'Ada', initials: 'A', email: 'ada@example.com' }],
      settings: [{ key: 'historyLogSince', value: DATE }, { key: 'checkinOpenMethod', value: 'mailto' }],
    }
  }

  it('pure and idempotent: the input untouched; run again, the same object back', () => {
    const input = v79()
    const before = JSON.stringify(input)
    const once = upgradeV80(input)
    expect(JSON.stringify(input)).toBe(before)
    expect(once).not.toBe(input)
    expect(upgradeV80(once)).toBe(once)
  })

  it('touches no task, no assignment, no history and not the history log’s start', () => {
    const input = v79()
    const out = upgradeV80(input)
    expect(out.todos).toBe(input.todos)
    expect(out.todoEvents).toBe(input.todoEvents)
    expect(out.todoPeople).toBe(input.todoPeople)
    expect(out.settings).toEqual([{ key: 'historyLogSince', value: DATE }])
  })

  it('a table with nothing to change comes back as the same array', () => {
    const input: DataSet = { people: [{ id: 1, name: 'Ada', initials: 'A' }], settings: [{ key: 'weekStartsOn', value: '0' }] }
    const out = upgradeV80(input)
    expect(out).toBe(input)
  })

  it('tolerates missing tables and malformed rows (left for validation)', () => {
    const empty: DataSet = {}
    expect(upgradeV80(empty)).toBe(empty)
    const tasksOnly: DataSet = { todos: [{ id: 1 }] }
    expect(upgradeV80(tasksOnly)).toBe(tasksOnly)
    const odd: DataSet = {
      people: [null as unknown as DataRow, 7 as unknown as DataRow, { id: 1, name: 'Ada', initials: 'A', email: 3 }],
      settings: [null as unknown as DataRow, { key: 'checkinOpenMethod', value: 9 }, { value: 'x' }],
    }
    const out = upgradeV80(odd)
    expect(out.people).toEqual([null, 7, { id: 1, name: 'Ada', initials: 'A' }])
    expect(out.settings).toEqual([null, { value: 'x' }])
  })
})

describe('v80 through the pipeline', () => {
  it('a v79 file imports without the addresses or the open method, and no warning about them', () => {
    const result = prepareImport(JSON.parse(JSON.stringify(v79File())))
    if (!result.ok) throw new Error(result.error)
    expect(result.upgraded).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.data.people).toEqual([
      { id: 1, name: 'Ada Lovelace', initials: 'AL', color: '#336699' },
      { id: 2, name: 'Bob Stone', initials: 'BS' },
    ])
    expect(result.data.settings.map((s) => s.key)).toEqual(['checkinTaskFilter'])
  })

  it('a v80 file holding an email on a person reads without it, as any key the row doesn’t have', () => {
    const result = prepareImport({ ...JSON.parse(JSON.stringify(v79File())) as object, [SCHEMA_VERSION_KEY]: 80 })
    if (!result.ok) throw new Error(result.error)
    expect(result.upgraded).toBe(false)
    expect(result.data.people.every((p) => !('email' in p))).toBe(true)
    // An open method row in a v80 file is a key this build doesn't know: dropped.
    expect(result.data.settings.map((s) => s.key)).toEqual(['checkinTaskFilter'])
  })

  it('a file at the floor (v68) runs the whole chain to v80', () => {
    const file = { ...v79File(), [SCHEMA_VERSION_KEY]: 68 }
    const result = prepareImport(JSON.parse(JSON.stringify(file)))
    if (!result.ok) throw new Error(result.error)
    expect(result.sourceVersion).toBe(68)
    expect(result.data.people.every((p) => !('email' in p))).toBe(true)
    expect(result.data.settings.map((s) => s.key)).toEqual(['checkinTaskFilter'])
    const chained = upgradeDataSet(JSON.parse(JSON.stringify(file)) as DataSet, 68, CURRENT_DB_VERSION)
    expect(chained.people!.every((p) => !('email' in p))).toBe(true)
  })
})

/** A v79 export with addresses on people and the open method row. */
function v79File(): Record<string, unknown> {
  return {
    [SCHEMA_VERSION_KEY]: 79,
    todos: [{ id: 1, uid: 'u1', title: 'Kept', isCompleted: false, sortOrder: 0, createdAt: DATE, modifiedAt: DATE }],
    people: [
      { id: 1, name: 'Ada Lovelace', initials: 'AL', color: '#336699', email: 'ada@example.com' },
      { id: 2, name: 'Bob Stone', initials: 'BS', email: 'not an address' },
    ],
    todoPeople: [{ id: 1, todoId: 1, personId: 1 }],
    settings: [{ key: 'checkinOpenMethod', value: 'eml' }, { key: 'checkinTaskFilter', value: FILTER }],
  }
}
