import { describe, it, expect, beforeEach } from 'vitest'
import { db, runV21Migration, ensureSeededListDefinitions } from '../../data/database'
import type { ListDefinition } from '../../models/list-definition'

/**
 * These tests seed the v21 schema with pre-v21 shaped records (extra fields
 * like `priority` / `isHardDeadline` are tolerated by Dexie because they
 * aren't indexed), then invoke runV21Migration directly to exercise the
 * in-place record transform.
 */

describe('v21 migration', () => {
  let canvasId: number

  beforeEach(async () => {
    await db.delete()
    await db.open()
    canvasId = await db.canvases.add({ name: 'Main', sortOrder: 0, createdAt: new Date() } as never)
  })

  async function runMigration() {
    await db.transaction(
      'rw',
      [db.todos, db.listInsets, db.listDefinitions],
      async (tx) => {
        await runV21Migration(tx)
      },
    )
  }

  function makeRawTodo(overrides: Record<string, unknown>) {
    return {
      title: 'Task',
      priority: 0,
      isCompleted: false,
      sortOrder: 1,
      createdAt: new Date(),
      modifiedAt: new Date(),
      canvasId,
      ...overrides,
    }
  }

  // ---------- Q2 rule (a): recurrence forces deadline ----------

  it('rule (a): recurrence + dueDate + soft → keeps as deadline', async () => {
    const due = new Date(2026, 3, 20)
    const id = await db.todos.add(makeRawTodo({
      dueDate: due,
      isHardDeadline: false,
      recurrenceRule: { type: 'weekly' },
    }) as never)

    await runMigration()
    const row = (await db.todos.get(id)) as unknown as Record<string, unknown>
    expect(row.dueDate).toEqual(due)
    expect(row.scheduledDate).toBeUndefined()
    expect('priority' in row).toBe(false)
    expect('isHardDeadline' in row).toBe(false)
    expect(row.recurrenceRule).toEqual({ type: 'weekly' })
  })

  it('rule (a): recurrence + dueDate with isHardDeadline undefined → stays deadline', async () => {
    const due = new Date(2026, 3, 20)
    const id = await db.todos.add(makeRawTodo({
      dueDate: due,
      recurrenceRule: { type: 'monthly' },
    }) as never)

    await runMigration()
    const row = (await db.todos.get(id)) as unknown as Record<string, unknown>
    expect(row.dueDate).toEqual(due)
    expect(row.scheduledDate).toBeUndefined()
  })

  // ---------- Q2 rule (b): hard + dueDate ----------

  it('rule (b): isHardDeadline=true + dueDate → keeps as deadline', async () => {
    const due = new Date(2026, 3, 20)
    const id = await db.todos.add(makeRawTodo({
      dueDate: due,
      isHardDeadline: true,
    }) as never)

    await runMigration()
    const row = (await db.todos.get(id)) as unknown as Record<string, unknown>
    expect(row.dueDate).toEqual(due)
    expect(row.scheduledDate).toBeUndefined()
    expect('isHardDeadline' in row).toBe(false)
  })

  // ---------- Q2 rule (c): hard + no dueDate (tautology) ----------

  it('rule (c): isHardDeadline=true + no dueDate → flag dropped, no dates', async () => {
    const id = await db.todos.add(makeRawTodo({
      isHardDeadline: true,
    }) as never)

    await runMigration()
    const row = (await db.todos.get(id)) as unknown as Record<string, unknown>
    expect(row.dueDate).toBeUndefined()
    expect(row.scheduledDate).toBeUndefined()
    expect('isHardDeadline' in row).toBe(false)
  })

  // ---------- Q2 rule (d): soft-due without recurrence → scheduled ----------

  it('rule (d): soft-due (isHardDeadline=false) + no recurrence → scheduled', async () => {
    const due = new Date(2026, 3, 20)
    const id = await db.todos.add(makeRawTodo({
      dueDate: due,
      isHardDeadline: false,
    }) as never)

    await runMigration()
    const row = (await db.todos.get(id)) as unknown as Record<string, unknown>
    expect(row.dueDate).toBeUndefined()
    const sched = row.scheduledDate as { kind: string; value: Date }
    expect(sched.kind).toBe('date')
    expect(sched.value).toEqual(due)
  })

  it('rule (d): dueDate + isHardDeadline undefined + no recurrence → scheduled', async () => {
    const due = new Date(2026, 3, 20)
    const id = await db.todos.add(makeRawTodo({ dueDate: due }) as never)

    await runMigration()
    const row = (await db.todos.get(id)) as unknown as Record<string, unknown>
    expect(row.dueDate).toBeUndefined()
    const sched = row.scheduledDate as { kind: string; value: Date }
    expect(sched.kind).toBe('date')
    expect(sched.value).toEqual(due)
  })

  // ---------- Q2 rule (e): no-op ----------

  it('rule (e): no dueDate + no hard flag → no-op on dates', async () => {
    const id = await db.todos.add(makeRawTodo({}) as never)

    await runMigration()
    const row = (await db.todos.get(id)) as unknown as Record<string, unknown>
    expect(row.dueDate).toBeUndefined()
    expect(row.scheduledDate).toBeUndefined()
  })

  // ---------- priority + isHardDeadline always stripped ----------

  it('strips priority from every row regardless of value', async () => {
    await db.todos.add(makeRawTodo({ priority: 0 }) as never)
    await db.todos.add(makeRawTodo({ priority: 1 }) as never)
    await db.todos.add(makeRawTodo({ priority: 2 }) as never)

    await runMigration()
    const rows = await db.todos.toArray() as unknown as Record<string, unknown>[]
    for (const r of rows) {
      expect('priority' in r).toBe(false)
    }
  })

  it('strips isHardDeadline from every row regardless of branch', async () => {
    await db.todos.add(makeRawTodo({ isHardDeadline: true, dueDate: new Date(2026, 3, 20) }) as never)
    await db.todos.add(makeRawTodo({ isHardDeadline: false, dueDate: new Date(2026, 3, 21) }) as never)
    await db.todos.add(makeRawTodo({ isHardDeadline: true }) as never)
    await db.todos.add(makeRawTodo({}) as never)

    await runMigration()
    const rows = await db.todos.toArray() as unknown as Record<string, unknown>[]
    for (const r of rows) {
      expect('isHardDeadline' in r).toBe(false)
    }
  })

  // ---------- List-inset cleanup ----------

  it('deletes list insets with preset=high-priority and preserves due-this-week', async () => {
    await db.listInsets.add({
      name: 'High Priority', preset: 'high-priority', canvasId,
      x: 0, y: 0, width: 300, height: 400, isCollapsed: false,
    } as never)
    await db.listInsets.add({
      name: 'Due This Week', preset: 'due-this-week', canvasId,
      x: 400, y: 0, width: 300, height: 400, isCollapsed: false,
    } as never)

    await runMigration()
    const insets = await db.listInsets.toArray()
    expect(insets).toHaveLength(1)
    expect(insets[0].preset).toBe('due-this-week')
  })

  it('deletes list insets with attributeFilter.type=priority and preserves tag-attributeFilter', async () => {
    await db.listInsets.add({
      name: 'Priority',
      attributeFilter: { type: 'priority', priority: 2 } as never,
      canvasId, x: 0, y: 0, width: 300, height: 400, isCollapsed: false,
    } as never)
    await db.listInsets.add({
      name: 'Work Tag',
      attributeFilter: { type: 'tag', tagId: 1, tagName: 'work' } as never,
      canvasId, x: 400, y: 0, width: 300, height: 400, isCollapsed: false,
    } as never)

    await runMigration()
    const insets = await db.listInsets.toArray()
    expect(insets).toHaveLength(1)
    const filter = insets[0].attributeFilter as { type: string } | undefined
    expect(filter?.type).toBe('tag')
  })

  it('handles inset with BOTH preset=high-priority AND priority attributeFilter (single deletion)', async () => {
    await db.listInsets.add({
      name: 'Legacy',
      preset: 'high-priority',
      attributeFilter: { type: 'priority', priority: 2 } as never,
      canvasId, x: 0, y: 0, width: 300, height: 400, isCollapsed: false,
    } as never)

    await runMigration()
    const insets = await db.listInsets.toArray()
    expect(insets).toHaveLength(0)
  })

  // ---------- listDefinitions seeding ----------

  it('seeds all 4 listDefinitions in correct order on empty table', async () => {
    await runMigration()
    const defs = await db.listDefinitions.orderBy('sortOrder').toArray()
    expect(defs).toHaveLength(4)
    expect(defs.map(d => d.name)).toEqual(['Today', 'Upcoming', 'Deadlines', 'Someday'])
    expect(defs.map(d => d.sortOrder)).toEqual([0, 1, 2, 3])
    expect(defs.map(d => d.membership.kind)).toEqual(['today', 'upcoming', 'deadlines', 'someday'])
    // v22: pinnedToDashboard defaults true on seed
    for (const d of defs) expect(d.pinnedToDashboard).toBe(true)
  })

  it('does not re-seed when listDefinitions already has rows (v22 "insert iff empty" semantics)', async () => {
    await runMigration()
    const firstCount = (await db.listDefinitions.toArray()).length

    await runMigration()
    const secondCount = (await db.listDefinitions.toArray()).length

    expect(firstCount).toBe(4)
    expect(secondCount).toBe(4)
  })

  it('preserves user-customized rows without adding duplicates (v22: no re-seed on non-empty)', async () => {
    await db.listDefinitions.add({
      name: 'My Today',
      sortOrder: 0,
      pinnedToDashboard: true,
      membership: { kind: 'today' },
      sort: { kind: 'effective-date-asc' },
      grouping: { kind: 'none' },
    } as ListDefinition)

    await runMigration()
    const defs = await db.listDefinitions.orderBy('sortOrder').toArray()
    expect(defs).toHaveLength(1)
    expect(defs[0].name).toBe('My Today')
  })

  // ---------- ensureSeededListDefinitions directly ----------

  it('ensureSeededListDefinitions is idempotent', async () => {
    await ensureSeededListDefinitions(db.listDefinitions)
    const firstCount = (await db.listDefinitions.toArray()).length
    await ensureSeededListDefinitions(db.listDefinitions)
    const secondCount = (await db.listDefinitions.toArray()).length
    expect(firstCount).toBe(4)
    expect(secondCount).toBe(4)
  })

  // ---------- Composite run ----------

  it('runs with todos, insets, and listDefinitions all present', async () => {
    await db.todos.add(makeRawTodo({ priority: 2, isHardDeadline: true, dueDate: new Date(2026, 3, 20) }) as never)
    await db.todos.add(makeRawTodo({ priority: 1, dueDate: new Date(2026, 3, 21), isHardDeadline: false }) as never)
    await db.listInsets.add({
      name: 'HP', preset: 'high-priority', canvasId,
      x: 0, y: 0, width: 300, height: 400, isCollapsed: false,
    } as never)

    await runMigration()

    const todos = await db.todos.toArray() as unknown as Record<string, unknown>[]
    expect(todos).toHaveLength(2)
    for (const t of todos) {
      expect('priority' in t).toBe(false)
      expect('isHardDeadline' in t).toBe(false)
    }

    const insets = await db.listInsets.toArray()
    expect(insets).toHaveLength(0)

    const defs = await db.listDefinitions.toArray()
    expect(defs).toHaveLength(4)
  })
})
