import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../data/database'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { useSettingsStore } from '../../stores/settings-store'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { createTasksFromDrafts } from '../../services/note-tasks'
import type { TaskDraft } from '../../services/task-draft'

const base: TaskDraft = {
  title: 'T', urgent: false, important: false, focus: false,
  personIds: [], newPeople: [], tagIds: [], newTags: [],
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTodoStore.setState(useTodoStore.getInitialState(), true)
  useUndoStore.getState().clear()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  usePersonStore.setState(usePersonStore.getInitialState(), true)
  useTagStore.setState(useTagStore.getInitialState(), true)
})

async function joins(todoId: number) {
  return {
    people: (await db.todoPeople.where('todoId').equals(todoId).toArray()).map((r) => r.personId),
    tags: (await db.todoTags.where('todoId').equals(todoId).toArray()).map((r) => r.tagId),
  }
}

describe('createTasksFromDrafts', () => {
  it('creates the tasks in draft order, last in the list, with the default follow-up', async () => {
    await useTodoStore.getState().add('Existing')
    const created = await createTasksFromDrafts(
      [{ ...base, title: 'One' }, { ...base, title: 'Two', nextFollowupAt: null }],
      { description: 'Created 2 tasks' },
    )
    expect(created.map((c) => c.title)).toEqual(['One', 'Two'])
    const todos = useTodoStore.getState().todos
    const one = todos.find((t) => t.title === 'One')!
    const two = todos.find((t) => t.title === 'Two')!
    const existing = todos.find((t) => t.title === 'Existing')!
    expect(one.sortOrder).toBeGreaterThan(existing.sortOrder)
    expect(two.sortOrder).toBe(one.sortOrder + 1)
    expect(one.nextFollowupAt).toBeInstanceOf(Date)
    expect(two.nextFollowupAt).toBeUndefined()
    expect(typeof one.uid).toBe('string')
    // Each task has its `created` event.
    expect(await db.todoEvents.where('todoId').equals(one.id).count()).toBe(1)
  })

  it('creates new people and tags by name and assigns them', async () => {
    const ben = await usePersonStore.getState().add('Ben Ortiz', 'BO')
    const [task] = await createTasksFromDrafts(
      [{ ...base, title: 'Call', personIds: [ben], newPeople: ['Marco', 'marco'], newTags: ['launch'] }],
      { description: 'x' },
    )
    const marco = usePersonStore.getState().people.find((p) => p.name === 'Marco')
    const launch = useTagStore.getState().tags.find((t) => t.name === 'launch')
    expect(marco).toBeDefined()
    expect(launch).toBeDefined()
    expect(usePersonStore.getState().people.filter((p) => p.name.toLowerCase() === 'marco')).toHaveLength(1)
    const j = await joins(task!.id)
    expect(j.people.sort()).toEqual([ben, marco!.id].sort())
    expect(j.tags).toEqual([launch!.id])
    // The assignment caches show them right away.
    expect(usePersonStore.getState().assignedPeopleMap.get(task!.id)?.map((p) => p.name).sort()).toEqual(['Ben Ortiz', 'Marco'])
    expect(useTagStore.getState().assignedTagsMap.get(task!.id)?.map((t) => t.name)).toEqual(['launch'])
  })

  it('is one undo step; undo deletes every task with its joins, redo puts them back', async () => {
    const tag = await useTagStore.getState().add('q4')
    const created = await createTasksFromDrafts(
      [{ ...base, title: 'A', tagIds: [tag], urgent: true }, { ...base, title: 'B' }, { ...base, title: 'C' }],
      { description: 'Created 3 tasks', snackbar: true },
    )
    const ids = created.map((c) => c.id)
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
    expect(useUndoStore.getState().snackbar?.description).toBe('Created 3 tasks')

    await useUndoStore.getState().undo()
    expect(useTodoStore.getState().todos).toHaveLength(0)
    expect(await db.todos.count()).toBe(0)
    expect(await db.todoTags.count()).toBe(0)

    await useUndoStore.getState().redo()
    const todos = useTodoStore.getState().todos
    expect(todos.map((t) => t.id).sort()).toEqual([...ids].sort())
    expect(todos.find((t) => t.title === 'A')?.urgent).toBe(true)
    expect((await joins(ids[0]!)).tags).toEqual([tag])
    // The tag created before the convert is not touched by undo.
    expect(useTagStore.getState().tags.some((t) => t.id === tag)).toBe(true)
  })

  it('without the snackbar option the undo step is silent', async () => {
    await createTasksFromDrafts([{ ...base, title: 'Solo' }], { description: 'Add "Solo"' })
    expect(useUndoStore.getState().snackbar).toBeNull()
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('Add "Solo"')
  })

  it('creates nothing for no drafts', async () => {
    expect(await createTasksFromDrafts([], { description: 'x' })).toEqual([])
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })
})
