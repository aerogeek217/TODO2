import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { todoRepository } from '../../data/todo-repository'
import { applyCheckinUpdates } from '../../services/checkin-reply/apply'
import { applyPaneDrop, currentPaneContext, currentPanes } from '../../services/eisenhower-drop'
import { useWorkspaceStore } from '../../stores/workspace-store'
import type { LayoutTab, PersistedWorkspaceLayout } from '../../models/workspace-layout'
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

describe('applyPaneDrop — a write that fails', () => {
  afterEach(() => { vi.restoreAllMocks() })

  async function seed() {
    const home = await db.tags.add({ name: 'home', color: '#000' }) as number
    const waiting = await db.statuses.add({ name: 'Waiting', color: '#000', icon: 'circle', sortOrder: 1 }) as number
    await useTagStore.getState().load()
    await useStatusStore.getState().load()
    const a = await useTodoStore.getState().add('Chase vendor')
    const b = await useTodoStore.getState().add('Book venue')
    useUndoStore.setState(useUndoStore.getInitialState(), true)
    return { home, waiting, a, b }
  }

  it('part-way: what was written is taken back, no undo entry, a notice says so — and it never rejects', async () => {
    const { home, waiting, a, b } = await seed()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // The tag is the last write: the flags and the status went in before it.
    vi.spyOn(db.todoTags, 'bulkAdd').mockRejectedValue(new Error('disk full'))

    await expect(applyPaneDrop([
      { todoId: a, urgent: true, statusId: waiting, tagId: home },
      { todoId: b, urgent: true, statusId: waiting, tagId: home },
    ])).resolves.toBeUndefined()

    expect(mem(a).urgent).toBeUndefined()
    expect(mem(a).statusId).toBeUndefined()
    expect(tagsOf(a)).toEqual([])
    const row = await db.todos.get(a)
    expect(row?.urgent).toBeUndefined()
    expect(row?.statusId).toBeUndefined()
    const undo = useUndoStore.getState()
    expect(undo.undoStack).toEqual([])
    expect(undo.groupToken).toBeNull()
    expect(undo.snackbar).toEqual({
      description: 'Couldn’t save: Marked urgent, status Waiting, tagged #home · 2 tasks. Nothing changed.',
      notice: true,
    })
  })

  it('flags alone: the failed write is rolled back by the store; a notice, no rejection', async () => {
    const { a } = await seed()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(todoRepository, 'bulkUpdate').mockRejectedValue(new Error('disk full'))
    await expect(applyPaneDrop([{ todoId: a, important: true }])).resolves.toBeUndefined()
    expect(mem(a).important).toBeUndefined()
    expect(useUndoStore.getState().undoStack).toEqual([])
    expect(useUndoStore.getState().snackbar?.description).toBe('Couldn’t save: Marked important · Chase vendor. Nothing changed.')
  })

  it('a drop that fails while a check-in reply is being applied takes back only its own writes', async () => {
    const { home, waiting, a, b } = await seed()
    const c = await useTodoStore.getState().add('Reply task')
    useUndoStore.setState(useUndoStore.getInitialState(), true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(db.todoTags, 'bulkAdd').mockRejectedValue(new Error('disk full'))

    const reply = applyCheckinUpdates([{ todoId: c, complete: false, progress: 'Half done', changeCount: 1 }], { recordFollowup: false, personName: 'Ann' })
    const drop = applyPaneDrop([
      { todoId: a, urgent: true, statusId: waiting, tagId: home },
      { todoId: b, urgent: true, statusId: waiting, tagId: home },
    ])
    await Promise.all([reply, drop])

    // The reply's write stays, as its own undo step; the drop left nothing.
    expect(mem(c).progress).toBe('Half done')
    expect((await db.todos.get(c))!.progress).toBe('Half done')
    expect(mem(a).urgent).toBeUndefined()
    expect(mem(a).statusId).toBeUndefined()
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Applied 1 change from Ann'])
    expect(useUndoStore.getState().groupToken).toBeNull()
  })

  it('two drops at once are written one after the other, each its own undo step', async () => {
    const { waiting, a, b } = await seed()
    const first = applyPaneDrop([{ todoId: a, urgent: true, statusId: waiting }])
    const second = applyPaneDrop([{ todoId: b, important: true, statusId: waiting }])
    await Promise.all([first, second])
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual([
      'Marked urgent, status Waiting · Chase vendor',
      'Marked important, status Waiting · Book venue',
    ])
    await useUndoStore.getState().undo()
    expect(mem(b).statusId).toBeUndefined()
    expect(mem(a).statusId).toBe(waiting)
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

describe('currentPanes', () => {
  const layout = (tabs: LayoutTab[]): PersistedWorkspaceLayout => {
    const at = new Date(2026, 0, 1)
    return { id: 1, sortOrder: 0, name: 'Main', createdAt: at, modifiedAt: at, columns: [{ id: 'c', weight: 1, cells: [{ id: 'k', weight: 1, tabs }] }] }
  }

  it('a drop on an Eisenhower tab of the open layout is resolved with the app-wide panes as they are now', () => {
    const l = layout([{ id: 'eis', kind: 'eisenhower', config: {} }, { id: 'n', kind: 'notes', config: {} }])
    useWorkspaceStore.setState({ working: l, saved: l })
    useSettingsStore.setState({ eisenhowerPanes: { delegate: { name: 'Hand off' } } })
    expect(currentPanes('eis')?.map((p) => p.name)).toEqual(['Do', 'Schedule', 'Hand off', 'Drop'])
    useSettingsStore.setState({ eisenhowerPanes: {} })
    expect(currentPanes('eis')?.map((p) => p.name)).toEqual(['Do', 'Schedule', 'Delegate', 'Drop'])
    // Not an Eisenhower tab, or no such tab: nothing to drop on.
    expect(currentPanes('n')).toBeNull()
    expect(currentPanes('gone')).toBeNull()
  })
})
