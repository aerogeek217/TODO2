import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Dexie from 'dexie'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV50 } from '../../data/upgrades/v50-revive-dates'
import { SCHEMA_UPGRADES, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { restoreFromImportData } from '../../data/restore'
import { todoRepository } from '../../data/todo-repository'
import { startOfToday } from '../../utils/date'
import { resetDb, v50StoreSpecs } from '../helpers'

const ISO = '2026-09-01T09:00:00.000Z'

function isDate(v: unknown): boolean {
  return v instanceof Date && !Number.isNaN(v.getTime())
}

describe('upgradeV50 (pure transform)', () => {
  it('is the v50 registry entry', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(50)
    expect(SCHEMA_UPGRADES.get(50)).toBe(upgradeV50)
  })

  it('revives every v49 Date field, including the nested scheduledDate ones', () => {
    const out = upgradeV50({
      todos: [
        { id: 1, createdAt: ISO, modifiedAt: ISO, dueDate: ISO, scheduledDate: { kind: 'date', value: ISO } },
        { id: 2, createdAt: ISO, modifiedAt: ISO, scheduledDate: { kind: 'fuzzy', token: 'today', setAt: ISO } },
      ],
      canvases: [{ id: 1, createdAt: ISO }],
      projects: [{ id: 1, createdAt: ISO }],
      notes: [{ id: 1, createdAt: ISO, modifiedAt: ISO }],
      taskboards: [{ id: 1, entries: [], createdAt: ISO, updatedAt: ISO }],
    })
    const [t1, t2] = out.todos!
    expect(isDate(t1!.createdAt) && isDate(t1!.modifiedAt) && isDate(t1!.dueDate)).toBe(true)
    expect(isDate((t1!.scheduledDate as { value: unknown }).value)).toBe(true)
    expect(isDate((t2!.scheduledDate as { setAt: unknown }).setAt)).toBe(true)
    expect((t2!.scheduledDate as { token: unknown }).token).toBe('today')
    expect(isDate(out.canvases![0]!.createdAt)).toBe(true)
    expect(isDate(out.projects![0]!.createdAt)).toBe(true)
    expect(isDate(out.notes![0]!.createdAt) && isDate(out.notes![0]!.modifiedAt)).toBe(true)
    expect(isDate(out.taskboards![0]!.createdAt) && isDate(out.taskboards![0]!.updatedAt)).toBe(true)
    expect((out.todos![0]!.dueDate as Date).toISOString()).toBe(ISO)
  })

  it('does not mutate the input', () => {
    const input: DataSet = { todos: [{ id: 1, createdAt: ISO, scheduledDate: { kind: 'date', value: ISO } }] }
    const snapshot = JSON.stringify(input)
    upgradeV50(input)
    expect(JSON.stringify(input)).toBe(snapshot)
    expect(input.todos![0]!.createdAt).toBe(ISO)
  })

  it('keeps references when there is nothing to revive (idempotent; Dexie skips the table)', () => {
    const d = new Date(ISO)
    const todos = [{ id: 1, createdAt: d, modifiedAt: d, scheduledDate: { kind: 'fuzzy', token: 'today', setAt: d } }]
    const canvases = [{ id: 1, createdAt: d }]
    const people = [{ id: 1, name: 'Ann', initials: 'AL' }]
    const input: DataSet = { todos, canvases, people }
    expect(upgradeV50(input)).toBe(input)

    const once = upgradeV50({ todos: [{ id: 1, createdAt: ISO }], canvases })
    expect(once.canvases).toBe(canvases)
    const twice = upgradeV50(once)
    expect(twice).toBe(once)
  })

  it('tolerates missing tables and leaves malformed values for validation', () => {
    expect(upgradeV50({})).toEqual({})
    const out = upgradeV50({ todos: [{ id: 1, createdAt: 'not a date', dueDate: 42, scheduledDate: 'junk' }, null as never] })
    expect(out.todos![0]).toEqual({ id: 1, createdAt: 'not a date', dueDate: 42, scheduledDate: 'junk' })
    expect(out.todos![1]).toBeNull()
  })

  it('leaves todoEvents.timestamp (a string by design) alone', () => {
    const todoEvents = [{ id: 1, todoId: 1, type: 'created', timestamp: ISO }]
    expect(upgradeV50({ todoEvents }).todoEvents).toBe(todoEvents)
  })
})

/**
 * The live-DB repair: a v49 database whose rows hold ISO strings (what every
 * pre-v50 import / sync-file load wrote) is opened by the current build, and
 * the Dexie v50 upgrade revives them in place.
 */
describe('v50 Dexie upgrade repairs a string-dated v49 database', () => {
  /** v49's store specs (v50 changed no stores). */
  const currentStoreSpecs = v50StoreSpecs

  afterEach(async () => {
    await resetDb()
  })

  it('revives every Date field and makes dueDate range queries find the rows', async () => {
    const specs = currentStoreSpecs()
    db.close()
    await Dexie.delete(db.name)

    const today = startOfToday()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const already = new Date(ISO)

    const v49 = new Dexie(db.name)
    v49.version(49).stores(specs)
    await v49.open()
    await v49.table('todos').bulkAdd([
      {
        id: 1, title: 'Due today', isCompleted: false, sortOrder: 0,
        createdAt: ISO, modifiedAt: ISO, dueDate: today.toISOString(),
        scheduledDate: { kind: 'date', value: ISO },
      },
      {
        id: 2, title: 'Overdue', isCompleted: false, sortOrder: 1,
        createdAt: ISO, modifiedAt: ISO, dueDate: yesterday.toISOString(),
        scheduledDate: { kind: 'fuzzy', token: 'next-week', setAt: ISO },
      },
      { id: 3, title: 'Already Dates', isCompleted: false, sortOrder: 2, createdAt: already, modifiedAt: already },
    ])
    await v49.table('canvases').add({ id: 1, name: 'Main', sortOrder: 0, createdAt: ISO })
    await v49.table('projects').add({ id: 1, name: 'P', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 0, createdAt: ISO })
    await v49.table('notes').add({ id: 1, content: 'n', createdAt: ISO, modifiedAt: ISO })
    await v49.table('taskboards').add({ id: 1, entries: [], createdAt: ISO, updatedAt: ISO })
    await v49.table('todoEvents').add({ id: 1, todoId: 1, type: 'created', fromValue: null, toValue: null, timestamp: ISO })
    v49.close()

    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)

    const [t1, t2, t3] = await db.todos.orderBy('id').toArray()
    for (const t of [t1!, t2!, t3!]) {
      expect(isDate(t.createdAt), `todo ${t.id} createdAt`).toBe(true)
      expect(isDate(t.modifiedAt), `todo ${t.id} modifiedAt`).toBe(true)
    }
    expect(isDate(t1!.dueDate) && isDate(t2!.dueDate)).toBe(true)
    expect(t1!.scheduledDate?.kind === 'date' && isDate(t1.scheduledDate.value)).toBe(true)
    expect(t2!.scheduledDate?.kind === 'fuzzy' && isDate(t2.scheduledDate.setAt)).toBe(true)
    expect(t3!.dueDate).toBeUndefined()

    expect(isDate((await db.canvases.get(1))!.createdAt)).toBe(true)
    expect(isDate((await db.projects.get(1))!.createdAt)).toBe(true)
    const note = (await db.notes.get(1))!
    expect(isDate(note.createdAt) && isDate(note.modifiedAt)).toBe(true)
    const board = (await db.taskboards.get(1))!
    expect(isDate(board.createdAt) && isDate(board.updatedAt)).toBe(true)
    expect((await db.todoEvents.get(1))!.timestamp).toBe(ISO)

    expect((await todoRepository.getDueToday()).map((t) => t.id)).toEqual([1])
    expect((await todoRepository.getOverdue()).map((t) => t.id)).toEqual([2])
  })
})

describe('restored tasks are visible to dueDate range queries', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('getDueToday / getOverdue find tasks restored from a JSON export', async () => {
    const today = startOfToday()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const file = JSON.parse(JSON.stringify({
      // A v50 file: the v51 upgrade mints the uids current rows need.
      __schemaVersion: 50,
      canvases: [{ id: 1, name: 'Main', sortOrder: 0, createdAt: new Date(ISO) }],
      todos: [
        { id: 1, title: 'Due today', isCompleted: false, sortOrder: 0, createdAt: new Date(ISO), modifiedAt: new Date(ISO), dueDate: today },
        { id: 2, title: 'Overdue', isCompleted: false, sortOrder: 1, createdAt: new Date(ISO), modifiedAt: new Date(ISO), dueDate: yesterday },
        { id: 3, title: 'Overdue but done', isCompleted: true, sortOrder: 2, createdAt: new Date(ISO), modifiedAt: new Date(ISO), dueDate: yesterday },
      ],
    })) as unknown
    const prepared = prepareImport(file)
    if (!prepared.ok) throw new Error(prepared.error)
    await restoreFromImportData(prepared.data)

    expect((await todoRepository.getDueToday()).map((t) => t.id)).toEqual([1])
    expect((await todoRepository.getOverdue()).map((t) => t.id)).toEqual([2])
  })
})
