import { afterEach, describe, expect, it } from 'vitest'
import { CURRENT_DB_VERSION, db } from '../../data/database'
import { prepareImport } from '../../data/import-pipeline'
import { emptyFilterClauses, emptyPredicate } from '../../models'
import { browserMatchesFile } from '../../services/file-sync-compare'
import { resetDb } from '../helpers'

/**
 * v74 through the browser's own upgrade (cr31 data S3-1(a), tests 3.7): a
 * database a v73 build left, with real shapes, opens at v74 converted, and
 * reads exactly as the same data imported as a v73 file — the sync file's
 * "identical" check depends on that parity.
 */

type IndexSpec = [name: string, keyPath: string | string[], unique?: 'unique']

/** The stores and indexes a v73 build left (the floor's, v72's `statusUpdates`, v73's `subtasks`). */
const V73_LAYOUT: Record<string, { auto: boolean; keyPath: string; indexes: IndexSpec[] }> = {
  backups: { keyPath: 'id', auto: true, indexes: [['createdAt', 'createdAt'], ['trigger', 'trigger']] },
  layouts: { keyPath: 'id', auto: true, indexes: [] },
  listDefinitions: { keyPath: 'id', auto: true, indexes: [['sortOrder', 'sortOrder']] },
  listOrders: { keyPath: 'id', auto: true, indexes: [['[listDefinitionId+todoId]', ['listDefinitionId', 'todoId'], 'unique'], ['listDefinitionId', 'listDefinitionId'], ['todoId', 'todoId']] },
  notes: { keyPath: 'id', auto: true, indexes: [['modifiedAt', 'modifiedAt']] },
  people: { keyPath: 'id', auto: true, indexes: [['name', 'name']] },
  settings: { keyPath: 'key', auto: false, indexes: [] },
  statuses: { keyPath: 'id', auto: true, indexes: [['sortOrder', 'sortOrder']] },
  statusUpdates: { keyPath: 'id', auto: true, indexes: [['todoId', 'todoId'], ['date', 'date']] },
  subtasks: { keyPath: 'id', auto: true, indexes: [['todoId', 'todoId']] },
  tags: { keyPath: 'id', auto: true, indexes: [['name', 'name']] },
  todoEvents: { keyPath: 'id', auto: true, indexes: [['timestamp', 'timestamp'], ['todoId', 'todoId'], ['type', 'type']] },
  todoPeople: { keyPath: 'id', auto: true, indexes: [['personId', 'personId'], ['todoId', 'todoId']] },
  todoTags: { keyPath: 'id', auto: true, indexes: [['tagId', 'tagId'], ['todoId', 'todoId']] },
  todos: { keyPath: 'id', auto: true, indexes: [['dueDate', 'dueDate'], ['isCompleted', 'isCompleted'], ['sortOrder', 'sortOrder'], ['statusId', 'statusId'], ['uid', 'uid', 'unique']] },
}

type Rows = Partial<Record<keyof typeof V73_LAYOUT, Record<string, unknown>[]>>

/** A raw `todo2` database as a v73 build left it — made without Dexie, so no second instance lingers. */
function createV73Db(rows: Rows): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('todo2', 730)
    req.onupgradeneeded = () => {
      for (const [name, spec] of Object.entries(V73_LAYOUT)) {
        const store = req.result.createObjectStore(name, { keyPath: spec.keyPath, autoIncrement: spec.auto })
        for (const [index, keyPath, unique] of spec.indexes) store.createIndex(index, keyPath, { unique: unique === 'unique' })
      }
      for (const [name, list] of Object.entries(rows)) {
        const store = req.transaction!.objectStore(name)
        for (const row of list ?? []) store.add(row)
      }
    }
    req.onsuccess = () => { req.result.close(); resolve() }
    req.onerror = () => reject(req.error)
  })
}

const at = new Date(2026, 9, 20, 9, 0)
const legacy = (markers: unknown) => ({ ...emptyPredicate(), markers })
const dashboard = {
  id: 'd', kind: 'dashboard',
  config: { tiles: ['open', 'hot'], listTiles: [], sections: [{ id: 'hot' }, { id: 'people', options: { showUnassigned: false } }] },
}

/** A v73 browser's data: a custom Hot rule `U | (I & F)`, a Hot list, a Hot pane, a lens with `(U & I) or Ann`, a check-in filter, Hot on a dashboard, subtasks stored before titles were checked. */
const V73_ROWS: Rows = {
  todos: [{ id: 1, uid: 'u1', title: 'Plan trip', isCompleted: false, sortOrder: 0, createdAt: at, modifiedAt: at }],
  people: [{ id: 1, name: 'Ann', initials: 'A', color: '#336699' }],
  subtasks: [
    { id: 1, todoId: 1, title: '', isCompleted: true, sortOrder: 0, createdAt: at },
    { id: 2, todoId: 1, title: 'k'.repeat(600), isCompleted: false, sortOrder: 1, createdAt: at },
    { id: 3, todoId: 1, title: 'Book  flights', isCompleted: false, sortOrder: 2, createdAt: at },
  ],
  settings: [
    { key: 'hotRule', value: JSON.stringify([{ urgent: true }, { important: true, focus: true }]) },
    { key: 'lenses', value: JSON.stringify([{ id: 'l1', name: 'Ann or hot', predicate: { ...emptyPredicate(), orGroups: [{ ...emptyFilterClauses(), personIds: [1], markers: { urgent: true, important: true } }] } }]) },
    { key: 'eisenhowerPanes', value: JSON.stringify({ do: { filter: legacy('hot') } }) },
    { key: 'checkinTaskFilter', value: JSON.stringify(legacy({ focus: false })) },
  ],
  layouts: [{ id: 1, name: 'Main', sortOrder: 0, createdAt: at, modifiedAt: at, columns: [{ id: 'c', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [dashboard] }] }] }],
  listDefinitions: [{ id: 1, name: 'Hot', sortOrder: 0, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: legacy('hot') }, owner: { layoutId: 1 } }],
}

describe('the browser database’s v74 upgrade', () => {
  afterEach(async () => {
    db.close()
    await resetDb()
  })

  it('a v73 database opens at v74 converted, and reads as the same data imported as a v73 file', async () => {
    db.close()
    await db.delete()
    await createV73Db(V73_ROWS)

    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
    expect(await db.settings.get('hotRule')).toBeUndefined()
    // v74 made each Priority filter conditions; v75 then wrote or groups as expressions.
    const list = await db.listDefinitions.get(1)
    expect(list?.membership).toMatchObject({ predicate: { markers: [{ values: ['focus', 'urgent'] }, { values: ['urgent', 'important'] }] } })
    const lenses = JSON.parse(String((await db.settings.get('lenses'))?.value)) as { predicate: { orGroups?: unknown; expression: unknown } }[]
    expect(lenses[0]?.predicate.orGroups).toBeUndefined()
    // `Ann or (Urgent and Important)` as v74 distributed it: (Urgent or Ann) and (Important or Ann).
    expect(lenses[0]?.predicate.expression).toEqual({ kind: 'and', items: [
      { kind: 'or', items: [{ kind: 'priority', value: 'urgent' }, { kind: 'person', id: 1 }] },
      { kind: 'or', items: [{ kind: 'priority', value: 'important' }, { kind: 'person', id: 1 }] },
    ] })
    const panes = JSON.parse(String((await db.settings.get('eisenhowerPanes'))?.value)) as { do: { filter: { markers: unknown } } }
    expect(panes.do.filter.markers).toEqual([{ values: ['focus', 'urgent'] }, { values: ['urgent', 'important'] }])
    const checkin = JSON.parse(String((await db.settings.get('checkinTaskFilter'))?.value)) as { markers: unknown }
    expect(checkin.markers).toEqual([{ values: ['focus'], not: true }])
    const tab = (await db.layouts.get(1))?.columns[0]?.cells[0]?.tabs[0]
    expect(tab?.config).toEqual({ tiles: ['open'], listTiles: [], sections: [{ id: 'people', options: { showUnassigned: false } }] })
    // The subtasks a v73 build stored as they were: the empty one gone, the long one cut, each one line.
    expect((await db.subtasks.toArray()).map((s) => [s.id, s.title])).toEqual([[2, 'k'.repeat(500)], [3, 'Book flights']])

    const file = prepareImport(JSON.parse(JSON.stringify({ __schemaVersion: 73, ...V73_ROWS })))
    if (!file.ok) throw new Error(file.error)
    expect(await browserMatchesFile(file.data)).toBe(true)
  })
})
