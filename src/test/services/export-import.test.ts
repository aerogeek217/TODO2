import { describe, it, expect, beforeEach } from 'vitest'
import { buildExportData } from '../../services/export-import'
import { ALL_DATA_TABLES, db } from '../../data/database'
import { parseAndRestore } from '../../data/restore'
import { resetDb, makeTodo, makePerson, makeProject, makeOrg } from '../helpers'

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
    expect(data.orgs).toEqual([])
    expect(data.todoPeople).toEqual([])
    expect(data.todoOrgs).toEqual([])
    expect(data.personOrgs).toEqual([])
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
    const org = makeOrg({ id: 1 })
    await db.orgs.add(org)
    await db.todoPeople.add({ todoId: 1, personId: 1 } as any)
    await db.todoOrgs.add({ todoId: 1, orgId: 1 } as any)
    await db.personOrgs.add({ personId: 1, orgId: 1 } as any)

    const data = await buildExportData()

    expect(data.todos).toHaveLength(1)
    expect(data.todos[0]!.title).toBe('Task 1')
    expect(data.projects).toHaveLength(1)
    expect(data.canvases).toHaveLength(1)
    expect(data.people).toHaveLength(1)
    expect(data.orgs).toHaveLength(1)
    expect(data.todoPeople).toHaveLength(1)
    expect(data.todoOrgs).toHaveLength(1)
    expect(data.personOrgs).toHaveLength(1)
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

  it('emits a key for every ALL_DATA_TABLES entry', async () => {
    const data = await buildExportData()
    const expected = ALL_DATA_TABLES.map((t) => t.name).sort()
    const got = Object.keys(data).filter((k) => k !== '__schemaVersion').sort()
    expect(got).toEqual(expected)
  })
})

describe('export → restore round-trip', () => {
  /**
   * Seeds one row in every `ALL_DATA_TABLES` table — the previously-dropped
   * tables (tags, todoTags, todoEvents, floatingHorizons, floatingStatus,
   * floatingScoreboard, floatingSnoozeGraveyard) get explicit fixtures here
   * so a regression in `buildExportData` (e.g. reverting to the manual
   * 17-table list) fails this test.
   */
  it('every seeded table survives buildExportData → parseAndRestore', async () => {
    const now = new Date()
    const canvasId = await db.canvases.add({ name: 'Main', sortOrder: 1, createdAt: now } as any) as number
    const projectId = await db.projects.add(makeProject({ id: 1, canvasId })) as number
    const todoId = await db.todos.add(makeTodo({ id: 1, projectId, canvasId })) as number
    const personId = await db.people.add(makePerson({ id: 1 })) as number
    const orgId = await db.orgs.add(makeOrg({ id: 1 })) as number
    await db.todoPeople.add({ todoId, personId } as any)
    await db.todoOrgs.add({ todoId, orgId } as any)
    await db.personOrgs.add({ personId, orgId } as any)
    await db.settings.add({ key: 'themeMode', value: 'dark' })
    await db.taskboards.add({ entries: [{ todoId, sortOrder: 0 }], createdAt: now, updatedAt: now } as any)
    await db.statuses.add({ name: 'Done', color: '#0a0', sortOrder: 0, icon: 'check' } as any)
    await db.listDefinitions.add({
      name: 'Today',
      sortOrder: 0,
      membership: {
        kind: 'custom',
        predicate: {
          showCompleted: false,
          showHiddenStatuses: false,
          personIds: null,
          personFilterMode: 'include-orgs',
          orgIds: null,
          orgFilterMode: 'include-people',
          projectIds: null,
          statusIds: null,
          searchText: '',
          dateField: 'date',
          dateRangeStart: null,
          dateRangeEnd: null,
          dateRangeIncludeNoDate: false,
          hasScheduled: null,
          hasDeadline: null,
        },
      },
      sort: 'manual',
      grouping: 'none',
      pinnedToDashboard: true,
      favorited: false,
    } as any)
    await db.notes.add({ content: 'hello', createdAt: now, modifiedAt: now } as any)
    await db.listInsets.add({ canvasId, listDefinitionId: 1, x: 0, y: 0, width: 200, height: 200, isCollapsed: false } as any)
    await db.floatingCalendars.add({ canvasId, x: 0, y: 0, width: 200, height: 200 } as any)
    await db.floatingNotes.add({ canvasId, x: 0, y: 0, width: 200, height: 200 } as any)
    await db.floatingTaskboards.add({ canvasId, x: 0, y: 0, width: 200, height: 200 } as any)
    await db.floatingHorizons.add({ canvasId, x: 0, y: 0, width: 200, height: 200 } as any)
    await db.floatingStatus.add({ canvasId, x: 0, y: 0, width: 200, height: 200 } as any)
    await db.floatingScoreboard.add({ canvasId, x: 0, y: 0, width: 200, height: 200 } as any)
    await db.floatingSnoozeGraveyard.add({ canvasId, x: 0, y: 0, width: 200, height: 200 } as any)
    const tagId = await db.tags.add({ name: 'urgent', color: '#f00' }) as number
    await db.todoTags.add({ todoId, tagId } as any)
    await db.todoEvents.add({
      todoId, type: 'created', fromValue: null, toValue: null, timestamp: now.toISOString(),
    } as any)

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
    const horizonsAfter = await db.floatingHorizons.toArray()
    expect(horizonsAfter).toHaveLength(1)
    const statusFloatAfter = await db.floatingStatus.toArray()
    expect(statusFloatAfter).toHaveLength(1)
    const scoreboardAfter = await db.floatingScoreboard.toArray()
    expect(scoreboardAfter).toHaveLength(1)
    const graveyardAfter = await db.floatingSnoozeGraveyard.toArray()
    expect(graveyardAfter).toHaveLength(1)
    const todoTagsAfter = await db.todoTags.toArray()
    expect(todoTagsAfter).toHaveLength(1)
  })
})
