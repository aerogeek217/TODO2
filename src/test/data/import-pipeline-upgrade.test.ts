import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DataSet, SchemaUpgrade } from '../../data/schema-upgrades'

/**
 * The upgrade pipeline, kept exercised while the registry has no entries:
 * the build after this one (`NEXT` = this build's version + 1) with a
 * synthetic step for `NEXT`, injected as the registry. Proves a file at the
 * floor goes through the step before validation (`prepareImport`), and
 * that a database this build made, opened by a build declaring `NEXT`,
 * gets exactly the rows the import gets (`applySchemaUpgradeInTx`).
 */
const versions = vi.hoisted(() => ({ next: 0 }))
vi.mock('../../data/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/database')>()
  versions.next = actual.CURRENT_DB_VERSION + 1
  return { ...actual, CURRENT_DB_VERSION: versions.next }
})

const testRegistry = new Map<number, SchemaUpgrade>()
vi.mock('../../data/schema-upgrades', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/schema-upgrades')>()
  return {
    ...actual,
    upgradeDataSet: (data: Parameters<typeof actual.upgradeDataSet>[0], from: number, to: number) =>
      actual.upgradeDataSet(data, from, to, testRegistry),
  }
})

const { prepareImport } = await import('../../data/import-pipeline')
const { applySchemaUpgradeInTx, upgradeDataSet } = await vi.importActual<typeof import('../../data/schema-upgrades')>('../../data/schema-upgrades')
const { Todo2Database, OLDEST_SUPPORTED_DB_VERSION: FLOOR, db } = await import('../../data/database')
/** This build's own version (the database it makes). */
const THIS_BUILD = db.verno
const NEXT = versions.next

/**
 * The synthetic step: renames a task's `name` to `title` (a field the
 * validator needs) and gives people without initials `XX` — cross-table,
 * and tolerant of a missing table.
 */
const nextStep: SchemaUpgrade = (d) => ({
  ...d,
  todos: (d.todos ?? []).map(({ name, ...rest }) => (name !== undefined ? { ...rest, title: name } : rest)),
  ...(d.people ? { people: d.people.map((p) => ({ ...p, initials: String(p.initials ?? 'XX') })) } : {}),
})

const now = new Date().toISOString()
const base = { todos: [], settings: [] }
const oldTodo = { id: 1, uid: 'u1', name: 'Old title', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 0 }

beforeEach(() => {
  testRegistry.clear()
  testRegistry.set(NEXT, nextStep)
})

describe(`prepareImport — the next build's step (simulated CURRENT = this build + 1)`, () => {
  it('upgrades a file at the floor through the step before validating', () => {
    const result = prepareImport({ __schemaVersion: FLOOR, ...base, todos: [oldTodo], people: [{ id: 1, name: 'Ann' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result).toMatchObject({ sourceVersion: FLOOR, upgraded: true })
    expect(result.data.todos[0]?.title).toBe('Old title')
    expect(result.data.people[0]?.initials).toBe('XX')
  })

  it('runs only the steps above the file version (a file at NEXT skips the step)', () => {
    // An un-renamed row proves the step did not run: the validator rejects it.
    expect(prepareImport({ __schemaVersion: NEXT, ...base, todos: [oldTodo] })).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('tolerates partial datasets (no people table)', () => {
    expect(prepareImport({ __schemaVersion: FLOOR, ...base }).ok).toBe(true)
  })

  it('refuses a file below the floor without running any step', () => {
    const step = vi.fn(nextStep)
    testRegistry.set(NEXT, step)
    expect(prepareImport({ __schemaVersion: FLOOR - 1, ...base, todos: [oldTodo] })).toMatchObject({ ok: false, reason: 'too-old' })
    expect(step).not.toHaveBeenCalled()
  })

  it('rejects a file newer than the build as too new', () => {
    expect(prepareImport({ __schemaVersion: NEXT + 1, ...base })).toMatchObject({ ok: false, reason: 'too-new' })
  })

  it('a malformed (non-array) table still reaches validation even if the step defaults it', () => {
    // The step maps `d.todos ?? []`, i.e. it materializes an absent table as [].
    // (Append: a restore would stop earlier, at "missing tasks or settings".)
    const result = prepareImport({ __schemaVersion: FLOOR, ...base, todos: 'boom' }, { purpose: 'append' })
    expect(result).toEqual({ ok: false, reason: 'invalid', error: '"todos" is not an array' })
    expect(prepareImport({ __schemaVersion: FLOOR, ...base, todos: 'boom' })).toEqual({
      ok: false, reason: 'invalid', error: 'File is not a valid TODO2 database (missing tasks or settings)',
    })
  })

  it('surfaces a throwing step as upgrade-failed', () => {
    testRegistry.set(NEXT, () => { throw new Error('kaboom') })
    const failed = prepareImport({ __schemaVersion: FLOOR, ...base })
    expect(failed).toMatchObject({ ok: false, reason: 'upgrade-failed' })
    if (failed.ok) return
    expect(failed.error).toContain('kaboom')
  })
})

describe('the Dexie upgrade runs the same step', () => {
  /** This build's database with the next build's version declared after it, its upgrade through the registry. */
  class NextBuildDatabase extends Todo2Database {
    constructor() {
      super()
      this.version(NEXT).stores({}).upgrade((tx) => applySchemaUpgradeInTx(tx, NEXT, testRegistry))
    }
  }
  let next: NextBuildDatabase | null = null

  afterEach(async () => {
    next?.close()
    next = null
    db.close()
    await db.delete()
  })

  it('a database this build made, opened by the next build, holds what the import of the same rows holds', async () => {
    const created = new Date('2026-10-20T09:00:00.000Z')
    const todos = [{ id: 1, uid: 'u1', name: 'Old title', isCompleted: false, createdAt: created, modifiedAt: created, sortOrder: 0 }]
    const people = [{ id: 1, name: 'Ann' }, { id: 2, name: 'Bo', initials: 'BO' }]
    await db.open()
    await db.table('todos').bulkAdd(todos)
    await db.table('people').bulkAdd(people)
    db.close()

    next = new NextBuildDatabase()
    await next.open()
    expect(next.backendDB().version).toBe(NEXT * 10)

    const expected: DataSet = upgradeDataSet({ todos, people }, THIS_BUILD, NEXT, testRegistry)
    expect(await next.table('todos').toArray()).toEqual(expected.todos)
    expect(await next.table('people').toArray()).toEqual(expected.people)
    expect(expected.todos?.[0]?.title).toBe('Old title')
  })
})
