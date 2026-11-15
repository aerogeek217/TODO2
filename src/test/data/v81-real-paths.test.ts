import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CURRENT_DB_VERSION, db } from '../../data/database'
import { backupRepository } from '../../data/backup-repository'
import { buildExportData } from '../../data/export-data'
import { prepareImport, prepareImportText } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { auditData } from '../../data/audit'
import { browserMatchesFile } from '../../services/file-sync-compare'
import { restoreBackup, restoreFromImport } from '../../services/replace-data'
import { useSettingsStore } from '../../stores/settings-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { resetDb } from '../helpers'

/**
 * v81 through every real way in: a v80 dataset with lenses, the top bar's
 * pick, a lens shortcut and lens switches on a list and on layout tabs goes
 * through the browser database's own upgrade, Settings import and a backup
 * restore, and the result exports at v81 with none of it. The other
 * settings, the list and the layout stay. (The sync file's load runs the
 * same pipeline as the import.)
 */

const AT = '2026-11-01T09:00:00.000Z'
const PREDICATE = { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null }
const LENSES = JSON.stringify([{ id: 'lens-a', name: 'Aisha', predicate: { ...PREDICATE, personIds: [1] } }])

/** A v80 export as the deployed build writes it. */
function v80File(): Record<string, unknown> {
  return {
    [SCHEMA_VERSION_KEY]: 80,
    todos: [{ id: 1, uid: 'u1', title: 'Kept', isCompleted: false, sortOrder: 0, createdAt: AT, modifiedAt: AT }],
    listDefinitions: [{
      id: 1, name: 'Inbox', sortOrder: 0, membership: { kind: 'custom', predicate: PREDICATE },
      sort: 'manual', grouping: 'none', owner: { layoutId: 1 }, ignoreLens: true,
    }],
    layouts: [{
      id: 1,
      name: 'Main',
      sortOrder: 0,
      grid: { columns: [{ id: 'c0', weight: 1 }, { id: 'c1', weight: 1 }], rows: [{ id: 'r0', weight: 1 }] },
      cells: [
        { id: 'k0', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [{ id: 'list', kind: 'lens', config: { listDefinitionId: 1 } }], activeTabId: 'list' },
        { id: 'k1', area: { col: 1, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [{ id: 'cal', kind: 'calendar', config: { dateTypes: { due: true, followup: true } }, viewState: { view: 'week', ignoreLens: true } }], activeTabId: 'cal' },
      ],
      createdAt: AT,
      modifiedAt: AT,
    }],
    settings: [
      { key: 'historyLogSince', value: AT },
      { key: 'lenses', value: LENSES },
      { key: 'activeLensId', value: 'lens-a' },
      { key: 'lensPresetsSeeded', value: 'true' },
      { key: 'keyboardShortcuts', value: JSON.stringify({ 'cycle-lens': 'l', 'focus-filters': 'n' }) },
    ],
  }
}

/** What v81 leaves, read from the database and the stores; and an export holding none of the lens parts. */
async function expectV81Data(): Promise<void> {
  for (const key of ['lenses', 'activeLensId', 'lensPresetsSeeded']) expect(await db.settings.get(key), key).toBeUndefined()
  expect(await db.settings.get('keyboardShortcuts')).toEqual({ key: 'keyboardShortcuts', value: JSON.stringify({ 'focus-filters': 'n' }) })
  expect(await db.settings.get('historyLogSince')).toEqual({ key: 'historyLogSince', value: AT })
  const lists = await db.listDefinitions.toArray()
  expect(lists.map((l) => l.name)).toEqual(['Inbox'])
  expect(lists.every((l) => !('ignoreLens' in l))).toBe(true)
  const layouts = await db.layouts.toArray()
  expect(JSON.stringify(layouts)).not.toContain('ignoreLens')
  expect(layouts[0]?.cells.flatMap((c) => c.tabs.map((t) => t.id))).toEqual(['list', 'cal'])
  expect(layouts[0]?.cells[1]?.tabs[0]?.viewState).toEqual({ view: 'week' })
  expect((await auditData()).issues).toEqual([])

  await useSettingsStore.getState().load()
  await useListDefinitionStore.getState().load()
  expect(Object.keys(useSettingsStore.getState().shortcutOverrides)).toEqual(['focus-filters'])
  expect(useListDefinitionStore.getState().listDefinitions.map((l) => l.name)).toEqual(['Inbox'])

  const exported = await buildExportData()
  expect(exported[SCHEMA_VERSION_KEY]).toBe(CURRENT_DB_VERSION)
  const text = JSON.stringify(exported)
  for (const gone of ['ignoreLens', 'activeLensId', 'lensPresetsSeeded', '"lenses"', 'cycle-lens']) expect(text, gone).not.toContain(gone)
  const back = prepareImportText(text)
  if (!back.ok) throw new Error(back.error)
  expect(back.upgraded).toBe(false)
  expect(back.warnings).toEqual([])
}

beforeEach(async () => {
  await resetDb()
})

describe('v81 through the real ways in', () => {
  it('Settings import of a v80 file', async () => {
    const prepared = prepareImportText(JSON.stringify(v80File()))
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.upgraded).toBe(true)
    expect(prepared.warnings).toEqual([])
    expect(await restoreFromImport(prepared.data)).toMatchObject({ status: 'done' })
    await expectV81Data()
  })

  it('a backup taken by a v80 build, restored', async () => {
    const id = await backupRepository.createSnapshotFromJson(JSON.stringify(v80File()), 'manual')
    expect(await restoreBackup(id)).toMatchObject({ status: 'done' })
    await expectV81Data()
  })
})

// ── The browser database's own upgrade ─────────────────────────────────────────

type IndexSpec = [name: string, keyPath: string | string[], unique?: 'unique']

/** The stores and indexes a v80 build left (no store changed after v73). */
const V80_LAYOUT: Record<string, { auto: boolean; keyPath: string; indexes: IndexSpec[] }> = {
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

/** A raw `todo2` database as a v80 build left it — made without Dexie, so no second instance lingers. */
function createV80Db(rows: Record<string, Record<string, unknown>[]>): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('todo2', 800)
    req.onupgradeneeded = () => {
      for (const [name, spec] of Object.entries(V80_LAYOUT)) {
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

/** The v80 file's rows as a v80 database holds them: dates as Dates. */
function v80Rows(): Record<string, Record<string, unknown>[]> {
  const file = v80File()
  const dated = (rows: unknown, keys: string[]) => (rows as Record<string, unknown>[]).map((r) => {
    const out = { ...r }
    for (const k of keys) if (typeof out[k] === 'string') out[k] = new Date(out[k])
    return out
  })
  return {
    todos: dated(file.todos, ['createdAt', 'modifiedAt']),
    listDefinitions: file.listDefinitions as Record<string, unknown>[],
    layouts: dated(file.layouts, ['createdAt', 'modifiedAt']),
    settings: file.settings as Record<string, unknown>[],
  }
}

describe('v81 through the browser database’s own upgrade', () => {
  afterEach(async () => {
    db.close()
    await resetDb()
  })

  it('a v80 database opens at v81 converted, and reads as the same data imported as a v80 file', async () => {
    db.close()
    await db.delete()
    await createV80Db(v80Rows())
    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
    expect(db.backendDB().version).toBe(CURRENT_DB_VERSION * 10)
    await expectV81Data()

    const file = prepareImport(JSON.parse(JSON.stringify(v80File())))
    if (!file.ok) throw new Error(file.error)
    expect(await browserMatchesFile(file.data)).toBe(true)
  })
})
