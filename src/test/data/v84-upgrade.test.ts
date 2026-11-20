import { describe, expect, it } from 'vitest'
import { upgradeV84 } from '../../data/upgrades/v84'
import { CURRENT_DB_VERSION } from '../../data/database'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { validateRow } from '../../data/import-validation'

/**
 * v84 — a repeat is any interval: each task's `recurrenceRule` `{ type }`
 * becomes `{ every: { count, unit } }`, its kept day of the month as it was.
 * The transform's own tests, then the pipeline.
 */

const DATE = '2026-11-01T09:00:00.000Z'
const DUE = '2026-11-30T06:00:00.000Z'
const task = (id: number, extra: DataRow = {}): DataRow => ({
  id, uid: `u${id}`, title: `T${id}`, isCompleted: false, sortOrder: id, createdAt: DATE, modifiedAt: DATE, dueDate: DUE, ...extra,
})
const ruleOf = (data: DataSet, i: number) => (data.todos![i] as { recurrenceRule?: unknown }).recurrenceRule

describe('v84: registered', () => {
  it('is registered after v83', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(84)
    expect(SCHEMA_UPGRADES.get(84)).toBe(upgradeV84)
  })
})

describe('v84: each fixed repeat as its interval', () => {
  it.each([
    ['daily', { count: 1, unit: 'd' }],
    ['weekly', { count: 1, unit: 'w' }],
    ['biweekly', { count: 2, unit: 'w' }],
    ['monthly', { count: 1, unit: 'm' }],
    ['quarterly', { count: 3, unit: 'm' }],
    ['yearly', { count: 1, unit: 'y' }],
  ])('%s → %o', (type, every) => {
    const out = upgradeV84({ todos: [task(1, { recurrenceRule: { type } })] })
    expect(ruleOf(out, 0)).toEqual({ every })
  })

  it('keeps the day of the month a month or year rule kept, and the rest of the task as it was (modifiedAt too)', () => {
    const row = task(1, { recurrenceRule: { type: 'monthly', originalDayOfMonth: 31 }, notes: 'n' })
    const out = upgradeV84({ todos: [row] })
    expect(out.todos![0]).toEqual({ ...row, recurrenceRule: { every: { count: 1, unit: 'm' }, originalDayOfMonth: 31 } })
  })

  it('leaves a task without a repeat, and a type this build never wrote (for validation to refuse), as they were', () => {
    const plain = task(1)
    const odd = task(2, { recurrenceRule: { type: 'hourly' } })
    const out = upgradeV84({ todos: [plain, odd, task(3, { recurrenceRule: { type: 'weekly' } })] })
    expect(out.todos![0]).toBe(plain)
    expect(out.todos![1]).toBe(odd)
    expect(validateRow('todos', out.todos![1]!)).toBe('recurrenceRule')
    expect(validateRow('todos', out.todos![2]!)).toBe(true)
  })
})

describe('v84: the contract', () => {
  it('pure and idempotent: the input untouched; run again, the same object back', () => {
    const data: DataSet = { todos: [task(1, { recurrenceRule: { type: 'quarterly', originalDayOfMonth: 15 } })] }
    const before = JSON.parse(JSON.stringify(data)) as DataSet
    const once = upgradeV84(data)
    expect(data).toEqual(before)
    expect(once).not.toBe(data)
    expect(upgradeV84(once)).toBe(once)
  })

  it('touches no other table; with nothing to convert, the dataset comes back as it was', () => {
    const layouts: DataRow[] = [{ id: 1, name: 'L' }]
    const settings: DataRow[] = [{ key: 'staleAfterDays', value: '30' }]
    const out = upgradeV84({ todos: [task(1, { recurrenceRule: { type: 'daily' } })], layouts, settings })
    expect(out.layouts).toBe(layouts)
    expect(out.settings).toBe(settings)
    const none: DataSet = { todos: [task(1)], layouts }
    expect(upgradeV84(none)).toBe(none)
  })

  it('tolerates missing tables and malformed rows', () => {
    const empty: DataSet = {}
    expect(upgradeV84(empty)).toBe(empty)
    const odd: DataSet = { todos: [null as unknown as DataRow, task(2, { recurrenceRule: 'weekly' }), task(3, { recurrenceRule: { type: 7 } })] }
    expect(upgradeV84(odd)).toBe(odd)
  })
})

describe('v84 through the pipeline', () => {
  const v83File = () => ({
    [SCHEMA_VERSION_KEY]: 83,
    todos: [
      task(1, { recurrenceRule: { type: 'biweekly' } }),
      task(2, { recurrenceRule: { type: 'yearly', originalDayOfMonth: 29 } }),
    ],
    settings: [{ key: 'weekStartsOn', value: '1' }],
  })

  it('a v83 file imports with its repeats as intervals, and no warning', () => {
    const result = prepareImport(JSON.parse(JSON.stringify(v83File())))
    if (!result.ok) throw new Error(result.error)
    expect(result.upgraded).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.data.todos.map((t) => t.recurrenceRule)).toEqual([
      { every: { count: 2, unit: 'w' } },
      { every: { count: 1, unit: 'y' }, originalDayOfMonth: 29 },
    ])
  })

  it('the registry runs it from v83 to the current version', () => {
    const chained = upgradeDataSet(JSON.parse(JSON.stringify(v83File())) as DataSet, 83, CURRENT_DB_VERSION)
    expect(ruleOf(chained, 0)).toEqual({ every: { count: 2, unit: 'w' } })
  })

  it('a v84 file with an old typed rule is refused by validation (the step ran before it was written)', () => {
    const result = prepareImport({ ...JSON.parse(JSON.stringify(v83File())), [SCHEMA_VERSION_KEY]: 84 })
    expect(result.ok).toBe(false)
  })
})
