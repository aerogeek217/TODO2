import { describe, it, expect, beforeEach } from 'vitest'
import fixture from '../fixtures/v49-export.json'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { backupRepository } from '../../data/backup-repository'
import { prepareImportText } from '../../data/import-pipeline'
import { DATA_TABLE_NAMES } from '../../data/tables'
import { useFileOpsStore } from '../../services/file-ops-store'
import { useTodoStore } from '../../stores/todo-store'
import { runAppendImport } from '../../services/append-import'
import { makeTodo, resetDb } from '../helpers'

/**
 * A file without some of the data tables still imports, through every entry
 * point that replaces or adds to the database: the missing tables arrive
 * empty. Files like these exist — a v49 export with only the required
 * tables, an older backup from before a table existed (`layouts`,
 * `listOrders`), an export from a build that left an empty table out. (The
 * sync-file load is covered in `services/file-storage-v49-sync.test.ts`.)
 */

const fixtureTables = fixture as unknown as Record<string, unknown>

/** A v49 file with only the tables a full restore requires. */
const V49_REQUIRED_ONLY = JSON.stringify({ __schemaVersion: 49, todos: fixture.todos, settings: fixture.settings })

/** A v49 file without its optional tables (tags, todoTags, todoEvents, notes, lists, …). */
const V49_WITHOUT_OPTIONAL = JSON.stringify(Object.fromEntries(
  Object.entries(fixtureTables).filter(([key]) => !['tags', 'todoTags', 'todoEvents', 'notes', 'listDefinitions', 'todoPeople', 'statuses'].includes(key)),
))

/** A current-version export without tags, todoTags, layouts, listOrders, todoEvents, notes. */
const CURRENT_WITHOUT_OPTIONAL = JSON.stringify({
  __schemaVersion: CURRENT_DB_VERSION,
  todos: [makeTodo({ id: 1, title: 'Kept' }), makeTodo({ id: 2, title: 'Also kept' })],
  settings: [{ key: 'themeMode', value: 'dark' }],
  people: [{ id: 1, name: 'Ann', initials: 'AN' }],
  todoPeople: [{ id: 1, todoId: 1, personId: 1 }],
  statuses: [],
  listDefinitions: [],
})

const FILES: Array<[string, string, number]> = [
  ['a v49 file with only todos + settings', V49_REQUIRED_ONLY, fixture.todos.length],
  ['a v49 file without its optional tables', V49_WITHOUT_OPTIONAL, fixture.todos.length],
  ['a current export without the optional tables', CURRENT_WITHOUT_OPTIONAL, 2],
]

beforeEach(async () => {
  await resetDb()
  useFileOpsStore.setState(useFileOpsStore.getInitialState(), true)
  useTodoStore.setState(useTodoStore.getInitialState(), true)
  await db.todos.add(makeTodo({ id: 99, title: 'Before' }))
})

describe.each(FILES)('%s', (_label, text, taskCount) => {
  it('prepares with every data table present (missing ones empty)', () => {
    const prepared = prepareImportText(text)
    if (!prepared.ok) throw new Error(prepared.error)
    for (const name of DATA_TABLE_NAMES) expect(Array.isArray(prepared.data[name]), name).toBe(true)
    expect(prepared.data.todos).toHaveLength(taskCount)
  })

  it('Settings › Import JSON restores it', async () => {
    const prepared = prepareImportText(text)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(await useFileOpsStore.getState().restoreFromImport(prepared.data)).toMatchObject({ status: 'done' })
    expect(await db.todos.count()).toBe(taskCount)
    expect(await db.todos.get(99)).toBeUndefined()
    for (const name of DATA_TABLE_NAMES) {
      // Restore seeds the Assigned status; the note store seeds the note.
      if (name === 'statuses' || name === 'settings' || name === 'notes') continue
      expect(await db.table(name).count(), name).toBe(prepared.data[name].length)
    }
  })

  it('Settings › Backups restores a backup holding it', async () => {
    const id = await backupRepository.createSnapshotFromJson(text, 'manual')
    expect(await useFileOpsStore.getState().restoreBackup(id)).toMatchObject({ status: 'done' })
    expect(await db.todos.count()).toBe(taskCount)
    expect(await db.todos.get(99)).toBeUndefined()
  })

  it('Import tasks (append) adds its tasks', async () => {
    const prepared = prepareImportText(text, { purpose: 'append' })
    if (!prepared.ok) throw new Error(prepared.error)
    expect(await runAppendImport(prepared.data, new Map())).toMatchObject({ status: 'done' })
    expect(await db.todos.count()).toBe(taskCount + 1)
    expect(await db.todos.get(99)).toBeDefined()
  })
})

describe('a v49 file missing some of its tables', () => {
  it('imports exactly as the same file with those tables present and empty (how the v49 build writes them)', () => {
    const emptied = Object.fromEntries(Object.entries(fixtureTables).map(([key, value]) =>
      [key, Array.isArray(value) && key !== 'todos' && key !== 'settings' ? [] : value]))
    const minimal = prepareImportText(V49_REQUIRED_ONLY)
    const full = prepareImportText(JSON.stringify(emptied))
    if (!minimal.ok || !full.ok) throw new Error('prepare failed')
    expect(minimal.data).toEqual(full.data)
    expect(minimal.warnings).toEqual(full.warnings)
    // The rails' taskboard tab became a tab of the Focus list v59 creates.
    const focus = minimal.data.listDefinitions.find((d) => d.name === 'Focus')
    const tabs = minimal.data.layouts.flatMap((l) => l.columns.flatMap((c) => c.cells.flatMap((cell) => cell.tabs)))
    expect(tabs).toContainEqual(expect.objectContaining({ kind: 'lens', config: { listDefinitionId: focus!.id } }))
  })

  it('a task archive is not padded: it stays a partial dataset', () => {
    const archive = JSON.stringify({ __schemaVersion: 49, kind: 'task-archive', todos: fixture.todos })
    const prepared = prepareImportText(archive, { purpose: 'append' })
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.data.listDefinitions).toEqual([])
    expect(prepared.data.layouts).toEqual([])
  })
})
