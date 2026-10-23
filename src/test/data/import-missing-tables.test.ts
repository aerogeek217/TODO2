import { describe, it, expect, beforeEach } from 'vitest'
import fixture from '../fixtures/v68-export.json'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { backupRepository } from '../../data/backup-repository'
import { prepareImportText } from '../../data/import-pipeline'
import { DATA_TABLE_NAMES } from '../../data/tables'
import { isEisenhowerOwner } from '../../models/list-definition'
import { useFileOpsStore } from '../../stores/file-ops-store'
import { restoreBackup, restoreFromImport } from '../../services/replace-data'
import { useTodoStore } from '../../stores/todo-store'
import { runAppendImport } from '../../services/append-import'
import { makeTodo, resetDb } from '../helpers'

/**
 * A file without some of the data tables still imports, through every entry
 * point that replaces or adds to the database: the missing tables arrive
 * empty. Files like these exist — an export with only the required
 * tables, an export from a build that left an empty table out, a file made
 * by hand.
 */

const fixtureTables = fixture as unknown as Record<string, unknown>

/** A v68 file with only the tables a full restore requires. */
const V68_REQUIRED_ONLY = JSON.stringify({ __schemaVersion: 68, todos: fixture.todos, settings: fixture.settings })

/** A v68 file without its optional tables (tags, todoTags, todoEvents, notes, lists, layouts, …). */
const V68_WITHOUT_OPTIONAL = JSON.stringify(Object.fromEntries(
  Object.entries(fixtureTables).filter(([key]) => ![
    'tags', 'todoTags', 'todoEvents', 'notes', 'listDefinitions', 'todoPeople', 'statuses', 'layouts', 'listOrders',
  ].includes(key)),
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
  ['a v68 file with only todos + settings', V68_REQUIRED_ONLY, fixture.todos.length],
  ['a v68 file without its optional tables', V68_WITHOUT_OPTIONAL, fixture.todos.length],
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
    expect(await restoreFromImport(prepared.data)).toMatchObject({ status: 'done' })
    expect(await db.todos.count()).toBe(taskCount)
    expect(await db.todos.get(99)).toBeUndefined()
    for (const name of DATA_TABLE_NAMES) {
      // Restore seeds the Assigned status; the note store seeds the note.
      if (name === 'statuses' || name === 'settings' || name === 'notes') continue
      // The Eisenhower's own list is made when the file has none.
      const made = name === 'listDefinitions' && !prepared.data.listDefinitions.some((d) => isEisenhowerOwner(d.owner)) ? 1 : 0
      expect(await db.table(name).count(), name).toBe(prepared.data[name].length + made)
    }
    expect((await db.listDefinitions.toArray()).filter((d) => isEisenhowerOwner(d.owner))).toHaveLength(1)
  })

  it('Settings › Backups restores a backup holding it', async () => {
    const id = await backupRepository.createSnapshotFromJson(text, 'manual')
    expect(await restoreBackup(id)).toMatchObject({ status: 'done' })
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

describe('a file missing tasks or settings', () => {
  it('is no TODO2 database: a full restore refuses it', () => {
    const files = [
      JSON.stringify({ __schemaVersion: 68 }),
      JSON.stringify({ __schemaVersion: 68, settings: fixture.settings }),
      JSON.stringify({ __schemaVersion: 68, todos: fixture.todos }),
    ]
    for (const text of files) {
      const prepared = prepareImportText(text)
      expect(prepared.ok, text).toBe(false)
      if (!prepared.ok) expect(prepared.error).toContain('missing tasks or settings')
    }
    // Without a version (or below the floor) it is refused before that.
    for (const text of ['{}', JSON.stringify({ __schemaVersion: 40, people: [] }), JSON.stringify({ unrelated: [1, 2, 3] })]) {
      expect(prepareImportText(text), text).toMatchObject({ ok: false, reason: 'too-old' })
    }
  })

  it('a task archive stays a partial dataset: its missing tables arrive empty', () => {
    const archive = JSON.stringify({ __schemaVersion: 68, kind: 'task-archive', todos: fixture.todos })
    const prepared = prepareImportText(archive, { purpose: 'append' })
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.data.listDefinitions).toEqual([])
    expect(prepared.data.layouts).toEqual([])
  })
})
