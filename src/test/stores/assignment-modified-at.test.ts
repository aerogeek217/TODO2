import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { backupScheduler } from '../../data/backup-scheduler'
import { db } from '../../data/database'
import { removePeopleAndTags } from '../../services/remove-entities'
import { usePersonStore } from '../../stores/person-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'
import { resetStores } from '../store-tracking'
import { addTask } from '../add-task'

/**
 * cr32: assigning or unassigning a person or a tag is activity on the task —
 * it stamps its `modifiedAt` (stored and in the store, so the stale fade and
 * the Modified filter / sort follow) — and its undo / redo put the earlier /
 * the written stamp back as every task write's do. Removing the entity
 * itself (a delete, Settings' unused people & tags) is housekeeping, not
 * activity on its tasks: their stamps stay.
 */

const T0 = new Date(2026, 9, 1, 9, 0)
const NOW = new Date(2026, 10, 10, 12, 0)

let ann = 0
let urgent = 0

beforeEach(async () => {
  await resetDb()
  resetStores()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  useSettingsStore.setState({ autoFollowup: false })
  ann = await usePersonStore.getState().add('Ann', 'AN')
  urgent = await useTagStore.getState().add('urgent')
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function setStamp(id: number, at: Date): Promise<void> {
  await db.todos.update(id, { modifiedAt: at })
  useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === id ? { ...t, modifiedAt: at } : t)) })
}

/** Tasks last modified at `T0` (stale), their assignments loaded, with an empty undo stack. */
async function staleTasks(...titles: string[]): Promise<number[]> {
  const ids: number[] = []
  for (const title of titles) ids.push(await addTask(title))
  for (const id of ids) await setStamp(id, T0)
  await usePersonStore.getState().loadAssignments(ids)
  await useTagStore.getState().loadAssignments(ids)
  useUndoStore.getState().clear()
  return ids
}

/** The task's `modifiedAt` — stored and shown, which must agree. */
async function stamp(id: number): Promise<Date | undefined> {
  const stored = (await db.todos.get(id))?.modifiedAt
  const shown = useTodoStore.getState().todos.find((t) => t.id === id)?.modifiedAt
  expect(shown?.getTime()).toBe(stored?.getTime())
  return stored
}

function later(minutes: number): Date {
  const at = new Date(NOW.getTime() + minutes * 60_000)
  vi.setSystemTime(at)
  return at
}

/** `step` stamps `ids` now; undo puts back T0; redo the step's stamp. */
async function expectRoundTrip(ids: readonly number[], step: () => Promise<unknown>): Promise<void> {
  const wrote = later(1)
  await step()
  for (const id of ids) expect(await stamp(id)).toEqual(wrote)
  later(2)
  await useUndoStore.getState().undo()
  for (const id of ids) expect(await stamp(id)).toEqual(T0)
  later(3)
  await useUndoStore.getState().redo()
  for (const id of ids) expect(await stamp(id)).toEqual(wrote)
}

describe('an assignment stamps the task’s Modified date', () => {
  it('a person assigned and unassigned (the row’s picker, the editor)', async () => {
    const [id] = await staleTasks('Quote') as [number]
    await expectRoundTrip([id], () => usePersonStore.getState().assignPerson(id, ann))
    expect(await db.todoPeople.where({ todoId: id, personId: ann }).count()).toBe(1)
    await setStamp(id, T0)
    useUndoStore.getState().clear()
    await expectRoundTrip([id], () => usePersonStore.getState().unassignPerson(id, ann))
    expect(await db.todoPeople.where({ todoId: id, personId: ann }).count()).toBe(0)
  })

  it('a tag assigned and unassigned', async () => {
    const [id] = await staleTasks('Quote') as [number]
    await expectRoundTrip([id], () => useTagStore.getState().assignTag(id, urgent))
    await setStamp(id, T0)
    useUndoStore.getState().clear()
    await expectRoundTrip([id], () => useTagStore.getState().unassignTag(id, urgent))
  })

  it('in bulk (the bulk bar): only the tasks whose people change are stamped', async () => {
    const [a, b, c] = await staleTasks('A', 'B', 'C') as [number, number, number]
    await usePersonStore.getState().assignPerson(c, ann)
    await setStamp(c, T0)
    useUndoStore.getState().clear()
    await expectRoundTrip([a, b], () => usePersonStore.getState().bulkAssignPerson([a, b, c], ann))
    // C already had Ann: nothing written, no stamp.
    expect(await stamp(c)).toEqual(T0)

    for (const id of [a, b, c]) await setStamp(id, T0)
    useUndoStore.getState().clear()
    await expectRoundTrip([a, b, c], () => usePersonStore.getState().bulkUnassignPerson([a, b, c], ann))
  })

  it('a tag in bulk', async () => {
    const ids = await staleTasks('A', 'B')
    await expectRoundTrip(ids, () => useTagStore.getState().bulkAssignTag(ids, urgent))
  })

  it('an assignment already there (or already gone) writes nothing and stamps nothing', async () => {
    const [id] = await staleTasks('Quote') as [number]
    await usePersonStore.getState().unassignPerson(id, ann)
    expect(await stamp(id)).toEqual(T0)
  })

  it('a task touched since keeps its newer stamp through undo and redo', async () => {
    const [id] = await staleTasks('Quote') as [number]
    later(1)
    await usePersonStore.getState().assignPerson(id, ann)
    const touched = later(2)
    await setStamp(id, touched)
    await useUndoStore.getState().undo()
    expect(await db.todoPeople.where({ todoId: id, personId: ann }).count()).toBe(0)
    expect(await stamp(id)).toEqual(touched)
    await useUndoStore.getState().redo()
    expect(await stamp(id)).toEqual(touched)
  })
})

describe('a create with people and tags (Quick Add, NLP) stamps once, as the create', () => {
  it('the new task’s Modified date is its creation time', async () => {
    const [id] = await useTodoStore.getState().addMany([{
      todo: { title: 'Call @Ann', isCompleted: false, createdAt: NOW, modifiedAt: NOW },
      personIds: [ann],
      tagIds: [urgent],
    }], { description: 'Add' })
    expect(await stamp(id!)).toEqual(NOW)
    expect(await db.todoPeople.where({ todoId: id!, personId: ann }).count()).toBe(1)
  })
})

describe('removing the person or tag itself is not activity on its tasks', () => {
  it('a person deleted (and the delete undone) leaves the tasks’ stamps', async () => {
    const [id] = await staleTasks('Quote') as [number]
    await usePersonStore.getState().assignPerson(id, ann)
    await setStamp(id, T0)
    later(1)
    await usePersonStore.getState().remove(ann)
    expect(await stamp(id)).toEqual(T0)
    later(2)
    await useUndoStore.getState().undo()
    expect(await db.todoPeople.where({ todoId: id, personId: ann }).count()).toBe(1)
    expect(await stamp(id)).toEqual(T0)
  })

  it('Settings’ unused people & tags removal (and its undo) leaves the tasks’ stamps', async () => {
    vi.spyOn(backupScheduler, 'snapshotBeforeDestructive').mockResolvedValue(undefined as never)
    const [id] = await staleTasks('Done') as [number]
    await usePersonStore.getState().assignPerson(id, ann)
    await useTagStore.getState().assignTag(id, urgent)
    await setStamp(id, T0)
    later(1)
    expect(await removePeopleAndTags([ann], [urgent])).toBe(true)
    expect(await db.todoPeople.where('personId').equals(ann).count()).toBe(0)
    expect(await stamp(id)).toEqual(T0)
    later(2)
    await useUndoStore.getState().undo()
    expect(await db.todoTags.where({ todoId: id, tagId: urgent }).count()).toBe(1)
    expect(await stamp(id)).toEqual(T0)
  })
})
