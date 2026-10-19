import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { applyPaneDrop, currentPaneContext } from '../../services/eisenhower-drop'
import { usePersonStore } from '../../stores/person-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const mem = (id: number) => useTodoStore.getState().todos.find((t) => t.id === id)!
const peopleOf = (id: number) => (usePersonStore.getState().assignedPeopleMap.get(id) ?? []).map((p) => p.name)
const tagsOf = (id: number) => (useTagStore.getState().assignedTagsMap.get(id) ?? []).map((t) => t.name)

describe('applyPaneDrop', () => {
  it('writes the flags, status, person and tag as one undo step named for the drop', async () => {
    const ann = await db.people.add({ name: 'Ann', initials: 'AN' }) as number
    const home = await db.tags.add({ name: 'home', color: '#000' }) as number
    const waiting = await db.statuses.add({ name: 'Waiting', color: '#000', icon: 'circle', sortOrder: 1 }) as number
    await usePersonStore.getState().load()
    await useTagStore.getState().load()
    await useStatusStore.getState().load()
    const a = await useTodoStore.getState().add('Chase vendor')
    const b = await useTodoStore.getState().add('Book venue')
    useUndoStore.setState(useUndoStore.getInitialState(), true)

    await applyPaneDrop([
      { todoId: a, urgent: true, statusId: waiting, personId: ann, tagId: home },
      { todoId: b, urgent: true, statusId: waiting, personId: ann, tagId: home },
    ])
    expect(mem(a)).toMatchObject({ urgent: true, statusId: waiting })
    expect(peopleOf(b)).toEqual(['Ann'])
    expect(tagsOf(b)).toEqual(['home'])
    expect((await db.todos.get(a))!.statusId).toBe(waiting)
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
    expect(useUndoStore.getState().snackbar?.description).toBe('Marked urgent, status Waiting, assigned to Ann, tagged #home · 2 tasks')

    await useUndoStore.getState().undo()
    expect(mem(a).urgent).toBeUndefined()
    expect(mem(a).statusId).toBeUndefined()
    expect(peopleOf(a)).toEqual([])
    expect(tagsOf(a)).toEqual([])
    expect(await db.todoPeople.count()).toBe(0)
  })

  it('flags alone are the flag write itself', async () => {
    const a = await useTodoStore.getState().add('A')
    useUndoStore.setState(useUndoStore.getInitialState(), true)
    await applyPaneDrop([{ todoId: a, important: true }])
    expect(mem(a).important).toBe(true)
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Marked important · A'])
  })
})

describe('currentPaneContext', () => {
  it('reads the stores as they are now', () => {
    useSettingsStore.setState({ urgentDueWithinDays: 5 })
    const today = new Date(2026, 9, 10)
    const ctx = currentPaneContext(today)
    expect(ctx.today).toBe(today)
    expect(ctx.settings.urgentRange).toBe(5)
    expect(ctx.assignedPeopleMap).toBe(usePersonStore.getState().assignedPeopleMap)
  })
})
