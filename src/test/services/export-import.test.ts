import { describe, it, expect, beforeEach } from 'vitest'
import { buildExportData } from '../../services/export-import'
import { db } from '../../data/database'
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
    expect(data.savedViews).toEqual([])
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
    expect(data.todos[0].title).toBe('Task 1')
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
})
