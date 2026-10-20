import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { db } from '../../data/database'
import { todoRepository } from '../../data/todo-repository'
import { useTodoStore } from '../../stores/todo-store'
import { useUndoStore } from '../../stores/undo-store'
import { useSettingsStore } from '../../stores/settings-store'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useStatusStore } from '../../stores/status-store'
import { useTaskEditCallbacks } from '../../hooks/use-task-edit-callbacks'
import { createQuickAddTask } from '../../services/create-task'
import { createTasksFromDrafts } from '../../services/note-tasks'
import { draftFromText } from '../../services/task-draft'
import { parseTaskInput } from '../../services/nlp-task-creator'
import { makeRecurrenceRule } from '../../utils/recurrence'
import { addFollowupInterval, DEFAULT_FOLLOWUP_INTERVAL } from '../../utils/followup'
import { addDays, startOfToday } from '../../utils/date'
import type { FilterDefaults } from '../../utils/filter-defaults'
import type { PersistedTodoItem, TodoItem } from '../../models'
import { resetStores } from '../store-tracking'

// The three ways a task is created — Quick Add, a note's drafts, and the
// task editor's create mode — side by side: the same text gives the same
// task, and where they differ on purpose the test says so.

const NO_DEFAULTS: FilterDefaults = { personIds: [], tagIds: [], statusId: undefined }

let ids: { ann: number; bob: number; waiting: number; doing: number; work: number }

beforeEach(async () => {
  await db.delete()
  await db.open()
  resetStores()
  useUndoStore.getState().clear()
  ids = {
    ann: await usePersonStore.getState().add('Ann', 'A'),
    bob: await usePersonStore.getState().add('Bob', 'B'),
    waiting: await useStatusStore.getState().add('Waiting'),
    doing: await useStatusStore.getState().add('Doing'),
    work: await useTagStore.getState().add('work'),
  }
  useUndoStore.getState().clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

interface Created {
  todo: PersistedTodoItem
  people: string[]
  tags: string[]
}

async function created(id: number | null): Promise<Created> {
  if (id == null) throw new Error('no task was created')
  const todo = useTodoStore.getState().todos.find((t) => t.id === id)
  if (!todo) throw new Error(`task ${id} not in the store`)
  const stored = await db.todos.get(id)
  expect(stored?.statusId).toBe(todo.statusId)
  const people = await Promise.all((await db.todoPeople.where('todoId').equals(id).toArray()).map((r) => db.people.get(r.personId)))
  const tags = await Promise.all((await db.todoTags.where('todoId').equals(id).toArray()).map((r) => db.tags.get(r.tagId)))
  return { todo, people: people.map((p) => p!.name).sort(), tags: tags.map((t) => t!.name).sort() }
}

async function viaQuickAdd(text: string, fd: FilterDefaults = NO_DEFAULTS): Promise<Created> {
  const { resolved } = parseTaskInput(text, usePersonStore.getState().people, useStatusStore.getState().statuses)
  return created(await createQuickAddTask({ title: resolved.title, resolved }, fd))
}

async function viaDrafts(text: string, fd: FilterDefaults = NO_DEFAULTS): Promise<Created> {
  const draft = draftFromText(text, {
    people: usePersonStore.getState().people,
    statuses: useStatusStore.getState().statuses,
    tags: useTagStore.getState().tags,
    defaults: fd,
    defaultStatusId: useSettingsStore.getState().defaultStatusId,
  })
  const [task] = await createTasksFromDrafts([draft], { description: 'Create tasks' })
  return created(task!.id)
}

async function viaEditor(
  partial: Partial<TodoItem>,
  assignments?: { personIds: number[]; tagIds: number[] },
): Promise<Created> {
  const { result } = renderHook(() => useTaskEditCallbacks())
  let id: number | null = null
  await act(async () => { id = await result.current.onCreate(partial, assignments) })
  return created(id)
}

const defaultFollowup = () => addFollowupInterval(new Date(), DEFAULT_FOLLOWUP_INTERVAL)
const day = (m: number, d: number) => {
  const y = new Date().getFullYear()
  return new Date(y, m - 1, d)
}

describe('create a task — plain text', () => {
  it('every pipeline: the title, no status, the default next follow-up, no markers, no repeat', async () => {
    for (const make of [() => viaQuickAdd('Plain'), () => viaDrafts('Plain'), () => viaEditor({ title: 'Plain' })]) {
      const { todo, people, tags } = await make()
      expect(todo).toMatchObject({ title: 'Plain', isCompleted: false })
      expect(todo.statusId).toBeUndefined()
      expect(todo.nextFollowupAt).toEqual(defaultFollowup())
      expect([todo.urgent, todo.important, todo.focus, todo.recurrenceRule, todo.dueDate]).toEqual([undefined, undefined, undefined, undefined, undefined])
      expect([people, tags]).toEqual([[], []])
    }
  })
})

describe('create a task — status', () => {
  it('Settings default status, nothing else: every pipeline uses it', async () => {
    useSettingsStore.setState({ defaultStatusId: ids.waiting })
    expect((await viaQuickAdd('A')).todo.statusId).toBe(ids.waiting)
    expect((await viaDrafts('B')).todo.statusId).toBe(ids.waiting)
    // The editor's status field starts at the Settings default.
    expect((await viaEditor({ title: 'C', statusId: ids.waiting })).todo.statusId).toBe(ids.waiting)
  })

  it('a typed /status wins over the Settings default, a filter status and the editor field', async () => {
    useSettingsStore.setState({ defaultStatusId: ids.waiting })
    const fd = { ...NO_DEFAULTS, statusId: ids.waiting }
    expect((await viaQuickAdd('A /status Doing', fd)).todo.statusId).toBe(ids.doing)
    expect((await viaDrafts('B /status Doing', fd)).todo.statusId).toBe(ids.doing)
    expect((await viaEditor({ title: 'C /status Doing', statusId: ids.waiting })).todo.statusId).toBe(ids.doing)
  })

  it('a filter status and a Settings default: Quick Add takes the filter’s, a note’s drafts the Settings default', async () => {
    useSettingsStore.setState({ defaultStatusId: ids.waiting })
    const fd = { ...NO_DEFAULTS, statusId: ids.doing }
    expect((await viaQuickAdd('A', fd)).todo.statusId).toBe(ids.doing)
    expect((await viaDrafts('B', fd)).todo.statusId).toBe(ids.waiting)
  })

  it('a filter status without a Settings default: Quick Add and drafts take it', async () => {
    const fd = { ...NO_DEFAULTS, statusId: ids.doing }
    expect((await viaQuickAdd('A', fd)).todo.statusId).toBe(ids.doing)
    expect((await viaDrafts('B', fd)).todo.statusId).toBe(ids.doing)
  })

  it('the editor with its status cleared still gets the Settings default', async () => {
    useSettingsStore.setState({ defaultStatusId: ids.waiting })
    expect((await viaEditor({ title: 'C', statusId: undefined })).todo.statusId).toBe(ids.waiting)
  })
})

describe('create a task — next follow-up', () => {
  it('/followup <interval> replaces the default; /followup none leaves none', async () => {
    const twoWeeks = addFollowupInterval(new Date(), { count: 2, unit: 'w' })
    expect((await viaQuickAdd('A /followup 2w')).todo.nextFollowupAt).toEqual(twoWeeks)
    expect((await viaDrafts('B /followup 2w')).todo.nextFollowupAt).toEqual(twoWeeks)
    expect((await viaEditor({ title: 'C /followup 2w' })).todo.nextFollowupAt).toEqual(twoWeeks)
    expect((await viaQuickAdd('D /followup none')).todo.nextFollowupAt).toBeUndefined()
    expect((await viaDrafts('E /followup none')).todo.nextFollowupAt).toBeUndefined()
    expect((await viaEditor({ title: 'F /followup none' })).todo.nextFollowupAt).toBeUndefined()
  })

  it('the editor’s own Next field wins over a typed /followup; cleared means none', async () => {
    expect((await viaEditor({ title: 'A /followup 2w', nextFollowupAt: day(12, 1) })).todo.nextFollowupAt).toEqual(day(12, 1))
    expect((await viaEditor({ title: 'B /followup 2w', nextFollowupAt: undefined })).todo.nextFollowupAt).toBeUndefined()
  })

  it('the editor keeps a Last follow-up', async () => {
    expect((await viaEditor({ title: 'A', lastFollowupAt: day(1, 2) })).todo.lastFollowupAt).toEqual(day(1, 2))
  })

  it('new tasks get no follow-up while the setting is off; a typed /followup still sets one', async () => {
    useSettingsStore.setState({ newTaskFollowup: false })
    for (const make of [() => viaQuickAdd('Plain'), () => viaDrafts('Plain'), () => viaEditor({ title: 'Plain' })]) {
      const { todo } = await make()
      expect(todo.nextFollowupAt).toBeUndefined()
    }
    const twoWeeks = addFollowupInterval(new Date(), { count: 2, unit: 'w' })
    expect((await viaQuickAdd('A /followup 2w')).todo.nextFollowupAt).toEqual(twoWeeks)
    expect((await viaDrafts('B /followup 2w')).todo.nextFollowupAt).toEqual(twoWeeks)
    expect((await viaEditor({ title: 'C /followup 2w' })).todo.nextFollowupAt).toEqual(twoWeeks)
    expect((await viaQuickAdd('D /followup none')).todo.nextFollowupAt).toBeUndefined()
    // The store's own add (no draft) follows the setting too.
    const id = await useTodoStore.getState().add('E')
    expect((await todoRepository.getById(id))!.nextFollowupAt).toBeUndefined()
  })
})

describe('create a task — due date and repeat', () => {
  it('/repeat without a due date is dropped; with /due it repeats from the due date', async () => {
    for (const make of [viaQuickAdd, viaDrafts, (t: string) => viaEditor({ title: t })]) {
      expect((await make('A /repeat monthly')).todo.recurrenceRule).toBeUndefined()
      const { todo } = await make('B /due tomorrow /repeat monthly')
      const tomorrow = addDays(startOfToday(), 1)
      expect(todo.dueDate).toEqual(tomorrow)
      expect(todo.recurrenceRule).toEqual(makeRecurrenceRule('monthly', tomorrow))
    }
  })

  it('the editor: its due date and repeat; a typed /repeat repeats from the editor’s due date', async () => {
    const rule = makeRecurrenceRule('weekly', day(11, 3))
    expect((await viaEditor({ title: 'A', dueDate: day(11, 3), recurrenceRule: rule })).todo).toMatchObject({ dueDate: day(11, 3), recurrenceRule: rule })
    expect((await viaEditor({ title: 'B /repeat monthly', dueDate: day(11, 3) })).todo.recurrenceRule)
      .toEqual(makeRecurrenceRule('monthly', day(11, 3)))
    // The editor's due date wins over a typed one.
    expect((await viaEditor({ title: 'C /due tomorrow', dueDate: day(11, 3) })).todo.dueDate).toEqual(day(11, 3))
  })
})

describe('create a task — markers, people, tags', () => {
  it('typed markers and a filter’s markers both apply', async () => {
    const fd: FilterDefaults = { ...NO_DEFAULTS, markers: { focus: true } }
    for (const make of [viaQuickAdd, viaDrafts]) {
      const { todo } = await make('A /urgent', fd)
      expect([todo.urgent, todo.important, todo.focus]).toEqual([true, undefined, true])
    }
    const { todo } = await viaEditor({ title: 'B /important', urgent: true })
    expect([todo.urgent, todo.important, todo.focus]).toEqual([true, true, undefined])
  })

  it('a filter’s people apply only when the text names nobody; a new @name is created', async () => {
    const fd = { ...NO_DEFAULTS, personIds: [ids.ann] }
    for (const make of [viaQuickAdd, viaDrafts]) {
      expect((await make('A', fd)).people).toEqual(['Ann'])
      expect((await make('B @Bob', fd)).people).toEqual(['Bob'])
    }
    expect((await viaQuickAdd('C @Zed', fd)).people).toEqual(['Zed'])
    expect((await viaDrafts('D @Zed', fd)).people).toEqual(['Zed'])
    expect((await db.people.where('name').equals('Zed').count())).toBe(1)
  })

  it('the editor: picked people and tags plus typed ones (new ones created)', async () => {
    const { people, tags } = await viaEditor({ title: 'A @Bob @Yan #home' }, { personIds: [ids.ann], tagIds: [ids.work] })
    expect(people).toEqual(['Ann', 'Bob', 'Yan'])
    expect(tags).toEqual(['home', 'work'])
  })

  it('a filter’s tags and typed tags (a new one created) both apply', async () => {
    const fd = { ...NO_DEFAULTS, tagIds: [ids.work] }
    expect((await viaQuickAdd('A #home', fd)).tags).toEqual(['home', 'work'])
    expect((await viaDrafts('B #home #Work', fd)).tags).toEqual(['home', 'work'])
    expect(await db.tags.where('name').equals('home').count()).toBe(1)
  })

  it('the editor keeps its notes', async () => {
    expect((await viaEditor({ title: 'A', notes: 'Bring the slides' })).todo.notes).toBe('Bring the slides')
  })
})

describe('create a task — undo', () => {
  it('drafts: one undo step removes the task', async () => {
    const { todo } = await viaDrafts('A @Bob #home /urgent')
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
    await useUndoStore.getState().undo()
    expect(await db.todos.get(todo.id)).toBeUndefined()
  })

  /** Everything a created task is: its row (minus the edit stamp), joins and events. */
  async function whole(id: number) {
    const row = await db.todos.get(id)
    const { modifiedAt: _stamp, ...rest } = row ?? ({} as Record<string, unknown>)
    void _stamp
    return {
      row: row ? rest : null,
      people: (await db.todoPeople.where('todoId').equals(id).toArray()).map((j) => j.personId).sort(),
      tags: (await db.todoTags.where('todoId').equals(id).toArray()).map((j) => j.tagId).sort(),
      events: (await db.todoEvents.where('todoId').equals(id).toArray()).map((e) => [e.id, e.type]),
    }
  }

  for (const [name, make] of [
    ['Quick Add', () => viaQuickAdd('Plan offsite @Bob @Zed #home #fresh /urgent /focus /due tomorrow /repeat monthly /followup 2w', { ...NO_DEFAULTS, tagIds: [ids.work] })],
    ['the editor', () => viaEditor(
      { title: 'Plan offsite @Zed #fresh /important', dueDate: day(11, 3), recurrenceRule: makeRecurrenceRule('monthly', day(11, 3)), urgent: true, notes: 'n', progress: 'p' },
      { personIds: [ids.ann], tagIds: [ids.work] },
    )],
  ] as const) {
    it(`${name}: one undo step removes the task with its people and tags; redo puts it back whole`, async () => {
      useUndoStore.getState().clear()
      const { todo } = await make()
      const before = await whole(todo.id)
      expect(before.people.length).toBeGreaterThan(1)
      expect(before.tags.length).toBeGreaterThan(1)
      expect(before.row).toMatchObject({ recurrenceRule: { type: 'monthly' } })
      expect(before.events.map(([, type]) => type)).toContain('created')
      expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual([`Add "${todo.title}"`])

      await useUndoStore.getState().undo()
      expect(await whole(todo.id)).toEqual({ row: null, people: [], tags: [], events: [] })
      expect(useTodoStore.getState().todos.some((t) => t.id === todo.id)).toBe(false)
      // People and tags created on the way stay (creating one is never undone).
      expect(await db.people.where('name').equals('Zed').count()).toBe(1)
      expect(await db.tags.where('name').equals('fresh').count()).toBe(1)

      await useUndoStore.getState().redo()
      expect(await whole(todo.id)).toEqual(before)
      expect(useTodoStore.getState().todos.find((t) => t.id === todo.id)).toMatchObject({ title: todo.title, recurrenceRule: todo.recurrenceRule })
      expect(usePersonStore.getState().assignedPeopleMap.get(todo.id)?.map((p) => p.id).sort()).toEqual(before.people)
      expect(useTagStore.getState().assignedTagsMap.get(todo.id)?.map((t) => t.id).sort()).toEqual(before.tags)
    })
  }
})

describe('create a task — the editor', () => {
  it('keeps the Progress typed in the new-task editor', async () => {
    expect((await viaEditor({ title: 'A', progress: 'Half done' })).todo.progress).toBe('Half done')
  })
})

describe('create a task — new people', () => {
  it('a @name that matches nobody is created (initials, no colour) and assigned with the matched people', async () => {
    const { resolved } = parseTaskInput('Call legal @Ann @"Marco Rossi"', usePersonStore.getState().people)
    expect(resolved.unmatchedPersons).toEqual(['Marco Rossi'])
    const id = await createQuickAddTask({ title: resolved.title, resolved }, NO_DEFAULTS)
    if (id == null) throw new Error('not created')
    const marco = (await db.people.toArray()).find((p) => p.name === 'Marco Rossi')
    expect(marco).toMatchObject({ initials: 'MR' })
    expect(marco?.color).toBeUndefined()
    expect(usePersonStore.getState().assignedPeopleMap.get(id)?.map((p) => p.name).sort()).toEqual(['Ann', 'Marco Rossi'])
  })

  it('reuses a person added since the text was parsed, and makes one person of a name typed twice', async () => {
    const { resolved } = parseTaskInput('Call @marco and @MARCO', usePersonStore.getState().people)
    const marco = await usePersonStore.getState().add('Marco', 'M')
    const id = await createQuickAddTask({ title: resolved.title, resolved }, NO_DEFAULTS)
    if (id == null) throw new Error('not created')
    expect(await db.people.where('name').equalsIgnoreCase('marco').count()).toBe(1)
    expect((await db.todoPeople.where('todoId').equals(id).toArray()).map((j) => j.personId)).toEqual([marco])
  })

  it('no tag is created or assigned when the text names none', async () => {
    const { todo } = await viaQuickAdd('A @Ann')
    expect(await db.tags.count()).toBe(1) // just "work" from the setup
    expect(await db.todoTags.where('todoId').equals(todo.id).count()).toBe(0)
  })
})

describe('create a task — a failed write', () => {
  it('nothing is created, the user is told, nothing rejects', async () => {
    const insert = vi.spyOn(todoRepository, 'insertManyWithAssignments').mockRejectedValue(new Error('disk full'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { resolved } = parseTaskInput('A @Ann #home /urgent', usePersonStore.getState().people, useStatusStore.getState().statuses)
    expect(await createQuickAddTask({ title: resolved.title, resolved }, NO_DEFAULTS)).toBeNull()
    expect(useUndoStore.getState().snackbar?.description).toBe('Couldn\'t add "A".')

    const { result } = renderHook(() => useTaskEditCallbacks())
    let id: number | null = 0
    await act(async () => { id = await result.current.onCreate({ title: 'B' }, { personIds: [ids.ann], tagIds: [] }) })
    expect(id).toBeNull()
    expect(useUndoStore.getState().snackbar?.description).toBe('Couldn\'t add "B".')
    expect(insert).toHaveBeenCalledTimes(2)
    expect(await db.todos.count()).toBe(0)
    expect(useTodoStore.getState().todos).toEqual([])
    expect(useUndoStore.getState().undoStack).toEqual([])
  })
})
