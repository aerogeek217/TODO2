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
    // Regression: deleting a todo once left its todoTags rows behind because
    // db.todoTags wasn't in the rw transaction.
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
  // merged row has a due date to advance. Writes that produce a rule + no due
  // date drop the rule before persistence so the bulk paths converge on
  // TaskEditPopup's silent-clear.
  const due = new Date(2026, 5, 10)
  const followup = new Date(2026, 5, 1)

  it('update clearing the due date drops the rule (a follow-up is not an anchor)', async () => {
    const id = await todoRepository.insert(makeTodo({
      dueDate: due,
      nextFollowupAt: followup,
      recurrenceRule: { type: 'monthly', originalDayOfMonth: 10 },
    }))
    const row = (await todoRepository.getById(id))!
    row.dueDate = undefined
    await todoRepository.update(row)

    const updated = await todoRepository.getById(id)
    expect(updated!.dueDate).toBeUndefined()
    expect(updated!.nextFollowupAt).toEqual(followup)
    expect(updated!.recurrenceRule).toBeUndefined()
  })

  it('update preserves the rule when the due date still anchors it', async () => {
    const id = await todoRepository.insert(makeTodo({
      dueDate: due,
      recurrenceRule: { type: 'weekly' },
    }))
    const row = (await todoRepository.getById(id))!
    row.nextFollowupAt = followup
    await todoRepository.update(row)

    const updated = await todoRepository.getById(id)
    expect(updated!.nextFollowupAt).toEqual(followup)
    expect(updated!.recurrenceRule).toEqual({ type: 'weekly' })
  })

  it('update of an unrelated field on a recurring task leaves the rule alone', async () => {
    const id = await todoRepository.insert(makeTodo({
      dueDate: due,
      recurrenceRule: { type: 'weekly' },
    }))
    const row = (await todoRepository.getById(id))!
    row.title = 'Renamed'
    await todoRepository.update(row)

    const updated = await todoRepository.getById(id)
    expect(updated!.title).toBe('Renamed')
    expect(updated!.recurrenceRule).toEqual({ type: 'weekly' })
  })

  it('bulkUpdate clearing due dates drops orphaned rules and leaves rows without one alone', async () => {
    const orphanId = await todoRepository.insert(makeTodo({
      title: 'orphan',
      dueDate: due,
      recurrenceRule: { type: 'weekly' },
    }))
    const anchoredId = await todoRepository.insert(makeTodo({
      title: 'anchored',
      dueDate: due,
      recurrenceRule: { type: 'weekly' },
    }))
    const noRuleId = await todoRepository.insert(makeTodo({ title: 'no rule', dueDate: due }))

    await todoRepository.bulkUpdate([
      { todoId: orphanId, changes: { dueDate: undefined } },
      { todoId: anchoredId, changes: { nextFollowupAt: followup } },
      { todoId: noRuleId, changes: { dueDate: undefined } },
    ])

    const orphan = await todoRepository.getById(orphanId)
    expect(orphan!.dueDate).toBeUndefined()
    expect(orphan!.recurrenceRule).toBeUndefined()

    const anchored = await todoRepository.getById(anchoredId)
    expect(anchored!.recurrenceRule).toEqual({ type: 'weekly' })

    const noRule = await todoRepository.getById(noRuleId)
    expect(noRule!.dueDate).toBeUndefined()
    expect(noRule!.recurrenceRule).toBeUndefined()
  })

  it('bulkUpdate of an unrelated field on a recurring task leaves the rule alone', async () => {
    const id = await todoRepository.insert(makeTodo({
      dueDate: due,
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
