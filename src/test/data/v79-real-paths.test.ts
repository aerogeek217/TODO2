import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CURRENT_DB_VERSION, db } from '../../data/database'
import { backupRepository } from '../../data/backup-repository'
import { buildExportData } from '../../data/export-data'
import { prepareImport, prepareImportText } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { appendImportTasks } from '../../data/append-import'
import { todoRepository } from '../../data/todo-repository'
import { auditData } from '../../data/audit'
import { emptyPredicate } from '../../models/filter-predicate'
import type { LayoutTab } from '../../models/workspace-layout'
import { browserMatchesFile } from '../../services/file-sync-compare'
import { defaultAppendChoices, findAppendDuplicates } from '../../services/append-import'
import { restoreBackup, restoreFromImport } from '../../services/replace-data'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'
import { cell, grid } from '../helpers/layout-builders'

/**
 * v79 through every real way in: a realistic v78 dataset holding every
 * shape v79 rewrites — the removed kinds' tabs (one emptying its cell), the
 * Eisenhower's hidden list with its manual order and its settings rows, a
 * Review widget's kind, pick and place, Breakdowns with `badges`, an old
 * sort and `checkins`, a Number's config lens switch, a Strips list tab, a
 * Created vs completed without name or Show as, a layout's old lens pick,
 * the Default list zoom's `compact` — goes through the browser database's
 * own upgrade, Settings import, a backup restore and an append import, and
 * the result exports at v79 with none of it. (The sync file's load is
 * `file-storage.test` › a v78 sync file.)
 */

const AT = '2026-11-01T09:00:00.000Z'
const raw = (tab: Record<string, unknown>) => tab as unknown as LayoutTab
const pred = emptyPredicate()

const TABLE = grid([
  [
    cell('k1', [
      raw({ id: 'mine', kind: 'lens', config: { listDefinitionId: 1 }, viewState: { zoom: 'strips', detailsWidth: 300 } }),
      raw({ id: 'eis', kind: 'eisenhower', config: {}, viewState: { collapsed: ['drop'] } }),
    ], { activeTabId: 'eis' }),
    cell('k2', [raw({ id: 'tm', kind: 'tagMap', config: { name: 'Projects', filter: pred, tagIds: [1] } })]),
  ],
  [
    cell('k3', [
      raw({ id: 'rv', kind: 'review', config: { by: 'tag', pick: { kind: 'tag', id: 1 } }, viewState: { sort: 'due', currentId: 1, skipped: { day: '2026-11-01', ids: [2] } } }),
      raw({ id: 'bd', kind: 'breakdown', config: { name: 'Waiting on', filter: pred, splitBy: 'people', style: 'bars', show: 'count', showNone: true, checkins: true, badges: { due: 'overdue' } }, viewState: { sorts: { people: { by: 'followup-late', reversed: true }, tags: { by: 'priority' } } } }),
      raw({ id: 'bd2', kind: 'breakdown', config: { name: 'Status', filter: pred, splitBy: 'status', style: 'bars', show: 'count', showNone: true } }),
    ]),
    cell('k4', [
      raw({ id: 'num', kind: 'number', config: { name: 'Open', filter: pred, show: 'count', litWhen: 'never', compare: 'yesterday', ignoreLens: true } }),
      raw({ id: 'tr', kind: 'trend', config: { range: '4w' } }),
      raw({ id: 'sf', kind: 'statusFlow', config: { name: 'Flow', filter: pred, weeks: 12 } }),
    ]),
  ],
])

/** A v78 export as the deployed build writes it. */
function v78File(): Record<string, unknown> {
  return {
    [SCHEMA_VERSION_KEY]: 78,
    todos: [
      { id: 1, uid: 'u1', title: 'Kept', isCompleted: false, sortOrder: 0, createdAt: AT, modifiedAt: AT },
      { id: 2, uid: 'u2', title: 'Also kept', isCompleted: false, sortOrder: 1, createdAt: AT, modifiedAt: '2026-11-02T09:00:00.000Z' },
    ],
    tags: [{ id: 1, name: 'Project: Atlas', color: '#336699' }],
    todoEvents: [{ id: 1, todoId: 1, type: 'created', fromValue: null, toValue: null, timestamp: AT }],
    settings: [
      { key: 'activeLayoutId', value: '1' },
      { key: 'historyLogSince', value: AT },
      { key: 'tabBadgeDue', value: '7' },
      { key: 'rowDensity', value: 'compact' },
      { key: 'eisenhowerPanes', value: JSON.stringify({ delegate: { name: 'Hand off' } }) },
      { key: 'eisenhowerSource', value: 'list:2' },
    ],
    listDefinitions: [
      { id: 1, name: 'Mine', sortOrder: 0, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: pred }, owner: { layoutId: 1 } },
      { id: 2, name: 'Eisenhower', sortOrder: 1, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: pred }, owner: { eisenhower: true } },
    ],
    listOrders: [{ id: 1, listDefinitionId: 2, todoId: 1, rank: 1 }, { id: 2, listDefinitionId: 1, todoId: 2, rank: 1 }],
    layouts: [{ id: 1, name: 'Main', sortOrder: 0, createdAt: AT, modifiedAt: AT, lensId: 'lens-a', ...TABLE }],
  }
}

const due = (end: number) => ({ ...pred, dates: { deadline: { match: 'range', start: null, end: { kind: 'offset', days: end } } } })
const followup = (end: number) => ({ ...pred, dates: { followup: { match: 'range', start: null, end: { kind: 'offset', days: end } } } })

/** What v79 leaves, read from the database and the stores; and an export holding none of the retired parts. */
async function expectV79Data(): Promise<void> {
  // The database.
  const layout = (await db.layouts.get(1))!
  expect(layout).not.toHaveProperty('lensId')
  const tabs = Object.fromEntries(layout.cells.flatMap((c) => c.tabs).map((t) => [t.id, t]))
  expect(Object.keys(tabs).sort()).toEqual(['bd', 'bd2', 'mine', 'num', 'rv', 'tr'])
  expect(layout.cells.map((c) => c.id).sort()).toEqual(['k1', 'k3', 'k4'])
  expect(layout.cells.find((c) => c.id === 'k1')?.activeTabId).toBe('mine')
  expect(tabs.mine).toEqual({ id: 'mine', kind: 'lens', config: { listDefinitionId: 1 }, viewState: { zoom: 'lines', detailsWidth: 300 } })
  expect(tabs.rv).toEqual({ id: 'rv', kind: 'review', config: {}, viewState: { sort: 'due' } })
  expect(tabs.bd).toEqual({
    id: 'bd', kind: 'breakdown',
    config: { name: 'Waiting on', filter: pred, splitBy: 'people', style: 'bars', show: 'count', showNone: true, columns: [
      { id: 'due', name: 'Due', color: '#e86bf0', filter: due(-1), litWhen: 'above', litAt: 0 },
      { id: 'followup', name: 'Follow-up', color: '#f5c842', filter: followup(0), litWhen: 'above', litAt: 0 },
    ] },
    viewState: { sorts: { people: { by: 'followup', reversed: true } } },
  })
  // The Settings due range of the data (7), the follow-up default (0).
  expect((tabs.bd2!.config as { columns: Array<{ filter: unknown }> }).columns.map((c) => c.filter)).toEqual([due(7), followup(0)])
  expect(tabs.num).toEqual({ id: 'num', kind: 'number', config: { name: 'Open', filter: pred, show: 'count', litWhen: 'never', compare: 'yesterday' }, viewState: { ignoreLens: true } })
  expect(tabs.tr).toEqual({ id: 'tr', kind: 'trend', config: { range: '4w', name: 'Created vs completed', show: 'bars' } })
  expect((await db.listDefinitions.toArray()).map((d) => d.id)).toEqual([1])
  expect((await db.listOrders.toArray()).map((r) => r.listDefinitionId)).toEqual([1])
  expect(await db.settings.get('eisenhowerPanes')).toBeUndefined()
  expect(await db.settings.get('eisenhowerSource')).toBeUndefined()
  expect(await db.settings.get('rowDensity')).toEqual({ key: 'rowDensity', value: 'rows' })
  expect(await db.settings.get('historyLogSince')).toEqual({ key: 'historyLogSince', value: AT })
  // Tasks keep their stamps.
  expect((await db.todos.get(2))?.modifiedAt).toEqual(new Date('2026-11-02T09:00:00.000Z'))
  // Nothing for the audit.
  expect((await auditData()).issues).toEqual([])

  // The app opens it with no repair notice.
  await useListDefinitionStore.getState().load()
  await useSettingsStore.getState().load()
  await useWorkspaceStore.getState().init()
  expect(useWorkspaceStore.getState().repairedIds.size).toBe(0)
  expect(useUndoStore.getState().snackbar).toBeNull()
  expect(useListDefinitionStore.getState().listDefinitions.map((d) => d.id)).toEqual([1])
  expect(useSettingsStore.getState().listZoom).toBe('rows')

  // An export: stamped v79, none of the retired parts, and it imports back as it is.
  const exported = await buildExportData()
  expect(exported[SCHEMA_VERSION_KEY]).toBe(CURRENT_DB_VERSION)
  const text = JSON.stringify(exported)
  for (const gone of ['eisenhower', 'tagMap', 'statusFlow', '"badges"', '"checkins"', '"strips"', '"lensId"', '"pick"', '"currentId"', '"skipped"', 'followup-late', '"priority"', '"compact"']) {
    expect(text, gone).not.toContain(gone)
  }
  const back = prepareImportText(text)
  if (!back.ok) throw new Error(back.error)
  expect(back.upgraded).toBe(false)
  expect(back.warnings).toEqual([])
}

beforeEach(async () => {
  await resetDb()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
})

describe('v79 through the real ways in', () => {
  it('Settings import of a v78 file', async () => {
    const prepared = prepareImportText(JSON.stringify(v78File()))
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.upgraded).toBe(true)
    expect(prepared.warnings).toEqual([])
    expect(await restoreFromImport(prepared.data)).toMatchObject({ status: 'done' })
    await expectV79Data()
  })

  it('a backup taken by a v78 build, restored', async () => {
    const id = await backupRepository.createSnapshotFromJson(JSON.stringify(v78File()), 'manual')
    expect(await restoreBackup(id)).toMatchObject({ status: 'done' })
    await expectV79Data()
  })

  it('an append import of a v78 file takes its tasks and nothing of its layouts, lists or settings', async () => {
    const prepared = prepareImportText(JSON.stringify(v78File()), { purpose: 'append' })
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.warnings).toEqual([])
    const cands = findAppendDuplicates(prepared.data.todos, await todoRepository.getAll())
    expect(await appendImportTasks(prepared.data, defaultAppendChoices(cands))).toMatchObject({ imported: 2 })
    expect(await db.todos.count()).toBe(2)
    expect(await db.layouts.count()).toBe(0)
    expect(await db.listDefinitions.count()).toBe(0)
    expect(await db.settings.get('eisenhowerPanes')).toBeUndefined()
  })
})

// ── The browser database's own upgrade ─────────────────────────────────────────

type IndexSpec = [name: string, keyPath: string | string[], unique?: 'unique']

/** The stores and indexes a v78 build left (no store changed after v73). */
const V78_LAYOUT: Record<string, { auto: boolean; keyPath: string; indexes: IndexSpec[] }> = {
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

/** A raw `todo2` database as a v78 build left it — made without Dexie, so no second instance lingers. */
function createV78Db(rows: Record<string, Record<string, unknown>[]>): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('todo2', 780)
    req.onupgradeneeded = () => {
      for (const [name, spec] of Object.entries(V78_LAYOUT)) {
        const store = req.result.createObjectStore(name, { keyPath: spec.keyPath, autoIncrement: spec.auto })
        for (const [index, keyPath, unique] of spec.indexes) store.createIndex(index, keyPath, { unique: unique === 'unique' })
      }
      for (const [name, list] of Object.entries(rows)) {
        const store = req.transaction!.objectStore(name)
        for (const row of list) store.add(row)
      }
    }
    req.onsuccess = () => { req.result.close(); resolve() }
    req.onerror = () => reject(req.error)
  })
}

/** The v78 file's rows as a v78 database holds them: dates as Dates. */
function v78Rows(): Record<string, Record<string, unknown>[]> {
  const file = v78File()
  const dated = (rows: unknown, keys: string[]) => (rows as Record<string, unknown>[]).map((r) => {
    const out = { ...r }
    for (const k of keys) if (typeof out[k] === 'string') out[k] = new Date(out[k])
    return out
  })
  return {
    todos: dated(file.todos, ['createdAt', 'modifiedAt']),
    tags: file.tags as Record<string, unknown>[],
    todoEvents: file.todoEvents as Record<string, unknown>[],
    settings: file.settings as Record<string, unknown>[],
    listDefinitions: file.listDefinitions as Record<string, unknown>[],
    listOrders: file.listOrders as Record<string, unknown>[],
    layouts: dated(file.layouts, ['createdAt', 'modifiedAt']),
  }
}

describe('v79 through the browser database’s own upgrade', () => {
  afterEach(async () => {
    db.close()
    await resetDb()
  })

  it('a v78 database opens at the current version converted, and reads as the same data imported as a v78 file', async () => {
    db.close()
    await db.delete()
    await createV78Db(v78Rows())
    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
    expect(db.backendDB().version).toBe(CURRENT_DB_VERSION * 10)
    await expectV79Data()

    const file = prepareImport(JSON.parse(JSON.stringify(v78File())))
    if (!file.ok) throw new Error(file.error)
    expect(await browserMatchesFile(file.data)).toBe(true)
  })
})
