import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SchemaUpgrade } from '../../data/schema-upgrades'

/**
 * Written when the production registry was empty (CURRENT === floor, 49):
 * simulates a build at CURRENT = 51 with *test* v50 + v51 transforms to prove
 * `prepareImport` routes floor ≤ v < CURRENT files through `upgradeDataSet`
 * before validating. The real transforms are tested in `v50-*.test.ts` /
 * `v51-*.test.ts`; rows here carry a `uid` because the current validator
 * requires one and the test registry doesn't mint it.
 */
vi.mock('../../data/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/database')>()),
  CURRENT_DB_VERSION: 51,
}))

const testRegistry = new Map<number, SchemaUpgrade>([
  // v50: rename a legacy field so the current-shape validator accepts the row.
  [50, (d) => ({
    ...d,
    todos: (d.todos ?? []).map(({ name, ...rest }) => (name !== undefined ? { ...rest, title: name } : rest)),
  })],
  // v51: cross-table — must tolerate a missing table.
  [51, (d) => (d.people ? { ...d, people: d.people.map((p) => ({ ...p, initials: String(p.initials ?? 'XX') })) } : d)],
])
// Restored before each test, so one that swaps in a step (the throwing v51
// below) can't leak into whichever test runs next.
const defaultSteps = new Map(testRegistry)

vi.mock('../../data/schema-upgrades', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/schema-upgrades')>()
  return {
    ...actual,
    upgradeDataSet: (data: Parameters<typeof actual.upgradeDataSet>[0], from: number, to: number) =>
      actual.upgradeDataSet(data, from, to, testRegistry),
  }
})

const { prepareImport } = await import('../../data/import-pipeline')

const now = new Date().toISOString()
const base = {
  canvases: [{ id: 1, name: 'Main', sortOrder: 0, createdAt: now }],
}

describe('prepareImport — upgrade path (simulated CURRENT = 51)', () => {
  beforeEach(() => {
    testRegistry.clear()
    for (const [version, step] of defaultSteps) testRegistry.set(version, step)
  })

  it('upgrades a v49 file through v50 + v51 before validating', () => {
    const result = prepareImport({
      __schemaVersion: 49,
      ...base,
      todos: [{ id: 1, uid: 'u1', name: 'Legacy title', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 0 }],
      people: [{ id: 1, name: 'Ann' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.upgraded).toBe(true)
    expect(result.legacy).toBeNull()
    expect(result.data.todos[0]?.title).toBe('Legacy title')
    expect(result.data.people[0]?.initials).toBe('XX')
  })

  it('runs only the steps above the file version (v50 file skips v50)', () => {
    const result = prepareImport({
      __schemaVersion: 50,
      ...base,
      // A v50 file is already renamed; an un-renamed row proves v50 did not run.
      todos: [{ id: 1, uid: 'u1', name: 'x', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 0 }],
    })
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('tolerates partial datasets (no people table)', () => {
    const result = prepareImport({ __schemaVersion: 49, ...base })
    expect(result.ok).toBe(true)
  })

  it('treats a below-floor file as floor-shaped after confirmation (runs every step)', () => {
    const result = prepareImport({
      __schemaVersion: 40,
      ...base,
      todos: [{ id: 1, uid: 'u1', name: 'Old', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 0 }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.legacy?.sourceVersion).toBe(40)
    expect(result.data.todos[0]?.title).toBe('Old')
  })

  it('rejects a v52 file as too new', () => {
    expect(prepareImport({ __schemaVersion: 52, ...base })).toMatchObject({ ok: false, reason: 'too-new' })
  })

  it('a malformed (non-array) table still reaches validation even if a transform defaults it', () => {
    // v50 maps `d.todos ?? []`, i.e. it materializes an absent table as [].
    const result = prepareImport({ __schemaVersion: 49, ...base, todos: 'boom' })
    expect(result).toEqual({ ok: false, reason: 'invalid', error: '"todos" is not an array' })
  })

  it('surfaces a throwing transform as upgrade-failed', () => {
    testRegistry.set(51, () => { throw new Error('kaboom') })
    const failed = prepareImport({ __schemaVersion: 49, ...base })
    expect(failed).toMatchObject({ ok: false, reason: 'upgrade-failed' })
    if (failed.ok) return
    expect(failed.error).toContain('kaboom')
  })
})
