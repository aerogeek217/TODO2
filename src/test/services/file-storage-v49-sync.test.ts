import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Dexie from 'dexie'
import fixture from '../fixtures/v49-export.json'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { prepareImportText } from '../../data/import-pipeline'
import { buildExportData } from '../../data/export-data'
import { FILE_SYNC_STATE_KEY } from '../../services/file-sync-state'
import { fileStorageService as svc } from '../../services/file-storage'
import type { SyncConflictInfo } from '../../services/file-storage'
import { browserMatchesFile } from '../../services/file-sync-compare'
import { resetDb, v50StoreSpecs, v65StoreSpecs, v66StoreSpecs } from '../helpers'

/**
 * CURRENT_DB_VERSION is past 49 (v50 Dates, v51 uid + completedAt, …), so a
 * v49 sync file is an *older* file. This drives
 * the real pipeline end-to-end (real Dexie, real `prepareImport` +
 * v50…CURRENT transforms, real restore, real backup
 * snapshots) with only the file handle faked, and checks the "user decides
 * before anything changes" rules for that file:
 *
 * - clean + synced browser → upgrade prompt (49 → CURRENT); cancel touches nothing;
 * - accept → the raw v49 text is backed up first, the browser gets the file's
 *   data with real `Date`s, and the file is rewritten at CURRENT;
 * - unsynced browser changes → conflict prompt; "Use file" backs up first too.
 */

const mockLoadFileHandle = vi.fn()
vi.mock('../../services/file-handle-idb', () => ({
  saveFileHandle: vi.fn().mockResolvedValue(undefined),
  loadFileHandle: (...args: unknown[]) => mockLoadFileHandle(...args) as unknown,
  clearFileHandle: vi.fn().mockResolvedValue(undefined),
}))

const SAVED_AT = '2026-10-01T10:00:00.000Z'
const FILE_TEXT = JSON.stringify({ ...fixture, savedAt: SAVED_AT }, null, 2)
const BROWSER_TASK = 'Browser-only task'

function makeHandle(text: string) {
  const write = vi.fn<(data: string) => Promise<void>>().mockResolvedValue(undefined)
  const handle = {
    kind: 'file',
    name: 'todo2-data.json',
    getFile: vi.fn().mockImplementation(async () =>
      new File([text], 'todo2-data.json', { type: 'application/json', lastModified: 1_000 })),
    queryPermission: vi.fn().mockResolvedValue('granted'),
    requestPermission: vi.fn().mockResolvedValue('granted'),
    createWritable: vi.fn().mockResolvedValue({
      write,
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    }),
    isSameEntry: vi.fn(),
  }
  return { handle, write }
}

function setSyncState(state: { fileSavedAt: string | null; dirtySince: string | null }) {
  localStorage.setItem(FILE_SYNC_STATE_KEY, JSON.stringify(state))
}

async function seedBrowser() {
  const now = new Date()
  await db.settings.put({ key: 'themeMode', value: 'light' })
  await db.todos.add({ uid: 'browser-task', title: BROWSER_TASK, isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now })
}

async function fileBackups() {
  return (await db.backups.toArray()).filter((b) => b.data === FILE_TEXT)
}

beforeEach(async () => {
  await resetDb()
  localStorage.clear()
  vi.stubGlobal('showOpenFilePicker', vi.fn())
  await seedBrowser()
})

afterEach(async () => {
  await svc.disconnect()
  svc.onConfirmFileUpgrade(async () => false)
  svc.onConflict(async () => 'cancel')
  vi.unstubAllGlobals()
})

describe('v49 sync file opened by a post-v49 build (CURRENT ≥ 50)', () => {
  it('the build is past v49 and the fixture prepares as an upgrade', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThan(49)
    const prepared = prepareImportText(FILE_TEXT)
    expect(prepared).toMatchObject({ ok: true, sourceVersion: 49, upgraded: true, legacy: null })
  })

  it('clean + synced browser: asks 49 → CURRENT; cancel leaves file, browser and backups untouched', async () => {
    setSyncState({ fileSavedAt: SAVED_AT, dirtySince: null })
    const { handle, write } = makeHandle(FILE_TEXT)
    mockLoadFileHandle.mockResolvedValue(handle)
    const ask = vi.fn().mockResolvedValue(false)
    svc.onConfirmFileUpgrade(ask)

    await svc.initialize()

    expect(ask).toHaveBeenCalledWith({ fileName: 'todo2-data.json', fromVersion: 49, toVersion: CURRENT_DB_VERSION })
    expect(svc.status.paused?.reason).toBe('upgrade-cancelled')
    expect(write).not.toHaveBeenCalled()
    expect(await fileBackups()).toHaveLength(0)
    expect((await db.todos.toArray()).map((t) => t.title)).toEqual([BROWSER_TASK])
  })

  it('accepting backs up the raw v49 text, loads the file with real Dates, and rewrites it at CURRENT', async () => {
    setSyncState({ fileSavedAt: SAVED_AT, dirtySince: null })
    const { handle, write } = makeHandle(FILE_TEXT)
    mockLoadFileHandle.mockResolvedValue(handle)
    svc.onConfirmFileUpgrade(async () => true)

    await svc.initialize()

    expect(svc.status.paused).toBeNull()
    expect(svc.status.isConnected).toBe(true)
    expect(await fileBackups()).toHaveLength(1)

    const todos = await db.todos.orderBy('id').toArray()
    expect(todos).toHaveLength(fixture.todos.length)
    expect(todos.some((t) => t.title === BROWSER_TASK)).toBe(false)
    for (const t of todos) expect(t.createdAt instanceof Date, `todo ${t.id} createdAt`).toBe(true)
    expect(todos[0]!.dueDate).toEqual(new Date('2026-10-16T00:00:00.000Z'))

    expect(write).toHaveBeenCalledTimes(1)
    const written = JSON.parse(write.mock.calls[0]![0]) as Record<string, unknown>
    expect(written.__schemaVersion).toBe(CURRENT_DB_VERSION)
    // The rewritten file imports at the current version without any upgrade.
    const reloaded = prepareImportText(write.mock.calls[0]![0])
    expect(reloaded).toMatchObject({ ok: true, sourceVersion: CURRENT_DB_VERSION, upgraded: false })
    if (!reloaded.ok) return
    expect(reloaded.data.todos.map((t) => t.title)).toEqual(todos.map((t) => t.title))
    // v51: the rewritten file carries the same uids / completedAt as the browser.
    expect(reloaded.data.todos.map((t) => t.uid)).toEqual(todos.map((t) => t.uid))
    expect(reloaded.data.todos.map((t) => t.completedAt)).toEqual(todos.map((t) => t.completedAt))
  })

  it('unsynced browser changes: conflict names v49 as the file schema; "Use file" backs up before restoring', async () => {
    setSyncState({ fileSavedAt: SAVED_AT, dirtySince: '2026-10-02T10:00:00.000Z' })
    const { handle, write } = makeHandle(FILE_TEXT)
    mockLoadFileHandle.mockResolvedValue(handle)
    let info: SyncConflictInfo | null = null
    svc.onConflict(async (i) => { info = i; return 'file' })
    const ask = vi.fn()
    svc.onConfirmFileUpgrade(ask)

    await svc.initialize()

    expect(info).toMatchObject({
      reason: 'browser-changes',
      browser: { taskCount: 1, schemaVersion: CURRENT_DB_VERSION },
      file: { taskCount: fixture.todos.length, schemaVersion: 49 },
    })
    expect(ask).not.toHaveBeenCalled()
    expect(await fileBackups()).toHaveLength(1)
    expect(await db.todos.count()).toBe(fixture.todos.length)
    expect(write).toHaveBeenCalledTimes(1)
    expect((JSON.parse(write.mock.calls[0]![0]) as Record<string, unknown>).__schemaVersion).toBe(CURRENT_DB_VERSION)
  })
})

/**
 * The fixture as a production v49 user might hold it: names past the old
 * 200-character import limit, a long title, and notes past the old 50k limit
 * (the v49 editors never capped them). A deep copy — the fixture is frozen.
 */
function productionV49Data(): Record<string, Array<Record<string, unknown>>> {
  const data = JSON.parse(JSON.stringify(fixture)) as Record<string, Array<Record<string, unknown>>>
  const long = (prefix: string, length: number) => `${prefix} `.padEnd(length, 'x')
  data.people![0]!.name = long('Long person', 260)
  data.tags![0]!.name = long('Long tag', 300)
  data.statuses![0]!.name = long('Long status', 240)
  data.orgs![0]!.name = long('Long org', 250)
  data.projects![0]!.name = long('Long project', 250)
  data.listDefinitions![0]!.name = long('Long list', 220)
  data.todos![0]!.title = long('Long title', 1200)
  data.todos![0]!.notes = long('Long notes', 60_000)
  data.notes![0]!.content = long('Workspace note', 120_000)
  return data
}

/**
 * Builds the browser side of a production v49 install: a v49 database holding
 * `data` (what the v49 build restored from its sync file), then opens it with
 * the current build, so Dexie upgrades it to CURRENT_DB_VERSION.
 */
async function openUpgradedV49Browser(data: Record<string, unknown>) {
  db.close()
  await Dexie.delete(db.name)
  const v49 = new Dexie(db.name)
  v49.version(49).stores(v50StoreSpecs())
  await v49.open()
  for (const [name, rows] of Object.entries(data)) {
    if (Array.isArray(rows) && rows.length > 0) await v49.table(name).bulkAdd(rows)
  }
  v49.close()
  await db.open()
  expect(db.verno).toBe(CURRENT_DB_VERSION)
}

describe('first load after deploying over a v49 build (no sync record)', () => {
  // The v49 build kept no sync record and wrote the whole database to the
  // file on every change, so an in-sync file holds exactly the browser's data.
  const data = productionV49Data()
  const fileText = JSON.stringify({ ...data, savedAt: SAVED_AT }, null, 2)

  it('in-sync sides: the upgrade prompt, not a conflict; confirming backs up the raw file, then both sides match', async () => {
    await openUpgradedV49Browser(data)
    const { handle, write } = makeHandle(fileText)
    mockLoadFileHandle.mockResolvedValue(handle)
    const ask = vi.fn().mockResolvedValue(true)
    svc.onConfirmFileUpgrade(ask)
    const conflict = vi.fn().mockResolvedValue('cancel')
    svc.onConflict(conflict)

    await svc.initialize()

    expect(conflict).not.toHaveBeenCalled()
    expect(ask).toHaveBeenCalledWith({ fileName: 'todo2-data.json', fromVersion: 49, toVersion: CURRENT_DB_VERSION })
    expect(svc.status.paused).toBeNull()
    expect(svc.status.isConnected).toBe(true)
    // The raw v49 text was backed up before the file was rewritten.
    expect((await db.backups.toArray()).filter((b) => b.data === fileText)).toHaveLength(1)
    expect(write).toHaveBeenCalledTimes(1)
    const written = prepareImportText(write.mock.calls[0]![0])
    expect(written).toMatchObject({ ok: true, sourceVersion: CURRENT_DB_VERSION, upgraded: false })
    if (!written.ok) return
    expect(await browserMatchesFile(written.data)).toBe(true)
    expect(written.data.todos).toHaveLength(fixture.todos.length)
    expect(written.data.todos.some((t) => t.title.length === 1200 && (t.notes ?? '').length === 60_000)).toBe(true)
    expect(written.data.people.some((p) => p.name.length === 260)).toBe(true)
    expect(written.data.people.some((p) => p.name === `Org: ${data.orgs![0]!.name as string}`)).toBe(true)
    expect(written.data.tags.some((t) => t.name === `Project: ${data.projects![0]!.name as string}`)).toBe(true)
    expect(JSON.parse(localStorage.getItem(FILE_SYNC_STATE_KEY) ?? '{}')).toMatchObject({ dirtySince: null })
  })

  it('cancelling the upgrade prompt leaves the file, the browser and the backups untouched', async () => {
    await openUpgradedV49Browser(data)
    const { handle, write } = makeHandle(fileText)
    mockLoadFileHandle.mockResolvedValue(handle)
    svc.onConfirmFileUpgrade(async () => false)
    const before = await db.todos.orderBy('id').toArray()

    await svc.initialize()

    expect(svc.status.paused?.reason).toBe('upgrade-cancelled')
    expect(write).not.toHaveBeenCalled()
    expect((await db.backups.toArray()).filter((b) => b.data === fileText)).toHaveLength(0)
    expect(await db.todos.orderBy('id').toArray()).toEqual(before)
  })

  it('sides that differ still get the conflict prompt, naming the older file', async () => {
    await openUpgradedV49Browser(data)
    const changed = JSON.parse(fileText) as { todos: Array<{ title: string }> }
    changed.todos[1]!.title = 'Edited on another machine'
    const { handle, write } = makeHandle(JSON.stringify(changed))
    mockLoadFileHandle.mockResolvedValue(handle)
    const ask = vi.fn()
    svc.onConfirmFileUpgrade(ask)
    let info: SyncConflictInfo | null = null
    svc.onConflict(async (i) => { info = i; return 'cancel' })

    await svc.initialize()

    expect(ask).not.toHaveBeenCalled()
    expect(info).toMatchObject({ reason: 'no-sync-record', file: { schemaVersion: 49 } })
    expect(svc.status.paused?.reason).toBe('conflict-cancelled')
    expect(write).not.toHaveBeenCalled()
  })
})

describe('a sync file missing some data tables still loads (missing tables arrive empty)', () => {
  const v49RequiredOnly = JSON.stringify({ __schemaVersion: 49, savedAt: SAVED_AT, todos: fixture.todos, settings: fixture.settings })
  const now = new Date().toISOString()
  const currentPartial = JSON.stringify({
    __schemaVersion: CURRENT_DB_VERSION,
    savedAt: SAVED_AT,
    todos: [{ id: 1, uid: 'u-1', title: 'From the file', isCompleted: false, sortOrder: 0, createdAt: now, modifiedAt: now }],
    settings: [{ key: 'themeMode', value: 'dark' }],
  })

  it.each([
    ['a v49 file with only todos + settings', v49RequiredOnly, fixture.todos.length],
    ['a current file without tags, todoTags, layouts, listOrders, todoEvents, notes, …', currentPartial, 1],
  ])('%s: "Use file" loads it', async (_label, text, taskCount) => {
    setSyncState({ fileSavedAt: SAVED_AT, dirtySince: '2026-10-02T10:00:00.000Z' })
    const { handle } = makeHandle(text)
    mockLoadFileHandle.mockResolvedValue(handle)
    svc.onConflict(async () => 'file')
    svc.onConfirmFileUpgrade(async () => true)

    await svc.initialize()

    expect(svc.status.paused).toBeNull()
    expect(svc.status.isConnected).toBe(true)
    expect(await db.todos.count()).toBe(taskCount)
    expect((await db.todos.toArray()).some((t) => t.title === BROWSER_TASK)).toBe(false)
    expect(await db.tags.count()).toBe(0)
    expect(await db.listOrders.count()).toBe(0)
    expect(await db.layouts.count()).toBe(text === v49RequiredOnly ? 1 : 0)
  })
})

describe('first load after deploying over a v64 build (synced, with a sync record)', () => {
  it('asks 64 → CURRENT, not a conflict; confirming backs up the raw v64 text and rewrites the file with the same data', async () => {
    await db.listDefinitions.add({
      name: 'Not mine', sortOrder: 0, sort: 'manual', grouping: 'none',
      membership: { kind: 'custom', predicate: { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null } },
    })
    const fileText = JSON.stringify({ ...await buildExportData(), __schemaVersion: 64, savedAt: SAVED_AT }, null, 2)
    setSyncState({ fileSavedAt: SAVED_AT, dirtySince: null })
    const { handle, write } = makeHandle(fileText)
    mockLoadFileHandle.mockResolvedValue(handle)
    const ask = vi.fn().mockResolvedValue(true)
    svc.onConfirmFileUpgrade(ask)
    const conflict = vi.fn().mockResolvedValue('cancel')
    svc.onConflict(conflict)

    await svc.initialize()

    expect(conflict).not.toHaveBeenCalled()
    expect(ask).toHaveBeenCalledWith({ fileName: 'todo2-data.json', fromVersion: 64, toVersion: CURRENT_DB_VERSION })
    expect(svc.status.paused).toBeNull()
    expect((await db.backups.toArray()).filter((b) => b.data === fileText)).toHaveLength(1)
    expect(write).toHaveBeenCalledTimes(1)
    const written = prepareImportText(write.mock.calls[0]![0])
    expect(written).toMatchObject({ ok: true, sourceVersion: CURRENT_DB_VERSION, upgraded: false })
    if (!written.ok) return
    expect(await browserMatchesFile(written.data)).toBe(true)
    expect(written.data.todos.map((t) => t.title)).toEqual([BROWSER_TASK])
    // v67 gave the Eisenhower (on all tasks) its own list, on both sides alike.
    expect(written.data.listDefinitions.map((d) => d.name)).toEqual(['Not mine', 'Eisenhower'])
    expect(written.data.listDefinitions[1]?.owner).toEqual({ eisenhower: true })
  })
})

describe('first load after deploying over a v65 build with customized Eisenhower tabs (synced, with a sync record)', () => {
  it('asks 65 → CURRENT, not a conflict: the browser upgraded at open and the upgraded file hold the same settings', async () => {
    const at = new Date('2026-10-19T09:00:00.000Z')
    const panes = { delegate: { name: 'Hand off', filter: { showCompleted: false, personIds: null, statusIds: [3], searchText: '', dates: {}, markers: { urgent: true, important: false }, negate: { statusIds: true } } } }
    const v65Layout = {
      id: 1, name: 'Main', createdAt: at, modifiedAt: at,
      columns: [{ id: 'c', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [
        { id: 'e1', kind: 'eisenhower', config: { panes, listDefinitionId: 4 } },
        { id: 'e2', kind: 'eisenhower', config: { panes: { drop: { name: 'Later' } } } },
      ] }] }],
    }
    const list = {
      id: 4, name: 'Team', sortOrder: 0, sort: 'manual', grouping: 'none',
      membership: { kind: 'custom', predicate: { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null } },
    }
    // The v65 build's database, and its sync file holding the same rows.
    db.close()
    await Dexie.delete(db.name)
    const v65 = new Dexie(db.name)
    v65.version(65).stores(v65StoreSpecs())
    await v65.open()
    await v65.table('settings').put({ key: 'themeMode', value: 'light' })
    await v65.table('listDefinitions').add(list)
    await v65.table('layouts').add(v65Layout)
    const tables: Record<string, unknown[]> = {}
    for (const t of v65.tables) if (t.name !== 'backups') tables[t.name] = await t.toArray()
    v65.close()
    const fileText = JSON.stringify({ ...tables, __schemaVersion: 65, savedAt: SAVED_AT }, null, 2)
    await db.open()

    setSyncState({ fileSavedAt: SAVED_AT, dirtySince: null })
    const { handle, write } = makeHandle(fileText)
    mockLoadFileHandle.mockResolvedValue(handle)
    const ask = vi.fn().mockResolvedValue(true)
    svc.onConfirmFileUpgrade(ask)
    const conflict = vi.fn().mockResolvedValue('cancel')
    svc.onConflict(conflict)

    await svc.initialize()

    expect(conflict).not.toHaveBeenCalled()
    expect(ask).toHaveBeenCalledWith({ fileName: 'todo2-data.json', fromVersion: 65, toVersion: CURRENT_DB_VERSION })
    expect((await db.backups.toArray()).filter((b) => b.data === fileText)).toHaveLength(1)
    const written = prepareImportText(write.mock.calls[0]![0])
    if (!written.ok) throw new Error(written.error)
    expect(await browserMatchesFile(written.data)).toBe(true)
    expect(written.data.settings).toEqual(expect.arrayContaining([
      { key: 'eisenhowerPanes', value: JSON.stringify(panes) },
      { key: 'eisenhowerSource', value: 'list:4' },
    ]))
    expect(written.data.layouts[0]!.columns[0]!.cells[0]!.tabs.map((t) => t.config)).toEqual([{}, {}])
  })
})

describe('first load after deploying over a v66 build whose Eisenhower list a list tab shows too (synced, with a sync record)', () => {
  it('asks 66 → CURRENT, not a conflict: both sides number the layouts and make the same copy of the list, with its ranks', async () => {
    const at = new Date('2026-10-19T09:00:00.000Z')
    const list = {
      id: 4, name: 'Team', sortOrder: 0, sort: 'manual', grouping: 'none',
      membership: { kind: 'custom', predicate: { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null } },
    }
    const layouts = [2, 1].map((id) => ({
      id, name: `L${id}`, createdAt: at, modifiedAt: at,
      columns: [{ id: 'c', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [{ id: 'l', kind: 'lens', config: { listDefinitionId: 4 } }, { id: 'e', kind: 'eisenhower', config: {} }] }] }],
    }))
    db.close()
    await Dexie.delete(db.name)
    const v66 = new Dexie(db.name)
    v66.version(66).stores(v66StoreSpecs())
    await v66.open()
    await v66.table('settings').put({ key: 'eisenhowerSource', value: 'list:4' })
    await v66.table('listDefinitions').add(list)
    await v66.table('listOrders').add({ listDefinitionId: 4, todoId: 9, rank: 1 })
    for (const l of layouts) await v66.table('layouts').add(l)
    const tables: Record<string, unknown[]> = {}
    for (const t of v66.tables) if (t.name !== 'backups') tables[t.name] = await t.toArray()
    v66.close()
    const fileText = JSON.stringify({ ...tables, __schemaVersion: 66, savedAt: SAVED_AT }, null, 2)
    await db.open()

    setSyncState({ fileSavedAt: SAVED_AT, dirtySince: null })
    const { handle, write } = makeHandle(fileText)
    mockLoadFileHandle.mockResolvedValue(handle)
    const ask = vi.fn().mockResolvedValue(true)
    svc.onConfirmFileUpgrade(ask)
    const conflict = vi.fn().mockResolvedValue('cancel')
    svc.onConflict(conflict)

    await svc.initialize()

    expect(conflict).not.toHaveBeenCalled()
    expect(ask).toHaveBeenCalledWith({ fileName: 'todo2-data.json', fromVersion: 66, toVersion: CURRENT_DB_VERSION })
    const written = prepareImportText(write.mock.calls[0]![0])
    if (!written.ok) throw new Error(written.error)
    expect(await browserMatchesFile(written.data)).toBe(true)
    expect(written.data.listDefinitions.map((d) => [d.id, d.name, d.owner])).toEqual([[4, 'Team', undefined], [5, 'Eisenhower', { eisenhower: true }]])
    expect(written.data.listOrders.map((r) => [r.listDefinitionId, r.todoId])).toEqual([[4, 9], [5, 9]])
    expect(written.data.settings).toEqual(expect.arrayContaining([{ key: 'eisenhowerSource', value: 'list:5' }]))
    expect(written.data.layouts.map((l) => [l.id, l.sortOrder])).toEqual([[1, 0], [2, 1]])
  })
})
