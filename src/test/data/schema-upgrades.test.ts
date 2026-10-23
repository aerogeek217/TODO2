import { describe, it, expect, beforeEach } from 'vitest'
import Dexie from 'dexie'
import {
  SCHEMA_UPGRADES,
  upgradeDataSet,
  applySchemaUpgradeInTx,
  type DataSet,
  type SchemaUpgrade,
} from '../../data/schema-upgrades'
import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION } from '../../data/database'

describe('SCHEMA_UPGRADES registry', () => {
  it('only holds versions above the floor and at or below CURRENT_DB_VERSION', () => {
    for (const v of SCHEMA_UPGRADES.keys()) {
      expect(v, `registry entry v${v}`).toBeGreaterThan(OLDEST_SUPPORTED_DB_VERSION)
      expect(v, `registry entry v${v}`).toBeLessThanOrEqual(CURRENT_DB_VERSION)
    }
  })

  it('pins the floor at 68', () => {
    expect(OLDEST_SUPPORTED_DB_VERSION).toBe(68)
  })
})

describe('upgradeDataSet', () => {
  const registry = new Map<number, SchemaUpgrade>([
    [51, (d) => ({ ...d, todos: (d.todos ?? []).map((t) => ({ ...t, trail: `${String(t.trail ?? '')}51` })) })],
    [52, (d) => ({ ...d, todos: (d.todos ?? []).map((t) => ({ ...t, trail: `${String(t.trail ?? '')}52` })) })],
    // 53 has no entry → identity step
    [54, (d) => ({ ...d, todos: (d.todos ?? []).map((t) => ({ ...t, trail: `${String(t.trail ?? '')}54` })) })],
  ])

  it('applies fromVersion+1 … toVersion in order, skipping versions with no entry', () => {
    const out = upgradeDataSet({ todos: [{ id: 1 }] }, 50, 54, registry)
    expect(out.todos).toEqual([{ id: 1, trail: '515254' }])
  })

  it('starts after fromVersion (does not re-run the source version)', () => {
    const out = upgradeDataSet({ todos: [{ id: 1 }] }, 51, 52, registry)
    expect(out.todos).toEqual([{ id: 1, trail: '52' }])
  })

  it('returns the input unchanged when already at the target', () => {
    const data: DataSet = { todos: [{ id: 1 }] }
    expect(upgradeDataSet(data, 54, 54, registry)).toBe(data)
  })

  it('does not mutate the input', () => {
    const data: DataSet = { todos: [{ id: 1 }] }
    upgradeDataSet(data, 50, 54, registry)
    expect(data).toEqual({ todos: [{ id: 1 }] })
  })

  it('tolerates missing tables (partial datasets)', () => {
    const out = upgradeDataSet({ people: [{ id: 1 }] }, 50, 54, registry)
    expect(out.people).toEqual([{ id: 1 }])
    expect(out.todos).toEqual([])
  })

  it('is the identity with the production registry at CURRENT', () => {
    const data: DataSet = { todos: [{ id: 1 }] }
    expect(upgradeDataSet(data, CURRENT_DB_VERSION, CURRENT_DB_VERSION)).toBe(data)
  })
})

/**
 * Dexie-side helper. Uses a throwaway database (not `todo2`) so the probe
 * schema can drop / add tables freely.
 */
describe('applySchemaUpgradeInTx (Dexie)', () => {
  const DB_NAME = 'todo2-schema-upgrade-probe'

  beforeEach(async () => {
    await Dexie.delete(DB_NAME)
  })

  async function seedV1(): Promise<void> {
    const v1 = new Dexie(DB_NAME)
    v1.version(1).stores({ orgs: '++id', people: '++id', untouched: '++id', backups: '++id' })
    await v1.open()
    await v1.table('orgs').bulkAdd([{ id: 7, name: 'Acme' }, { id: 9, name: 'Globex' }])
    await v1.table('people').bulkAdd([{ id: 3, name: 'Ann' }])
    await v1.table('untouched').bulkAdd([{ id: 1, v: 'keep' }])
    await v1.table('backups').bulkAdd([{ id: 1, data: '{}' }])
    v1.close()
  }

  it('reads a table dropped in the same version: upgrade runs before the drop', async () => {
    await seedV1()

    let seen: DataSet | null = null
    // v2: drop `orgs`; fold each org into `people` as "Org: <name>".
    const registry = new Map<number, SchemaUpgrade>([[2, (d) => {
      seen = d
      const { orgs, ...rest } = d
      const folded = (orgs ?? []).map((o) => ({ name: `Org: ${String(o.name)}` }))
      return { ...rest, people: [...(d.people ?? []), ...folded] }
    }]])

    const v2 = new Dexie(DB_NAME)
    v2.version(1).stores({ orgs: '++id', people: '++id', untouched: '++id', backups: '++id' })
    v2.version(2).stores({ orgs: null }).upgrade((tx) => applySchemaUpgradeInTx(tx, 2, registry))
    await v2.open()

    // The callback saw the to-be-dropped table with its rows.
    expect(seen).not.toBeNull()
    expect(seen!.orgs).toHaveLength(2)
    // backups are never read into the DataSet.
    expect(seen!.backups).toBeUndefined()

    // After open the table is gone and the transformed rows were written back.
    expect(v2.tables.map((t) => t.name)).not.toContain('orgs')
    const people = await v2.table('people').toArray()
    expect(people.map((p) => p.name)).toEqual(['Ann', 'Org: Acme', 'Org: Globex'])
    // Existing primary keys are preserved.
    expect(people[0]!.id).toBe(3)
    expect(await v2.table('untouched').toArray()).toEqual([{ id: 1, v: 'keep' }])
    expect(await v2.table('backups').count()).toBe(1)
    v2.close()
  })

  it('a table created by the version exists (empty) during the callback and can be populated', async () => {
    await seedV1()

    const registry = new Map<number, SchemaUpgrade>([[2, (d) => {
      expect(d.focus).toEqual([])
      return { ...d, focus: (d.people ?? []).map((p) => ({ personId: p.id })) }
    }]])

    const v2 = new Dexie(DB_NAME)
    v2.version(1).stores({ orgs: '++id', people: '++id', untouched: '++id', backups: '++id' })
    v2.version(2).stores({ focus: '++id, personId' }).upgrade((tx) => applySchemaUpgradeInTx(tx, 2, registry))
    await v2.open()

    const focus = await v2.table('focus').toArray()
    expect(focus.map((f) => f.personId)).toEqual([3])
    v2.close()
  })

  it('only rewrites tables whose array reference changed', async () => {
    await seedV1()

    const registry = new Map<number, SchemaUpgrade>([[2, (d) => ({
      ...d,
      people: (d.people ?? []).map((p) => ({ ...p, name: String(p.name).toUpperCase() })),
    })]])

    const v2 = new Dexie(DB_NAME)
    v2.version(1).stores({ orgs: '++id', people: '++id', untouched: '++id', backups: '++id' })
    const cleared: string[] = []
    v2.version(2).stores({}).upgrade((tx) => {
      // Spy on clear() so we can tell which tables were rewritten.
      const origTable = tx.table.bind(tx)
      const wrapped = new Set<string>()
      tx.table = ((name: string) => {
        const t = origTable(name)
        if (!wrapped.has(name)) {
          wrapped.add(name)
          const origClear = t.clear.bind(t)
          t.clear = () => { cleared.push(name); return origClear() }
        }
        return t
      }) as typeof tx.table
      return applySchemaUpgradeInTx(tx, 2, registry)
    })
    await v2.open()

    expect((await v2.table('people').toArray())[0]!.name).toBe('ANN')
    expect(await v2.table('orgs').count()).toBe(2)
    expect(cleared).toEqual(['people'])
    v2.close()
  })

  it('multi-step open: each step sees the stores as of that version (earlier drops gone, later creates absent)', async () => {
    await seedV1()

    const seenAt: Record<number, string[]> = {}
    const record = (v: number): SchemaUpgrade => (d) => { seenAt[v] = Object.keys(d).sort(); return d }
    const registry = new Map<number, SchemaUpgrade>([[2, record(2)], [3, record(3)]])

    const v3 = new Dexie(DB_NAME)
    v3.version(1).stores({ orgs: '++id', people: '++id', untouched: '++id', backups: '++id' })
    v3.version(2).stores({ orgs: null }).upgrade((tx) => applySchemaUpgradeInTx(tx, 2, registry))
    v3.version(3).stores({ extra: '++id' }).upgrade((tx) => applySchemaUpgradeInTx(tx, 3, registry))
    await v3.open()

    expect(seenAt[2]).toEqual(['orgs', 'people', 'untouched'])
    expect(seenAt[3]).toEqual(['extra', 'people', 'untouched'])
    v3.close()
  })

  it('rejects output naming a table that does not exist at that version', async () => {
    await seedV1()
    const registry = new Map<number, SchemaUpgrade>([[2, (d) => ({ ...d, nope: [{ id: 1 }] })]])
    const v2 = new Dexie(DB_NAME)
    v2.version(1).stores({ orgs: '++id', people: '++id', untouched: '++id', backups: '++id' })
    v2.version(2).stores({}).upgrade((tx) => applySchemaUpgradeInTx(tx, 2, registry))
    await expect(v2.open()).rejects.toThrow(/unknown table "nope"/)
    v2.close()
  })

  it('is a no-op when the version has no registry entry', async () => {
    await seedV1()
    const v2 = new Dexie(DB_NAME)
    v2.version(1).stores({ orgs: '++id', people: '++id', untouched: '++id', backups: '++id' })
    v2.version(2).stores({}).upgrade((tx) => applySchemaUpgradeInTx(tx, 2, new Map()))
    await v2.open()
    expect(await v2.table('orgs').count()).toBe(2)
    v2.close()
  })
})
