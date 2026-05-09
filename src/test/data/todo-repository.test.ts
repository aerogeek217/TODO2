import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { todoRepository } from '../../data/todo-repository'
import { makeTodo } from '../helpers'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('todoRepository', () => {
  it('inserts and retrieves a todo', async () => {
    const id = await todoRepository.insert(makeTodo({ title: 'Buy milk' }))
    const todo = await todoRepository.getById(id)
    expect(todo).toBeDefined()
    expect(todo!.title).toBe('Buy milk')
    expect(todo!.id).toBe(id)
  })

  it('getAll returns todos sorted by sortOrder', async () => {
    await todoRepository.insert(makeTodo({ title: 'B', sortOrder: 2 }))
    await todoRepository.insert(makeTodo({ title: 'A', sortOrder: 1 }))
    await todoRepository.insert(makeTodo({ title: 'C', sortOrder: 3 }))

    const all = await todoRepository.getAll()
    expect(all.map((t) => t.title)).toEqual(['A', 'B', 'C'])
  })

  it('getByCanvas filters by canvasId', async () => {
    await todoRepository.insert(makeTodo({ title: 'In canvas 1', canvasId: 1 }))
    await todoRepository.insert(makeTodo({ title: 'In canvas 2', canvasId: 2 }))

    const result = await todoRepository.getByCanvas(1)
    expect(result).toHaveLength(1)
    expect(result[0]!.title).toBe('In canvas 1')
  })

  it('getByProject filters by projectId', async () => {
    await todoRepository.insert(makeTodo({ title: 'In project 1', projectId: 1 }))
    await todoRepository.insert(makeTodo({ title: 'In project 2', projectId: 2 }))

    const result = await todoRepository.getByProject(1)
    expect(result).toHaveLength(1)
    expect(result[0]!.title).toBe('In project 1')
  })

  it('complete toggles isCompleted', async () => {
    const id = await todoRepository.insert(makeTodo())
    await todoRepository.complete(id, true)

    const todo = await todoRepository.getById(id)
    expect(todo!.isCompleted).toBe(true)
  })

  it('update modifies all fields', async () => {
    const id = await todoRepository.insert(makeTodo({ title: 'Original' }))
    const todo = await todoRepository.getById(id)
    todo!.title = 'Updated'
    todo!.notes = 'note body'
    await todoRepository.update(todo!)

    const updated = await todoRepository.getById(id)
    expect(updated!.title).toBe('Updated')
    expect(updated!.notes).toBe('note body')
  })

  it('delete removes a todo', async () => {
    const id = await todoRepository.insert(makeTodo())
    await todoRepository.delete(id)

    const todo = await todoRepository.getById(id)
    expect(todo).toBeUndefined()
  })

  it('delete cascades todoTags so no orphan join rows remain', async () => {
    // P1 of code-review-2026-04-25: pre-fix, deleting a todo left its
    // todoTags rows behind because db.todoTags wasn't in the rw transaction.
    const tagId = await db.tags.add({ name: 'urgent', color: '#ff0000' })
    const id = await todoRepository.insert(makeTodo())
    await db.todoTags.add({ todoId: id, tagId })
    expect(await db.todoTags.where('todoId').equals(id).count()).toBe(1)

    await todoRepository.delete(id)

    expect(await db.todoTags.where('todoId').equals(id).count()).toBe(0)
    // The tag itself is unaffected — only the join row goes.
    expect(await db.tags.count()).toBe(1)
  })

  it('bulkDelete cascades todoTags for every removed todo', async () => {
    const tagId = await db.tags.add({ name: 'urgent', color: '#ff0000' })
    const id1 = await todoRepository.insert(makeTodo({ title: 'a' }))
    const id2 = await todoRepository.insert(makeTodo({ title: 'b' }))
    await db.todoTags.bulkAdd([
      { todoId: id1, tagId },
      { todoId: id2, tagId },
    ])

    await todoRepository.bulkDelete([id1, id2])

    expect(await db.todoTags.count()).toBe(0)
    expect(await db.tags.count()).toBe(1)
  })

  it('reorder updates sortOrder', async () => {
    const id = await todoRepository.insert(makeTodo({ sortOrder: 1 }))
    await todoRepository.reorder(id, 5)

    const todo = await todoRepository.getById(id)
    expect(todo!.sortOrder).toBe(5)
  })
})

describe('todoRepository — orphan-rule cleanup on write', () => {
  // Repository invariant: a `recurrenceRule` is only meaningful when the
  // merged row carries a precise anchor (`dueDate` or `scheduledDate.kind ===
  // 'date'`). Writes that produce a rule + no anchor drop the rule before
  // persistence so the bulk paths converge on TaskEditPopup's silent-clear.
  const preciseDate = new Date(2026, 5, 1)
  const fuzzyValue = { kind: 'fuzzy' as const, token: 'this-week' as const, setAt: new Date(2026, 4, 9) }

  it('update flipping precise → fuzzy drops the rule', async () => {
    const id = await todoRepository.insert(makeTodo({
      title: 'Recurring',
      scheduledDate: { kind: 'date', value: preciseDate },
      recurrenceRule: { type: 'weekly' },
    }))
    const row = (await todoRepository.getById(id))!
    row.scheduledDate = fuzzyValue
    await todoRepository.update(row)

    const updated = await todoRepository.getById(id)
    expect(updated!.scheduledDate).toEqual(fuzzyValue)
    expect(updated!.recurrenceRule).toBeUndefined()
  })

  it('update clearing the only precise scheduledDate drops the rule', async () => {
    const id = await todoRepository.insert(makeTodo({
      scheduledDate: { kind: 'date', value: preciseDate },
      recurrenceRule: { type: 'weekly' },
    }))
    const row = (await todoRepository.getById(id))!
    row.scheduledDate = undefined
    await todoRepository.update(row)

    const updated = await todoRepository.getById(id)
    expect(updated!.scheduledDate).toBeUndefined()
    expect(updated!.recurrenceRule).toBeUndefined()
  })

  it('update preserves the rule when a deadline still anchors it', async () => {
    const id = await todoRepository.insert(makeTodo({
      scheduledDate: { kind: 'date', value: preciseDate },
      dueDate: new Date(2026, 5, 10),
      recurrenceRule: { type: 'weekly' },
    }))
    const row = (await todoRepository.getById(id))!
    row.scheduledDate = fuzzyValue
    await todoRepository.update(row)

    const updated = await todoRepository.getById(id)
    expect(updated!.scheduledDate).toEqual(fuzzyValue)
    expect(updated!.recurrenceRule).toEqual({ type: 'weekly' })
  })

  it('update clearing deadline on a deadline-only recurring task drops the rule', async () => {
    const id = await todoRepository.insert(makeTodo({
      dueDate: new Date(2026, 5, 10),
      recurrenceRule: { type: 'monthly', originalDayOfMonth: 10 },
    }))
    const row = (await todoRepository.getById(id))!
    row.dueDate = undefined
    await todoRepository.update(row)

    const updated = await todoRepository.getById(id)
    expect(updated!.dueDate).toBeUndefined()
    expect(updated!.recurrenceRule).toBeUndefined()
  })

  it('update clearing deadline preserves the rule when a precise scheduledDate remains', async () => {
    const id = await todoRepository.insert(makeTodo({
      scheduledDate: { kind: 'date', value: preciseDate },
      dueDate: new Date(2026, 5, 10),
      recurrenceRule: { type: 'weekly' },
    }))
    const row = (await todoRepository.getById(id))!
    row.dueDate = undefined
    await todoRepository.update(row)

    const updated = await todoRepository.getById(id)
    expect(updated!.dueDate).toBeUndefined()
    expect(updated!.scheduledDate).toEqual({ kind: 'date', value: preciseDate })
    expect(updated!.recurrenceRule).toEqual({ type: 'weekly' })
  })

  it('update of an unrelated field on a recurring task leaves the rule alone', async () => {
    const id = await todoRepository.insert(makeTodo({
      scheduledDate: { kind: 'date', value: preciseDate },
      recurrenceRule: { type: 'weekly' },
    }))
    const row = (await todoRepository.getById(id))!
    row.title = 'Renamed'
    await todoRepository.update(row)

    const updated = await todoRepository.getById(id)
    expect(updated!.title).toBe('Renamed')
    expect(updated!.recurrenceRule).toEqual({ type: 'weekly' })
  })

  it('bulkUpdate flipping precise → fuzzy across rows drops orphaned rules and preserves anchored ones', async () => {
    const orphanId = await todoRepository.insert(makeTodo({
      title: 'orphan',
      scheduledDate: { kind: 'date', value: preciseDate },
      recurrenceRule: { type: 'weekly' },
    }))
    const anchoredId = await todoRepository.insert(makeTodo({
      title: 'anchored',
      scheduledDate: { kind: 'date', value: preciseDate },
      dueDate: new Date(2026, 5, 10),
      recurrenceRule: { type: 'weekly' },
    }))
    const noRuleId = await todoRepository.insert(makeTodo({
      title: 'no rule',
      scheduledDate: { kind: 'date', value: preciseDate },
    }))

    await todoRepository.bulkUpdate([
      { todoId: orphanId, changes: { scheduledDate: fuzzyValue } },
      { todoId: anchoredId, changes: { scheduledDate: fuzzyValue } },
      { todoId: noRuleId, changes: { scheduledDate: fuzzyValue } },
    ])

    const orphan = await todoRepository.getById(orphanId)
    expect(orphan!.scheduledDate).toEqual(fuzzyValue)
    expect(orphan!.recurrenceRule).toBeUndefined()

    const anchored = await todoRepository.getById(anchoredId)
    expect(anchored!.scheduledDate).toEqual(fuzzyValue)
    expect(anchored!.recurrenceRule).toEqual({ type: 'weekly' })

    const noRule = await todoRepository.getById(noRuleId)
    expect(noRule!.scheduledDate).toEqual(fuzzyValue)
    expect(noRule!.recurrenceRule).toBeUndefined()
  })

  it('bulkUpdate clearing scheduledDate drops the rule on a schedule-only recurring row', async () => {
    const id = await todoRepository.insert(makeTodo({
      scheduledDate: { kind: 'date', value: preciseDate },
      recurrenceRule: { type: 'weekly' },
    }))
    await todoRepository.bulkUpdate([
      { todoId: id, changes: { scheduledDate: undefined } },
    ])

    const updated = await todoRepository.getById(id)
    expect(updated!.scheduledDate).toBeUndefined()
    expect(updated!.recurrenceRule).toBeUndefined()
  })

  it('bulkUpdate clearing deadline drops the rule when no precise scheduledDate remains', async () => {
    const id = await todoRepository.insert(makeTodo({
      dueDate: new Date(2026, 5, 10),
      scheduledDate: fuzzyValue,
      recurrenceRule: { type: 'monthly', originalDayOfMonth: 10 },
    }))
    await todoRepository.bulkUpdate([
      { todoId: id, changes: { dueDate: undefined } },
    ])

    const updated = await todoRepository.getById(id)
    expect(updated!.dueDate).toBeUndefined()
    expect(updated!.scheduledDate).toEqual(fuzzyValue)
    expect(updated!.recurrenceRule).toBeUndefined()
  })

  it('bulkUpdate of an unrelated field on a recurring task leaves the rule alone', async () => {
    const id = await todoRepository.insert(makeTodo({
      scheduledDate: { kind: 'date', value: preciseDate },
      recurrenceRule: { type: 'weekly' },
    }))
    await todoRepository.bulkUpdate([
      { todoId: id, changes: { title: 'Renamed' } },
    ])

    const updated = await todoRepository.getById(id)
    expect(updated!.title).toBe('Renamed')
    expect(updated!.recurrenceRule).toEqual({ type: 'weekly' })
  })
})
