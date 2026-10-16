import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildExportData, selfCheckExportJson } from '../../data/export-data'
import { buildMarkdownExport } from '../../services/markdown-export'
import { buildTasksPlain } from '../../services/task-copy'
import { ALL_DATA_TABLES, db } from '../../data/database'
import { parseAndRestore } from '../../data/restore'
import { resetDb, makeTodo, makePerson } from '../helpers'
import type { PersistedTodoItem } from '../../models'

beforeEach(async () => {
  await resetDb()
})

describe('buildExportData', () => {
  it('returns empty arrays when database is empty', async () => {
    const data = await buildExportData()

    for (const table of ALL_DATA_TABLES) {
      expect(data[table.name as keyof typeof data], table.name).toEqual([])
    }
  })

  it('exports all table data', async () => {
    await db.todos.add(makeTodo({ id: 1 }))
    await db.people.add(makePerson({ id: 1 }))
    await db.todoPeople.add({ todoId: 1, personId: 1 } as any)
    await db.tags.add({ id: 1, name: 'urgent', color: '#f00' })
    await db.todoTags.add({ todoId: 1, tagId: 1 })

    const data = await buildExportData()

    expect(data.todos).toHaveLength(1)
    expect(data.todos[0]!.title).toBe('Task 1')
    expect(data.people).toHaveLength(1)
    expect(data.todoPeople).toHaveLength(1)
    expect(data.tags).toHaveLength(1)
    expect(data.todoTags).toHaveLength(1)
    for (const removed of ['orgs', 'projects', 'canvases', 'listInsets', 'floatingNotes']) {
      expect(removed in data, removed).toBe(false)
    }
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
    await db.todos.add(makeTodo({ id: 1 }))
    const json = JSON.stringify(await buildExportData())
    expect(selfCheckExportJson(json)).toBeNull()
  })

  it('names the failing table / row / field for a row that would not re-import', async () => {
    await db.todos.add(makeTodo({ id: 1 }))
    await db.people.add({ id: 7, name: 'Ann', initials: 'TOOLONG' } as any)
    const json = JSON.stringify(await buildExportData())
    expect(selfCheckExportJson(json)).toBe('Invalid "people" record at index 0 ("Ann"): bad field "initials"')
  })
})

describe('export → restore round-trip', () => {
  /**
   * Seeds one row in every `ALL_DATA_TABLES` table — the previously-dropped
   * tables (tags, todoTags, todoEvents) get explicit fixtures here
   * so a regression in `buildExportData` (e.g. reverting to the manual
   * 17-table list) fails this test.
   */
  it('every seeded table survives buildExportData → parseAndRestore', async () => {
    const now = new Date()
    const todoId = await db.todos.add(makeTodo({ id: 1 })) as number
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
    } as any)
    await db.notes.add({ content: 'hello', createdAt: now, modifiedAt: now } as any)
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
      expect(counts.get(table.name), `${table.name} seeded`).toBeGreaterThan(0)
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
    expect((await db.layouts.toArray()).map((l) => l.name)).toEqual(['Default'])
    const todoTagsAfter = await db.todoTags.toArray()
    expect(todoTagsAfter).toHaveLength(1)
    const ranksAfter = await db.listOrders.toArray()
    expect(ranksAfter.map((r) => [r.listDefinitionId, r.todoId, r.rank])).toEqual([[1, todoId, 2.5]])
  })
})

describe('buildMarkdownExport', () => {
  it('lists every task flat, in manual order, with status, deadline and done marks', async () => {
    await db.statuses.add({ id: 3, name: 'Waiting', color: '#888888', sortOrder: 0, icon: 'clock' } as any)
    await db.todos.add(makeTodo({ id: 1, title: 'Second', sortOrder: 2, isCompleted: true }))
    await db.todos.add(makeTodo({ id: 2, title: 'First', sortOrder: 1, statusId: 3, dueDate: new Date(2026, 9, 16) }))
    await db.todos.add(makeTodo({ id: 3, title: 'Third', sortOrder: 3 }))

    const md = await buildMarkdownExport()
    const lines = md.split('\n')
    expect(lines.slice(0, 2)).toEqual(['# TODOs', ''])
    expect(lines.filter((l) => l.startsWith('- ['))).toEqual([
      `- [ ] First [Waiting] (due ${new Date(2026, 9, 16).toLocaleDateString()})`,
      '- [x] Second',
      '- [ ] Third',
    ])
    // One flat list: no section headings, and no details section without details.
    expect(lines.filter((l) => l.startsWith('#'))).toEqual(['# TODOs'])
  })

  it('a line is the rich-copy task line (without people); a status without an icon is not named', async () => {
    await db.statuses.add({ id: 3, name: 'Waiting', color: '#888888', sortOrder: 0, icon: 'clock' } as any)
    await db.statuses.add({ id: 4, name: 'Plain', color: '#888888', sortOrder: 1 } as any)
    const followup = new Date(2026, 10, 2)
    await db.todos.add(makeTodo({ id: 1, title: 'A', sortOrder: 1, statusId: 3, dueDate: new Date(2026, 9, 16), nextFollowupAt: followup }))
    await db.todos.add(makeTodo({ id: 2, title: 'B', sortOrder: 2, statusId: 4 }))
    await db.people.add(makePerson({ id: 1, name: 'Ann' }))
    await db.todoPeople.add({ todoId: 1, personId: 1 })

    const md = await buildMarkdownExport()
    const todos = (await db.todos.orderBy('sortOrder').toArray()) as PersistedTodoItem[]
    const plain = buildTasksPlain([{ todos }], {
      assignedPeopleMap: new Map(),
      statusMap: new Map([[3, { id: 3, name: 'Waiting', color: '#888888', sortOrder: 0 }]]),
    })
    expect(md.split('\n').filter((l) => l.startsWith('- ['))).toEqual(plain.split('\n').map((l) => `- ${l}`))
    expect(plain).toContain('(follow-up ')
  })

  it('adds a details section with the people, tags and notes of each task that has them', async () => {
    await db.todos.add(makeTodo({ id: 1, title: 'Plain', sortOrder: 1 }))
    await db.todos.add(makeTodo({ id: 2, title: 'Report', sortOrder: 2, notes: 'Use the **new** template' }))
    await db.people.add(makePerson({ id: 1, name: 'Ann Lee' }))
    await db.people.add(makePerson({ id: 2, name: 'Bob Stone' }))
    await db.todoPeople.bulkAdd([{ todoId: 2, personId: 1 }, { todoId: 2, personId: 2 }])
    await db.tags.bulkAdd([{ id: 1, name: 'urgent', color: '#ff0000' }, { id: 2, name: 'Project: Work', color: '#537FE7' }])
    await db.todoTags.bulkAdd([{ todoId: 2, tagId: 1 }, { todoId: 2, tagId: 2 }])

    const md = await buildMarkdownExport()
    expect(md.slice(md.indexOf('# Task Details')).split('\n')).toEqual([
      '# Task Details',
      '',
      '### Report',
      '- **People:** Ann Lee, Bob Stone',
      '- **Tags:** urgent, Project: Work',
      '- **Notes:** Use the **new** template',
      '',
    ])
  })
})
