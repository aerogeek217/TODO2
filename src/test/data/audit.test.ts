import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { auditData, cleanupIssues } from '../../data/audit'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const now = new Date()

function makeTodo(overrides: Partial<import('../../models').TodoItem> = {}) {
  return {
    title: 'Test todo',
    isCompleted: false,
    createdAt: now,
    modifiedAt: now,
    sortOrder: 0,
    ...overrides,
  }
}

/** Seed a canvas + project + todo so FKs are valid. Returns their IDs. */
async function seedBase() {
  const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
  const projectId = await db.projects.add({ name: 'P', canvasId, sortOrder: 0, createdAt: now } as any)
  const todoId = await db.todos.add(makeTodo({ canvasId, projectId }) as any)
  return { canvasId, projectId, todoId: todoId as number }
}

describe('auditData', () => {
  it('reports no issues on clean data', async () => {
    const { todoId } = await seedBase()
    const personId = await db.people.add({ name: 'Alice', initials: 'A', color: '#000' } as any)
    const tagId = await db.tags.add({ name: 'urgent', color: '#f00' } as any)
    const orgId = await db.orgs.add({ name: 'Acme', color: '#00f' } as any)
    await db.todoPeople.add({ todoId, personId })
    await db.todoTags.add({ todoId, tagId })
    await db.todoOrgs.add({ todoId, orgId })
    await db.personOrgs.add({ personId, orgId })
    await db.taskboardEntries.add({ todoId, sortOrder: 0 })

    const report = await auditData()
    expect(report.totalOrphans).toBe(0)
    expect(report.issues).toHaveLength(0)
  })

  it('reports no issues on empty database', async () => {
    const report = await auditData()
    expect(report.totalOrphans).toBe(0)
  })

  // --- Orphaned join rows ---

  it('detects orphaned todoPeople (deleted todo)', async () => {
    const personId = await db.people.add({ name: 'Alice', initials: 'A', color: '#000' } as any)
    await db.todoPeople.add({ todoId: 999, personId })

    const report = await auditData()
    expect(report.totalOrphans).toBe(1)
    const issue = report.issues.find((i) => i.table === 'todoPeople')!
    expect(issue.count).toBe(1)
    expect(issue.fix).toBe('delete')
  })

  it('detects orphaned todoPeople (deleted person)', async () => {
    const { todoId } = await seedBase()
    await db.todoPeople.add({ todoId, personId: 999 })

    const report = await auditData()
    expect(report.totalOrphans).toBe(1)
    expect(report.issues.find((i) => i.table === 'todoPeople')).toBeDefined()
  })

  it('detects orphaned todoTags', async () => {
    const { todoId } = await seedBase()
    await db.todoTags.add({ todoId, tagId: 999 })
    await db.todoTags.add({ todoId: 888, tagId: 999 })

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'todoTags')!
    expect(issue.count).toBe(2)
  })

  it('detects orphaned todoOrgs', async () => {
    await db.todoOrgs.add({ todoId: 999, orgId: 888 })

    const report = await auditData()
    expect(report.issues.find((i) => i.table === 'todoOrgs')!.count).toBe(1)
  })

  it('detects orphaned personOrgs', async () => {
    const orgId = await db.orgs.add({ name: 'Acme', color: '#00f' } as any)
    await db.personOrgs.add({ personId: 999, orgId })

    const report = await auditData()
    expect(report.issues.find((i) => i.table === 'personOrgs')!.count).toBe(1)
  })

  it('detects orphaned taskboardEntries', async () => {
    await db.taskboardEntries.add({ todoId: 999, sortOrder: 0 })
    await db.taskboardEntries.add({ todoId: 888, sortOrder: 1 })

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'taskboardEntries')!
    expect(issue.count).toBe(2)
  })

  // --- Dangling foreign keys ---

  it('detects todos with deleted projectId', async () => {
    const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
    await db.todos.add(makeTodo({ canvasId, projectId: 999 }) as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'todos' && i.field === 'projectId')!
    expect(issue.count).toBe(1)
    expect(issue.fix).toBe('clear-field')
  })

  it('detects todos with deleted parentId', async () => {
    const { todoId } = await seedBase()
    await db.todos.update(todoId, { parentId: 999 })

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'todos' && i.field === 'parentId')!
    expect(issue.count).toBe(1)
  })

  it('detects todos with deleted canvasId', async () => {
    await db.todos.add(makeTodo({ canvasId: 999 }) as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'todos' && i.field === 'canvasId')!
    expect(issue.count).toBe(1)
  })

  it('detects projects with deleted canvasId', async () => {
    await db.projects.add({ name: 'P', canvasId: 999, sortOrder: 0, createdAt: now } as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'projects' && i.field === 'canvasId')!
    expect(issue.count).toBe(1)
  })

  it('detects listInsets with deleted canvasId', async () => {
    await db.listInsets.add({ canvasId: 999, preset: 'due-this-week', x: 0, y: 0, width: 200, height: 200 } as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'listInsets')!
    expect(issue.count).toBe(1)
    expect(issue.fix).toBe('delete')
  })

  it('detects floating notes with deleted canvasId', async () => {
    await db.floatingNotes.add({ canvasId: 999, x: 0, y: 0, width: 150, height: 150 } as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'floatingNotes')!
    expect(issue.count).toBe(1)
    expect(issue.fix).toBe('delete')
  })

  it('detects floating calendars with deleted canvasId', async () => {
    await db.floatingCalendars.add({ canvasId: 999, x: 0, y: 0, width: 200, height: 200 } as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'floatingCalendars')!
    expect(issue.count).toBe(1)
    expect(issue.fix).toBe('delete')
  })

  it('detects todos with deleted statusId', async () => {
    const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
    await db.todos.add(makeTodo({ canvasId, statusId: 999 }) as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'todos' && i.field === 'statusId')!
    expect(issue).toBeDefined()
    expect(issue.count).toBe(1)
    expect(issue.fix).toBe('clear-field')
  })

  it('ignores todos with valid statusId', async () => {
    const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
    const statusId = await db.statuses.add({ name: 'Open', color: '#00ff00', sortOrder: 0 } as any)
    await db.todos.add(makeTodo({ canvasId, statusId }) as any)

    const report = await auditData()
    expect(report.issues.find((i) => i.field === 'statusId')).toBeUndefined()
  })

  it('ignores todos with null/undefined statusId', async () => {
    const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
    await db.todos.add(makeTodo({ canvasId }) as any)

    const report = await auditData()
    expect(report.issues.find((i) => i.field === 'statusId')).toBeUndefined()
  })

  // --- Multiple issue types at once ---

  it('detects multiple issue types in one scan', async () => {
    await db.todoPeople.add({ todoId: 999, personId: 888 })
    await db.todoTags.add({ todoId: 999, tagId: 888 })
    await db.taskboardEntries.add({ todoId: 999, sortOrder: 0 })
    await db.todos.add(makeTodo({ projectId: 777 }) as any)

    const report = await auditData()
    expect(report.issues.length).toBeGreaterThanOrEqual(4)
    expect(report.totalOrphans).toBeGreaterThanOrEqual(4)
  })

  it('treats null projectId without canvasId as valid (no issue)', async () => {
    await db.todos.add(makeTodo({}) as any) // no canvasId, no projectId

    const report = await auditData()
    expect(report.totalOrphans).toBe(0)
  })

  it('detects unplaced tasks (canvasId set but no projectId)', async () => {
    const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
    await db.todos.add(makeTodo({ canvasId }) as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.description.includes('not assigned to any project'))!
    expect(issue).toBeDefined()
    expect(issue.count).toBe(1)
    expect(issue.fix).toBe('clear-field')
    expect(issue.field).toBe('canvasId')
  })
})

describe('cleanupIssues', () => {
  it('deletes orphaned join rows', async () => {
    await db.todoPeople.add({ todoId: 999, personId: 888 })
    await db.todoTags.add({ todoId: 999, tagId: 888 })
    await db.taskboardEntries.add({ todoId: 999, sortOrder: 0 })

    const report = await auditData()
    expect(report.totalOrphans).toBe(3)

    const cleaned = await cleanupIssues(report.issues)
    expect(cleaned).toBe(3)

    expect(await db.todoPeople.count()).toBe(0)
    expect(await db.todoTags.count()).toBe(0)
    expect(await db.taskboardEntries.count()).toBe(0)
  })

  it('clears dangling projectId on todos', async () => {
    const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
    const todoId = await db.todos.add(makeTodo({ canvasId, projectId: 999 }) as any)

    const report = await auditData()
    await cleanupIssues(report.issues)

    const todo = await db.todos.get(todoId)
    expect(todo!.projectId).toBeUndefined()
    expect(todo!.title).toBe('Test todo') // rest of todo intact
  })

  it('clears dangling statusId on todos', async () => {
    const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
    const todoId = await db.todos.add(makeTodo({ canvasId, statusId: 999 }) as any)

    const report = await auditData()
    await cleanupIssues(report.issues)

    const todo = await db.todos.get(todoId)
    expect(todo!.statusId).toBeUndefined()
    expect(todo!.title).toBe('Test todo')
  })

  it('clears dangling parentId on todos', async () => {
    const { todoId } = await seedBase()
    await db.todos.update(todoId, { parentId: 999 })

    const report = await auditData()
    await cleanupIssues(report.issues)

    const todo = await db.todos.get(todoId)
    expect(todo!.parentId).toBeUndefined()
  })

  it('deletes orphaned listInsets and floating notes', async () => {
    await db.listInsets.add({ canvasId: 999, preset: 'due-this-week', x: 0, y: 0, width: 200, height: 200 } as any)
    await db.floatingNotes.add({ canvasId: 999, x: 0, y: 0, width: 150, height: 150 } as any)

    const report = await auditData()
    const cleaned = await cleanupIssues(report.issues)
    expect(cleaned).toBe(2)

    expect(await db.listInsets.count()).toBe(0)
    expect(await db.floatingNotes.count()).toBe(0)
  })

  it('preserves valid data while cleaning orphans', async () => {
    const { todoId } = await seedBase()
    const personId = await db.people.add({ name: 'Alice', initials: 'A', color: '#000' } as any)
    // Valid join row
    await db.todoPeople.add({ todoId, personId })
    // Orphaned join row
    await db.todoPeople.add({ todoId: 999, personId })

    const report = await auditData()
    expect(report.totalOrphans).toBe(1)

    await cleanupIssues(report.issues)

    const remaining = await db.todoPeople.toArray()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].todoId).toBe(todoId)
  })

  it('database is clean after cleanup', async () => {
    // Seed multiple types of orphans
    await db.todoPeople.add({ todoId: 999, personId: 888 })
    await db.todoOrgs.add({ todoId: 999, orgId: 888 })
    await db.personOrgs.add({ personId: 999, orgId: 888 })
    await db.taskboardEntries.add({ todoId: 999, sortOrder: 0 })
    // No canvasId so clearing dangling projectId won't create a new unplaced-task issue
    await db.todos.add(makeTodo({ projectId: 777, parentId: 666 }) as any)

    const report = await auditData()
    expect(report.totalOrphans).toBeGreaterThan(0)

    await cleanupIssues(report.issues)

    // Re-audit should be clean
    const after = await auditData()
    expect(after.totalOrphans).toBe(0)
    expect(after.issues).toHaveLength(0)
  })

  it('returns 0 when no issues to clean', async () => {
    const cleaned = await cleanupIssues([])
    expect(cleaned).toBe(0)
  })
})
