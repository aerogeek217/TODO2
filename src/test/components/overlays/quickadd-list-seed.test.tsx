import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AppQuickAddBar } from '../../../App'
import { TaskEditPopupHost } from '../../../components/task/TaskEditPopupHost'
import { db } from '../../../data/database'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import type { FilterDefaults } from '../../../utils/filter-defaults'
import { patchScreenFilter, resetDb } from '../../helpers'
import { resetStores } from '../../store-tracking'

// A list's "+ Add task" opens Quick Add with the list's defaults shown as
// chips (`AppQuickAddBar`): what the chips say is what the task gets, through
// Enter and through Details into the editor.

let ids: { ann: number; bob: number; waiting: number; doing: number; work: number; home: number }

beforeEach(async () => {
  HTMLInputElement.prototype.showPicker = vi.fn()
  await resetDb()
  resetStores()
  ids = {
    ann: await usePersonStore.getState().add('Ann', 'AN'),
    bob: await usePersonStore.getState().add('Bob', 'BO'),
    waiting: await useStatusStore.getState().add('Waiting'),
    doing: await useStatusStore.getState().add('Doing'),
    work: await useTagStore.getState().add('work'),
    home: await useTagStore.getState().add('home'),
  }
  useUndoStore.getState().clear()
})

afterEach(() => { cleanup() })

function listSeed(): FilterDefaults {
  return { personIds: [ids.ann], tagIds: [ids.work], statusId: ids.waiting, markers: { urgent: true } }
}

function renderBar(defaults?: FilterDefaults) {
  render(<><AppQuickAddBar /><TaskEditPopupHost /></>)
  act(() => { useUIStore.getState().openQuickAdd(defaults ? { defaults } : undefined) })
}

function input() {
  return screen.getByPlaceholderText('New task…')
}

/** The chips row's texts (without the ×s and the default follow-up's). */
function chipTexts(): string[] {
  const group = screen.queryByRole('group', { name: 'What the task gets' })
  if (!group) return []
  return Array.from(group.children, (el) => {
    const copy = el.cloneNode(true) as HTMLElement
    copy.querySelectorAll('button').forEach((b) => b.remove())
    return (copy.textContent ?? '').trim()
  }).filter((t) => !t.includes('default'))
}

function pressRemove(name: string) {
  const button = screen.getByRole('button', { name })
  fireEvent.mouseDown(button)
  fireEvent.click(button)
}

async function createdTask(title: string) {
  await waitFor(() => expect(useTodoStore.getState().todos.some((t) => t.title === title)).toBe(true))
  const todo = useTodoStore.getState().todos.find((t) => t.title === title)!
  const people = await Promise.all((await db.todoPeople.where('todoId').equals(todo.id).toArray()).map((r) => db.people.get(r.personId)))
  const tags = await Promise.all((await db.todoTags.where('todoId').equals(todo.id).toArray()).map((r) => db.tags.get(r.tagId)))
  return { todo, people: people.map((p) => p!.name).sort(), tags: tags.map((t) => t!.name).sort() }
}

describe('Quick Add from a list’s + Add task', () => {
  it('opens with the list’s person, tag, status and marker as chips; Enter gives the task each of them', async () => {
    renderBar(listSeed())
    expect(input()).toHaveValue('')
    expect(chipTexts()).toEqual(['Urgent', '#work', 'AN@Ann', 'Waiting'])
    fireEvent.change(input(), { target: { value: 'Call vendor' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    const { todo, people, tags } = await createdTask('Call vendor')
    expect(people).toEqual(['Ann'])
    expect(tags).toEqual(['work'])
    expect(todo.statusId).toBe(ids.waiting)
    expect(todo.urgent).toBe(true)
  })

  it('a removed chip is not applied; a typed status wins; a typed person and tag go beside the list’s', async () => {
    useSettingsStore.setState({ defaultStatusId: ids.doing })
    renderBar(listSeed())
    pressRemove('Remove #work')
    pressRemove('Remove Urgent')
    fireEvent.change(input(), { target: { value: 'Call @Bob #home !Doing' } })
    expect(chipTexts()).toEqual(['#home', 'AN@Ann', 'BO@Bob', 'Doing'])
    fireEvent.keyDown(input(), { key: 'Enter' })
    const { todo, people, tags } = await createdTask('Call')
    expect(people).toEqual(['Ann', 'Bob'])
    expect(tags).toEqual(['home'])
    expect(todo.statusId).toBe(ids.doing)
    expect(todo.urgent).toBeUndefined()
  })

  it('the status chip removed: the task gets Settings’ default status, as Quick Add from the top bar', async () => {
    useSettingsStore.setState({ defaultStatusId: ids.doing })
    renderBar(listSeed())
    pressRemove('Remove status')
    pressRemove('Remove @Ann')
    expect(chipTexts()).toEqual(['Urgent', '#work'])
    fireEvent.change(input(), { target: { value: 'Plain' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    const { todo, people } = await createdTask('Plain')
    expect(todo.statusId).toBe(ids.doing)
    expect(people).toEqual([])
  })

  it('Details carries the shown defaults into the editor, without the removed ones; the list’s status over Settings’', async () => {
    useSettingsStore.setState({ defaultStatusId: ids.doing })
    renderBar(listSeed())
    pressRemove('Remove #work')
    fireEvent.change(input(), { target: { value: 'Draft memo @Bob' } })
    fireEvent.click(screen.getByRole('button', { name: /Details/ }))
    expect(useUIStore.getState().quickAddDraft?.defaults).toEqual({ personIds: [ids.ann], tagIds: [], statusId: ids.waiting, markers: { urgent: true } })
    await waitFor(() => expect(screen.getByText('Create task')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Create task'))
    const { todo, people, tags } = await createdTask('Draft memo')
    expect(people).toEqual(['Ann', 'Bob'])
    expect(tags).toEqual([])
    expect(todo.statusId).toBe(ids.waiting)
    expect(todo.urgent).toBe(true)
  })
})

describe('Quick Add with no list seed (the top bar, +, the shortcut)', () => {
  it('opens with no chips; the screen filter still seeds as before (its people only when the text names nobody)', async () => {
    patchScreenFilter({ personIds: new Set([ids.ann]), tags: new Set([ids.work]) })
    renderBar()
    expect(chipTexts()).toEqual([])
    fireEvent.change(input(), { target: { value: 'Ask @Bob' } })
    expect(chipTexts()).toEqual(['BO@Bob'])
    fireEvent.keyDown(input(), { key: 'Enter' })
    const { people, tags } = await createdTask('Ask')
    expect(people).toEqual(['Bob'])
    expect(tags).toEqual(['work'])
  })
})
