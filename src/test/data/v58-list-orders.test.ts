import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { CURRENT_DB_VERSION, db } from '../../data/database'
import { prepareImport } from '../../data/import-pipeline'
import { validateImportData } from '../../data/import-validation'
import { listOrderRepository } from '../../data/list-order-repository'
import { layoutRepository } from '../../data/layout-repository'
import { todoRepository } from '../../data'
import { auditData, cleanupIssues } from '../../data/audit'
import { resetDb, v57StoreSpecs } from '../helpers'

/** The live-DB path: a v57 database opened by the current build. */
describe('v58 Dexie upgrade', () => {
  afterEach(async () => {
    await resetDb()
  })

  it('adds an empty listOrders table and keeps every other row', async () => {
    db.close()
    await Dexie.delete(db.name)
    const v57 = new Dexie(db.name)
    v57.version(57).stores(v57StoreSpecs())
    await v57.open()
    const now = new Date('2026-10-01T09:00:00.000Z')
    await v57.table('todos').add({ id: 1, uid: 'u1', title: 'A', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 0 })
    await v57.table('listDefinitions').add({
      id: 1, name: 'L', sortOrder: 0, pinnedToDashboard: false, sort: 'manual', grouping: 'none',
      membership: { kind: 'custom', predicate: {} },
    })
    v57.close()

    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
    expect(await db.listOrders.count()).toBe(0)
    expect(await db.todos.count()).toBe(1)
    // Plus the Focus list v59 adds.
    // v59 adds the Focus list, v67 the Eisenhower's.
    expect((await db.listDefinitions.orderBy('id').toArray()).map((d) => d.name)).toEqual(['L', 'Focus', 'Eisenhower'])
  })
})

describe('listOrders import validation', () => {
  const base = { todos: [], settings: [] }

  it('accepts a dataset without listOrders (older files, task archives)', () => {
    const result = validateImportData(base)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.listOrders).toEqual([])
  })

  it('picks every field and rejects a non-numeric rank', () => {
    const ok = validateImportData({ ...base, listOrders: [{ id: 3, listDefinitionId: 1, todoId: 2, rank: 1.5 }] })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.data.listOrders).toEqual([{ id: 3, listDefinitionId: 1, todoId: 2, rank: 1.5 }])
    const bad = validateImportData({ ...base, listOrders: [{ listDefinitionId: 1, todoId: 2, rank: 'x' }] })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('rank')
  })

  it('rejects two ranks for the same list + task', () => {
    const result = validateImportData({
      ...base,
      listOrders: [
        { listDefinitionId: 1, todoId: 2, rank: 1 },
        { listDefinitionId: 1, todoId: 2, rank: 2 },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('duplicate list + task pair')
  })

  it('a v57 file imports with no ranks', () => {
    const prepared = prepareImport({ __schemaVersion: 57, ...base })
    expect(prepared.ok).toBe(true)
    if (prepared.ok) expect(prepared.data.listOrders).toEqual([])
  })
})

describe('listOrders cascades and audit', () => {
  beforeEach(async () => {
    await resetDb()
  })

  async function seed(): Promise<{ todoA: number; todoB: number; list: number; other: number }> {
    const now = new Date()
    const todoA = await db.todos.add({ uid: 'a', title: 'A', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 0 })
    const todoB = await db.todos.add({ uid: 'b', title: 'B', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 1 })
    const def = { name: 'L', sortOrder: 0, pinnedToDashboard: false, sort: 'manual' as const, grouping: 'none' as const, membership: { kind: 'custom' as const, predicate: {} as never } }
    const list = await db.listDefinitions.add({ ...def })
    const other = await db.listDefinitions.add({ ...def, name: 'M' })
    await listOrderRepository.setRanks(list, [{ todoId: todoA, rank: 1 }, { todoId: todoB, rank: 2 }])
    await listOrderRepository.setRanks(other, [{ todoId: todoA, rank: 5 }])
    return { todoA, todoB, list, other }
  }

  it('setRanks upserts on the list + task pair', async () => {
    const { todoA, list } = await seed()
    await listOrderRepository.setRanks(list, [{ todoId: todoA, rank: 9 }])
    const rows = await listOrderRepository.getByList(list)
    expect(rows.map((r) => [r.todoId, r.rank]).sort()).toEqual([[todoA, 9], [todoA + 1, 2]].sort())
    expect(await db.listOrders.count()).toBe(3)
  })

  it('deleting a task deletes its ranks in every list', async () => {
    const { todoA, todoB } = await seed()
    await todoRepository.delete(todoA)
    const rows = await db.listOrders.toArray()
    expect(rows.map((r) => r.todoId)).toEqual([todoB])
    await todoRepository.bulkDelete([todoB])
    expect(await db.listOrders.count()).toBe(0)
  })

  it('deleting a list (one its layout no longer shows, at a Save) deletes its ranks only', async () => {
    const { list, other } = await seed()
    const now = new Date()
    const layoutId = await layoutRepository.insert({ name: 'X', columns: [], createdAt: now, modifiedAt: now })
    await db.listDefinitions.update(list, { owner: { layoutId } })
    await layoutRepository.pruneOwnedLists(layoutId, new Set())
    const rows = await db.listOrders.toArray()
    expect(rows.map((r) => r.listDefinitionId)).toEqual([other])
  })

  it('the audit reports ranks whose task or list is gone, and cleans them up', async () => {
    const { todoA, list } = await seed()
    // Bypass the cascades: delete the rows directly.
    await db.todos.delete(todoA)
    await db.listDefinitions.delete(list)
    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'listOrders')
    expect(issue?.count).toBe(3)
    expect(issue?.samples?.[0]?.note).toMatch(/not in (todos|listDefinitions)/)
    await cleanupIssues(report.issues)
    expect(await db.listOrders.count()).toBe(0)
  })
})
