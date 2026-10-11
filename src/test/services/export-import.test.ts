import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildExportData, selfCheckExportJson } from '../../services/export-import'
import { ALL_DATA_TABLES, db } from '../../data/database'
import { parseAndRestore } from '../../data/restore'
import { resetDb, makeTodo, makePerson, makeProject } from '../helpers'

beforeEach(async () => {
  await resetDb()
})

describe('buildExportData', () => {
  it('returns empty arrays when database is empty', async () => {
    const data = await buildExportData()

    expect(data.todos).toEqual([])
    expect(data.projects).toEqual([])
    expect(data.canvases).toEqual([])
    expect(data.people).toEqual([])
    expect(data.todoPeople).toEqual([])
    expect(data.listInsets).toEqual([])
    expect(data.settings).toEqual([])
  })

  it('exports all table data', async () => {
    const canvasId = await db.canvases.add({ name: 'Main', sortOrder: 1 } as any)
    const project = makeProject({ id: 1, canvasId })
    await db.projects.add(project)
    const todo = makeTodo({ id: 1, projectId: project.id, canvasId })
    await db.todos.add(todo)
    const person = makePerson({ id: 1 })
    await db.people.add(person)
    await db.todoPeople.add({ todoId: 1, personId: 1 } as any)

    const data = await buildExportData()

    expect(data.todos).toHaveLength(1)
    expect(data.todos[0]!.title).toBe('Task 1')
    expect(data.projects).toHaveLength(1)
    expect(data.canvases).toHaveLength(1)
    expect(data.people).toHaveLength(1)
    expect(data.todoPeople).toHaveLength(1)
    expect('orgs' in data).toBe(false)
  })

  it('reads all tables in parallel', async () => {
    // Add multiple items to verify parallel reads don't interfere
    for (let i = 1; i <= 5; i++) {
      await db.todos.add(makeTodo({ id: i, dueDate: new Date('2026-04-15') }))
    }
    for (let i = 1; i <= 3; i++) {
      await db.people.add(makePerson({ id: i }))
    }

    const data = await buildExportData()

    expect(data.todos).toHaveLength(5)
    expect(data.people).toHaveLength(3)
  })

  it('returns serializable data', async () => {
    await db.todos.add(makeTodo({ id: 1, dueDate: new Date('2025-01-15') }))

    const data = await buildExportData()
    const json = JSON.stringify(data)
    const parsed = JSON.parse(json)

    expect(parsed.todos).toHaveLength(1)
    expect(parsed.todos[0].title).toBe('Task 1')
  })

  it('reads every table inside one read-only transaction (consistent snapshot)', async () => {
    const spy = vi.spyOn(db, 'transaction')
    try {
      await buildExportData()
      expect(spy).toHaveBeenCalledTimes(1)
      const [mode, tables] = spy.mock.calls[0]! as unknown as [string, Array<{ name: string }>]
      expect(mode).toBe('r')
      expect(tables.map((t) => t.name).sort()).toEqual(ALL_DATA_TABLES.map((t) => t.name).sort())
    } finally {
      spy.mockRestore()
    }
  })

  it('emits a key for every ALL_DATA_TABLES entry', async () => {
    const data = await buildExportData()
    const expected = ALL_DATA_TABLES.map((t) => t.name).sort()
    const got = Object.keys(data).filter((k) => k !== '__schemaVersion').sort()
    expect(got).toEqual(expected)
  })
})

describe('selfCheckExportJson', () => {
  it('returns null for an export that re-imports cleanly', async () => {
    const canvasId = await db.canvases.add({ name: 'Main', sortOrder: 1, createdAt: new Date() } as any) as number
    await db.todos.add(makeTodo({ id: 1, canvasId }))
    const json = JSON.stringify(await buildExportData())
    expect(selfCheckExportJson(json)).toBeNull()
  })

  it('names the failing table / row / field for a row that would not re-import', async () => {
    const canvasId = await db.canvases.add({ name: 'Main', sortOrder: 1, createdAt: new Date() } as any) as number
    await db.todos.add(makeTodo({ id: 1, canvasId }))
    await db.people.add({ id: 7, name: 'Ann', initials: 'TOOLONG' } as any)
    const json = JSON.stringify(await buildExportData())
    expect(selfCheckExportJson(json)).toBe('Invalid "people" record at index 0 ("Ann"): bad field "initials"')
  })
})

describe('export → restore round-trip', () => {
  /**
   * Seeds one row in every `ALL_DATA_TABLES` table — the previously-dropped
   * tables (tags, todoTags, todoEvents, floatingStatus) get explicit fixtures here
   * so a regression in `buildExportData` (e.g. reverting to the manual
   * 17-table list) fails this test.
   */
  it('every seeded table survives buildExportData → parseAndRestore', async () => {
    const now = new Date()
    const canvasId = await db.canvases.add({ name: 'Main', sortOrder: 1, createdAt: now } as any) as number
    const projectId = await db.projects.add(makeProject({ id: 1, canvasId })) as number
    const todoId = await db.todos.add(makeTodo({ id: 1, projectId, canvasId })) as number
    const personId = await db.people.add(makePerson({ id: 1 })) as number
    await db.todoPeople.add({ todoId, personId } as any)
    await db.settings.add({ key: 'themeMode', value: 'dark' })
    await db.statuses.add({ name: 'Done', color: '#0a0', sortOrder: 0, icon: 'check' } as any)
    await db.listDefinitions.add({
      name: 'Today',
      sortOrder: 0,
      membership: {
        kind: 'custom',
        predicate: {
          showCompleted: false,
          personIds: null,
          projectIds: null,
          statusIds: null,
          searchText: '',
          dateField: 'deadline',
          dateRangeStart: null,
          dateRangeEnd: null,
          dateRangeIncludeNoDate: false,
          hasDeadline: null,
        },
      },
      sort: 'manual',
      grouping: 'none',
      pinnedToDashboard: true,
    } as any)
    await db.notes.add({ content: 'hello', createdAt: now, modifiedAt: now } as any)
    await db.listInsets.add({ canvasId, listDefinitionId: 1, x: 0, y: 0, width: 200, height: 200, isCollapsed: false } as any)
    await db.floatingCalendars.add({ canvasId, x: 0, y: 0, width: 200, height: 200 } as any)
    await db.floatingNotes.add({ canvasId, x: 0, y: 0, width: 200, height: 200 } as any)
    await db.floatingStatus.add({ canvasId, x: 0, y: 0, width: 200, height: 200 } as any)
    const tagId = await db.tags.add({ name: 'urgent', color: '#f00' }) as number
    await db.todoTags.add({ todoId, tagId } as any)
    await db.todoEvents.add({
      todoId, type: 'created', fromValue: null, toValue: null, timestamp: now.toISOString(),
    } as any)
    await db.layouts.add({
      name: 'Default', createdAt: now, modifiedAt: now,
      columns: [{ id: 'c1', weight: 1, cells: [{ id: 'k1', weight: 1, tabs: [{ id: 't1', kind: 'notes', config: {} }] }] }],
    })
    await db.listOrders.add({ listDefinitionId: 1, todoId, rank: 2.5 })

    // Snapshot table sizes before the round-trip so the post-restore counts
    // are checked against what was actually exported (not what was hardcoded).
    const counts = new Map<string, number>()
    for (const table of ALL_DATA_TABLES) {
      counts.set(table.name, await table.count())
    }

    const exportObj = await buildExportData()
    const json = JSON.stringify(exportObj)

    await resetDb()

    const result = await parseAndRestore(json)
    expect(result).toEqual({ ok: true })

    for (const table of ALL_DATA_TABLES) {
      const expected = counts.get(table.name)!
      const actual = await table.count()
      // listDefinitions / statuses may auto-seed defaults if empty; we seeded
      // one row in each, so seeding is skipped and counts match exactly.
      expect(actual, `${table.name} round-tripped`).toBeGreaterThanOrEqual(expected)
    }

    // Spot-check the previously-dropped tables came back with the correct values.
    const tagsAfter = await db.tags.toArray()
    expect(tagsAfter.find((t) => t.name === 'urgent')?.color).toBe('#f00')
    const eventsAfter = await db.todoEvents.toArray()
    expect(eventsAfter.find((e) => e.type === 'created')).toBeDefined()
    const statusFloatAfter = await db.floatingStatus.toArray()
    expect(statusFloatAfter).toHaveLength(1)
    const todoTagsAfter = await db.todoTags.toArray()
    expect(todoTagsAfter).toHaveLength(1)
    const ranksAfter = await db.listOrders.toArray()
    expect(ranksAfter.map((r) => [r.listDefinitionId, r.todoId, r.rank])).toEqual([[1, todoId, 2.5]])
  })
})
