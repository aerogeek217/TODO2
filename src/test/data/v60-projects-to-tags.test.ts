import { afterEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { CURRENT_DB_VERSION, db } from '../../data/database'
import { SCHEMA_UPGRADES, type DataRow, type DataSet } from '../../data/schema-upgrades'
import {
  upgradeV60,
  V60_DEFAULT_TAG_COLOR,
  V60_DROPPED_TABLES,
  V60_REMOVED_SETTING_KEYS,
} from '../../data/upgrades/v60-projects-to-tags'
import { prepareImport } from '../../data/import-pipeline'
import { validateImportData } from '../../data/import-validation'
import { auditData } from '../../data/audit'
import { resetDb, v59StoreSpecs } from '../helpers'

const AT = new Date('2026-10-01T09:00:00.000Z')

function todo(id: number, extra: DataRow = {}): DataRow {
  return { id, uid: `u${id}`, title: `T${id}`, isCompleted: false, createdAt: AT, modifiedAt: AT, sortOrder: id, ...extra }
}

function predicate(extra: DataRow = {}): DataRow {
  return {
    showCompleted: false, personIds: null, projectIds: null, statusIds: null, searchText: '', dateField: 'deadline',
    dateRangeStart: null, dateRangeEnd: null, dateRangeIncludeNoDate: false, hasDeadline: null, hasFollowup: null,
    focus: null, tags: null, ...extra,
  }
}

function list(id: number, name: string, extra: DataRow = {}, pred: DataRow = {}): DataRow {
  return {
    id, name, sortOrder: id, pinnedToDashboard: false, sort: 'manual', grouping: 'none',
    membership: { kind: 'custom', predicate: predicate(pred) }, ...extra,
  }
}

/** A v59 dataset: two projects (one named like an existing tag), project-filtered lists, canvas tables and settings. */
function v59DataSet(): DataSet {
  return {
    canvases: [{ id: 1, name: 'Main', sortOrder: 0, createdAt: AT }],
    projects: [
      { id: 1, name: 'Work', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 0, createdAt: AT, color: '#4f8cff' },
      { id: 2, name: ' Home ', canvasId: 1, positionX: 300, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: AT },
      // Same name as an existing tag (case-insensitive): that tag is reused.
      { id: 3, name: 'errands', canvasId: 1, positionX: 600, positionY: 0, isCollapsed: false, sortOrder: 2, createdAt: AT, color: '#ff0000' },
    ],
    tags: [{ id: 7, name: 'urgent', color: '#ff3b30' }, { id: 9, name: 'Project: Errands', color: '#34c759' }],
    todos: [
      todo(1, { projectId: 1, canvasId: 1 }),
      todo(2, { projectId: 2, canvasId: 1 }),
      todo(3, { projectId: 3, canvasId: 1 }),
      todo(4, { canvasId: 1 }),
      todo(5),
      // A project that no longer exists: the id goes, no tag.
      todo(6, { projectId: 99, canvasId: 1 }),
    ],
    // Task 3 already has the reused tag: no duplicate pair.
    todoTags: [{ id: 1, todoId: 1, tagId: 7 }, { id: 4, todoId: 3, tagId: 9 }],
    listDefinitions: [
      list(1, 'Plain'),
      list(2, 'Work only', { grouping: 'project', sort: 'project' }, { projectIds: [1] }),
      list(3, 'Work or urgent', {}, { projectIds: [1, 2], tags: [7] }),
      list(4, 'No project', {}, { projectIds: [0] }),
      list(5, 'Work + no project', {}, { projectIds: [1, 0] }),
      list(6, 'Nothing', {}, { projectIds: [] }),
      list(7, 'Gone project', {}, { projectIds: [99] }),
      list(8, 'Prompted', { runtimeFilter: { field: 'project', label: 'Which' } }),
    ],
    listInsets: [{ id: 1, listDefinitionId: 2, canvasId: 1, x: 0, y: 0, width: 300, height: 200, isCollapsed: false }],
    floatingCalendars: [{ id: 1, canvasId: 1, x: 0, y: 0, width: 300, height: 200 }],
    floatingNotes: [{ id: 1, canvasId: 1, x: 0, y: 0, width: 300, height: 200 }],
    floatingStatus: [{ id: 1, canvasId: 1, x: 0, y: 0, width: 300, height: 200 }],
    settings: [
      { key: 'themeMode', value: 'dark' },
      { key: 'defaultProjectId', value: '1' },
      { key: 'defaultProjectGroupBy', value: 'status' },
      { key: 'canvasViewport', value: '{"x":0,"y":0,"zoom":1}' },
      { key: 'canvasMaxExtent', value: '20000' },
      { key: 'canvasRails', value: '{"left":null,"right":null,"top":null,"bottom":null}' },
    ],
    notes: [{ id: 1, content: 'hi', createdAt: AT, modifiedAt: AT }],
  }
}

function tagsOf(out: DataSet, todoId: number): number[] {
  return out.todoTags!.filter((r) => r.todoId === todoId).map((r) => r.tagId as number).sort((a, b) => a - b)
}

function listById(out: DataSet, id: number): DataRow {
  return out.listDefinitions!.find((d) => d.id === id)!
}

function predOf(out: DataSet, id: number): DataRow {
  return (listById(out, id).membership as { predicate: DataRow }).predicate
}

describe('upgradeV60 (pure)', () => {
  // Console spies must not outlive their test (shuffled order would pile up calls).
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is registered for v60', () => {
    expect(SCHEMA_UPGRADES.get(60)).toBe(upgradeV60)
  })

  it('makes a Project: <name> tag per project (trimmed name, its color or the default); reuses a same-named tag', () => {
    const out = upgradeV60(v59DataSet())
    expect(out.tags).toEqual([
      { id: 7, name: 'urgent', color: '#ff3b30' },
      { id: 9, name: 'Project: Errands', color: '#34c759' },
      { id: 10, name: 'Project: Work', color: '#4f8cff' },
      { id: 11, name: 'Project: Home', color: V60_DEFAULT_TAG_COLOR },
    ])
  })

  it('tags every task with its project; skips pairs already there; drops projectId / canvasId', () => {
    const out = upgradeV60(v59DataSet())
    expect(tagsOf(out, 1)).toEqual([7, 10])
    expect(tagsOf(out, 2)).toEqual([11])
    expect(tagsOf(out, 3)).toEqual([9])
    expect(tagsOf(out, 4)).toEqual([])
    expect(tagsOf(out, 6)).toEqual([])
    // New join rows get ids after the current maximum.
    expect(out.todoTags!.map((r) => r.id)).toEqual([1, 4, 5, 6])
    for (const t of out.todos!) expect('projectId' in t || 'canvasId' in t, `todo ${String(t.id)}`).toBe(false)
  })

  it('folds project filters into the tag filter (union), project grouping → tag, project sort → manual, prompt → tag', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = upgradeV60(v59DataSet())
    for (const d of out.listDefinitions!) expect('projectIds' in predOf(out, d.id as number)).toBe(false)
    expect(predOf(out, 1).tags).toBeNull()
    expect(listById(out, 2)).toMatchObject({ grouping: 'tag', sort: 'manual' })
    expect(predOf(out, 2).tags).toEqual([10])
    expect(predOf(out, 3).tags).toEqual([7, 10, 11])
    // "No project" has no tag equivalent: dropped. Alone → no filter left.
    expect(predOf(out, 4).tags).toBeNull()
    expect(predOf(out, 5).tags).toEqual([10])
    // An empty filter matched nothing and still does; so did a deleted project.
    expect(predOf(out, 6).tags).toEqual([])
    expect(predOf(out, 7).tags).toEqual([])
    expect(listById(out, 8).runtimeFilter).toEqual({ field: 'tag', label: 'Which' })
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]![0])).toContain('No project, Work + no project')
  })

  it('drops the canvas tables and the canvas / project settings; keeps notes and other settings', () => {
    const out = upgradeV60(v59DataSet())
    for (const t of V60_DROPPED_TABLES) expect(t in out, t).toBe(false)
    expect(out.settings).toEqual([{ key: 'themeMode', value: 'dark' }])
    expect(out.notes).toHaveLength(1)
    expect(V60_REMOVED_SETTING_KEYS).toHaveLength(5)
  })

  it('the result passes import validation', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = validateImportData(upgradeV60(v59DataSet()))
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
  })

  it('is idempotent: v60-shaped data comes back as the same object', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const once = upgradeV60(v59DataSet())
    expect(upgradeV60(once)).toBe(once)
    const clean: DataSet = { todos: [todo(1)], tags: [], settings: [{ key: 'themeMode', value: 'dark' }] }
    expect(upgradeV60(clean)).toBe(clean)
  })

  it('a task archive (no settings / lists) gets its project tags and joins', () => {
    const archive: DataSet = {
      todos: [todo(1, { projectId: 1, canvasId: 1 }), todo(2, { projectId: 5 })],
      todoTags: [],
      tags: [],
      projects: [{ id: 1, name: 'Work', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 0, createdAt: AT }],
    }
    const out = upgradeV60(archive)
    expect(out.tags).toEqual([{ id: 1, name: 'Project: Work', color: V60_DEFAULT_TAG_COLOR }])
    expect(out.todoTags).toEqual([{ id: 1, todoId: 1, tagId: 1 }])
    expect('projects' in out).toBe(false)
    expect('settings' in out || 'listDefinitions' in out).toBe(false)
  })

  it('skips malformed rows instead of throwing', () => {
    const data: DataSet = {
      projects: [{ id: 'x' }, { name: 'No id' }, { id: 1, name: 'Ok', canvasId: 1 }] as DataRow[],
      todos: [{ id: 1, projectId: 1 }, { title: 'no id', projectId: 1 }] as DataRow[],
      listDefinitions: [{ id: 1, membership: { kind: 'custom', predicate: { projectIds: 'bad' } } }, 'nope' as unknown as DataRow],
    }
    const out = upgradeV60(data)
    expect(out.tags).toEqual([{ id: 1, name: 'Project: Ok', color: V60_DEFAULT_TAG_COLOR }])
    expect(out.todoTags).toEqual([{ id: 1, todoId: 1, tagId: 1 }])
    expect((out.listDefinitions![0]!.membership as { predicate: DataRow }).predicate).toEqual({})
  })
})

describe('v60 Dexie upgrade', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await resetDb()
  })

  async function buildV59Db(): Promise<void> {
    db.close()
    await Dexie.delete(db.name)
    const v59 = new Dexie(db.name)
    v59.version(59).stores(v59StoreSpecs())
    await v59.open()
    for (const [table, rows] of Object.entries(v59DataSet())) await v59.table(table).bulkAdd(rows)
    v59.close()
  }

  it('drops the canvas stores and matches the import path row for row', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await buildV59Db()
    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
    const stores = Array.from(db.backendDB().objectStoreNames)
    for (const t of V60_DROPPED_TABLES) expect(stores, t).not.toContain(t)
    expect(db.todos.schema.indexes.map((i) => i.name)).not.toContain('projectId')

    const prepared = prepareImport(JSON.parse(JSON.stringify({ __schemaVersion: 59, ...v59DataSet() })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.warnings).toEqual([])
    const byId = <T extends { id?: number }>(rows: readonly T[]) => [...rows].sort((a, b) => a.id! - b.id!)
    expect(byId(prepared.data.todos)).toEqual(await db.todos.orderBy('id').toArray())
    expect(byId(prepared.data.tags ?? [])).toEqual(await db.tags.orderBy('id').toArray())
    expect(byId(prepared.data.todoTags ?? [])).toEqual(await db.todoTags.orderBy('id').toArray())
    expect(byId(prepared.data.listDefinitions)).toEqual(await db.listDefinitions.orderBy('id').toArray())
    const settings = await db.settings.orderBy('key').toArray()
    expect([...prepared.data.settings].sort((a, b) => a.key.localeCompare(b.key))).toEqual(settings)
  })

  it('leaves nothing for the audit to flag', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await buildV59Db()
    await db.open()
    const report = await auditData()
    expect(report.issues).toEqual([])
  })
})
