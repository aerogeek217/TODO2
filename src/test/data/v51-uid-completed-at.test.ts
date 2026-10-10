import { describe, it, expect, afterEach } from 'vitest'
import Dexie from 'dexie'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV51, backfillTodoUid } from '../../data/upgrades/v51-uid-completed-at'
import { SCHEMA_UPGRADES, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { useTodoStore } from '../../stores/todo-store'
import { resetDb, v50StoreSpecs } from '../helpers'
import { selectExpiredCompleted } from '../../utils/completed-at'
/** What the launch prompt / Settings cleanup delete once the user confirms (cr1 P5). */
const purgeExpired = (days: number) =>
  useTodoStore.getState().purgeCompleted(selectExpiredCompleted(useTodoStore.getState().todos, days).map((t) => t.id))

const T0 = '2026-08-01T09:00:00.000Z'
const MOD = '2026-10-01T09:00:00.000Z'
const DONE = '2026-08-15T09:00:00.000Z'
const UUID8 = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('upgradeV51 (pure transform)', () => {
  it('is the v51 registry entry', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(51)
    expect(SCHEMA_UPGRADES.get(51)).toBe(upgradeV51)
  })

  it('assigns every todo a unique, deterministic uid', () => {
    const todos = [
      { id: 1, title: 'A', isCompleted: false, createdAt: T0, modifiedAt: T0 },
      { id: 2, title: 'A', isCompleted: false, createdAt: T0, modifiedAt: T0 },
      { id: 3, title: 'B', isCompleted: false, createdAt: new Date(T0), modifiedAt: T0 },
    ]
    const out = upgradeV51({ todos })
    const uids = out.todos!.map((t) => t.uid as string)
    for (const uid of uids) expect(uid).toMatch(UUID8)
    expect(new Set(uids).size).toBe(3)
    // Same task → same uid, whether createdAt is a Date (live DB) or a string (file).
    expect(upgradeV51({ todos: [{ ...todos[2]!, createdAt: T0 }] }).todos![0]!.uid).toBe(uids[2])
    expect(upgradeV51({ todos }).todos!.map((t) => t.uid)).toEqual(uids)
  })

  it('keeps existing uids, re-mints duplicates and empties', () => {
    const out = upgradeV51({
      todos: [
        { id: 1, uid: 'keep-me', title: 'A', isCompleted: false, createdAt: T0 },
        { id: 2, uid: 'keep-me', title: 'B', isCompleted: false, createdAt: T0 },
        { id: 3, uid: '', title: 'C', isCompleted: false, createdAt: T0 },
      ],
    })
    const [a, b, c] = out.todos!
    expect(a!.uid).toBe('keep-me')
    expect(b!.uid).toBe(backfillTodoUid(b!))
    expect(c!.uid).toMatch(UUID8)
  })

  it('backfills completedAt from the latest completed event, else modifiedAt, else createdAt', () => {
    const out = upgradeV51({
      todos: [
        { id: 1, title: 'Event', isCompleted: true, createdAt: T0, modifiedAt: MOD },
        { id: 2, title: 'No event', isCompleted: true, createdAt: T0, modifiedAt: MOD },
        { id: 3, title: 'Bad modifiedAt', isCompleted: true, createdAt: T0, modifiedAt: 'junk' },
        { id: 4, title: 'Open', isCompleted: false, createdAt: T0, modifiedAt: MOD },
      ],
      todoEvents: [
        { id: 1, todoId: 1, type: 'completed', timestamp: '2026-08-10T09:00:00.000Z' },
        { id: 2, todoId: 1, type: 'reopened', timestamp: '2026-08-12T09:00:00.000Z' },
        { id: 3, todoId: 1, type: 'completed', timestamp: DONE },
        { id: 4, todoId: 4, type: 'completed', timestamp: DONE },
      ],
    })
    const [t1, t2, t3, t4] = out.todos!
    expect(t1!.completedAt).toEqual(new Date(DONE))
    expect(t2!.completedAt).toEqual(new Date(MOD))
    expect(t3!.completedAt).toEqual(new Date(T0))
    expect('completedAt' in t4!).toBe(false)
  })

  it('keeps an existing completedAt and drops one on an open task', () => {
    const at = new Date(DONE)
    const out = upgradeV51({
      todos: [
        { id: 1, uid: 'u1', title: 'Done', isCompleted: true, completedAt: at, createdAt: T0, modifiedAt: MOD },
        { id: 2, uid: 'u2', title: 'Open', isCompleted: false, completedAt: at, createdAt: T0, modifiedAt: MOD },
      ],
    })
    expect(out.todos![0]!.completedAt).toBe(at)
    expect('completedAt' in out.todos![1]!).toBe(false)
  })

  it('is idempotent and keeps references when already in the v51 shape', () => {
    const once = upgradeV51({ todos: [{ id: 1, title: 'A', isCompleted: true, createdAt: T0, modifiedAt: MOD }] })
    expect(upgradeV51(once)).toBe(once)
    const people = [{ id: 1, name: 'Ann' }]
    const input: DataSet = { todos: once.todos!, people }
    expect(upgradeV51(input)).toBe(input)
  })

  it('does not mutate the input; tolerates missing tables and malformed rows', () => {
    const input: DataSet = { todos: [{ id: 1, title: 'A', isCompleted: true, createdAt: T0, modifiedAt: MOD }] }
    const snapshot = JSON.stringify(input)
    upgradeV51(input)
    expect(JSON.stringify(input)).toBe(snapshot)

    expect(upgradeV51({})).toEqual({})
    const archive = upgradeV51({ todos: [{ id: 9, title: 'X', isCompleted: true, modifiedAt: MOD }] })
    expect(archive.todos![0]!.completedAt).toEqual(new Date(MOD))
    const out = upgradeV51({ todos: [null as never, 'junk' as never] })
    expect(out.todos).toEqual([null, 'junk'])
  })
})

/** The live-DB path: a v50 database opened by the current build. */
describe('v51 Dexie upgrade', () => {
  afterEach(async () => {
    await resetDb()
  })

  async function buildV50Db(): Promise<void> {
    db.close()
    await Dexie.delete(db.name)
    const v50 = new Dexie(db.name)
    v50.version(50).stores(v50StoreSpecs())
    await v50.open()
    await v50.table('todos').bulkAdd([
      { id: 1, title: 'Done in August', isCompleted: true, sortOrder: 0, createdAt: new Date(T0), modifiedAt: new Date(MOD) },
      { id: 2, title: 'Done, no event', isCompleted: true, sortOrder: 1, createdAt: new Date(T0), modifiedAt: new Date(MOD) },
      { id: 3, title: 'Open', isCompleted: false, sortOrder: 2, createdAt: new Date(T0), modifiedAt: new Date(MOD) },
    ])
    await v50.table('todoEvents').add({ id: 1, todoId: 1, type: 'completed', fromValue: null, toValue: null, timestamp: DONE })
    v50.close()
  }

  it('backfills uid + completedAt, builds the unique index, and matches the import path', async () => {
    await buildV50Db()
    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)

    const todos = await db.todos.orderBy('id').toArray()
    expect(todos.map((t) => t.completedAt)).toEqual([new Date(DONE), new Date(MOD), undefined])
    for (const t of todos) expect(t.uid).toMatch(UUID8)
    expect(new Set(todos.map((t) => t.uid)).size).toBe(3)
    expect((await db.todos.where('uid').equals(todos[1]!.uid).first())?.id).toBe(2)

    // A JSON copy of the same v50 data upgrades to the same uids / completedAt.
    const prepared = prepareImport(JSON.parse(JSON.stringify({
      __schemaVersion: 50,
      canvases: [{ id: 1, name: 'Main', sortOrder: 0, createdAt: T0 }],
      todos: [
        { id: 1, title: 'Done in August', isCompleted: true, sortOrder: 0, createdAt: T0, modifiedAt: MOD },
        { id: 2, title: 'Done, no event', isCompleted: true, sortOrder: 1, createdAt: T0, modifiedAt: MOD },
        { id: 3, title: 'Open', isCompleted: false, sortOrder: 2, createdAt: T0, modifiedAt: MOD },
      ],
      todoEvents: [{ id: 1, todoId: 1, type: 'completed', fromValue: null, toValue: null, timestamp: DONE }],
    })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.data.todos.map((t) => t.uid)).toEqual(todos.map((t) => t.uid))
    expect(prepared.data.todos.map((t) => t.completedAt)).toEqual(todos.map((t) => t.completedAt))
  })

  it('the purge then uses the backfilled completion time', async () => {
    await buildV50Db()
    await db.open()
    useTodoStore.setState({ todos: [], todosVersion: 0, loading: false })
    await useTodoStore.getState().loadAll()
    // A cutoff a day after DONE: todo 1 (completed at DONE, per its event)
    // expires; todo 2 (backfilled from the later modifiedAt) stays.
    const days = Math.floor((Date.now() - new Date(DONE).getTime()) / 86_400_000) - 1
    const purged = await purgeExpired(days)
    expect(purged).toBe(1)
    expect((await db.todos.orderBy('id').toArray()).map((t) => t.id)).toEqual([2, 3])
  })
})
