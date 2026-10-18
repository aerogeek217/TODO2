import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { EntityActionHost } from '../../../components/settings/EntityActionHost'
import { db } from '../../../data/database'
import { usePersonStore } from '../../../stores/person-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import { tagTaskDialog } from '../../../services/task-dialog'
import { newTodoUid } from '../../../utils/todo-uid'

afterEach(cleanup)

beforeEach(async () => {
  await db.delete()
  await db.open()
})

async function addTodo(title = 'Task'): Promise<number> {
  return (await db.todos.add({
    uid: newTodoUid(), title, isCompleted: false,
    createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
  })) as number
}

/** Renders the host and lets the editors' mount-time loads land. */
async function renderHost() {
  render(<EntityActionHost />)
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

describe('EntityActionHost', () => {
  it('renders nothing without an action', () => {
    const { container } = render(<EntityActionHost />)
    expect(container).toBeEmptyDOMElement()
  })

  it('Edit… on a person opens the People editor on that person, the name focused', async () => {
    const id = await usePersonStore.getState().add('Alice Chen', 'AC')
    await usePersonStore.getState().add('Ben Ortiz', 'BO')
    useUIStore.getState().openEntityAction({ kind: 'person', id, action: 'edit' })
    await renderHost()
    const name = await screen.findByPlaceholderText('Name')
    expect(name).toHaveValue('Alice Chen')
    expect(name).toHaveFocus()
    fireEvent.change(name, { target: { value: 'Alice Brown' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(usePersonStore.getState().people.map((p) => p.name)).toContain('Alice Brown'))
    fireEvent.click(screen.getAllByRole('button', { name: '×' })[0]!)
    expect(useUIStore.getState().entityAction).toBeNull()
  })

  it('Edit… on a tag opens the Tags editor on that tag', async () => {
    const id = await useTagStore.getState().add('alpha')
    await useTagStore.getState().add('beta')
    useUIStore.getState().openEntityAction({ kind: 'tag', id, action: 'edit' })
    await renderHost()
    const name = await screen.findByPlaceholderText('Tag name')
    expect(name).toHaveValue('alpha')
    expect(name).toHaveFocus()
  })

  it('Delete… on a person asks with the task count, deletes, and Undo brings them back', async () => {
    const id = await usePersonStore.getState().add('Alice Chen', 'AC')
    const todoId = await addTodo()
    await db.todoPeople.add({ todoId, personId: id })
    useUIStore.getState().openEntityAction({ kind: 'person', id, action: 'delete' })
    await renderHost()
    const dialog = await screen.findByRole('dialog', { name: 'Delete person' })
    await waitFor(() => expect(dialog).toHaveTextContent('Delete Alice Chen? Assigned to 1 task.'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(useUIStore.getState().entityAction).toBeNull()
    await waitFor(() => expect(usePersonStore.getState().people).toHaveLength(0))
    await act(async () => { await useUndoStore.getState().undo() })
    await waitFor(() => expect(usePersonStore.getState().people.map((p) => p.name)).toEqual(['Alice Chen']))
    expect(await db.todoPeople.count()).toBe(1)
  })

  it('Delete… on a tag asks with the task count; Cancel keeps it', async () => {
    const id = await useTagStore.getState().add('alpha')
    const todoId = await addTodo()
    await db.todoTags.add({ todoId, tagId: id })
    await useTodoStore.getState().loadAll()
    await useTagStore.getState().loadAssignments([todoId])
    useUIStore.getState().openEntityAction({ kind: 'tag', id, action: 'delete' })
    await renderHost()
    expect(await screen.findByRole('dialog', { name: 'Delete tag' })).toHaveTextContent('Delete alpha? 1 task currently tagged.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(useUIStore.getState().entityAction).toBeNull()
    expect(useTagStore.getState().tags.map((t) => t.name)).toEqual(['alpha'])
  })
})

describe('tagTaskDialog', () => {
  it('lists the tag’s open tasks', () => {
    expect(tagTaskDialog({ id: 3, name: 'work' })).toMatchObject({
      title: '#work',
      glyph: 'tag',
      description: 'Open tasks tagged #work.',
      source: { kind: 'predicate', predicate: expect.objectContaining({ tags: [3], showCompleted: false }) },
    })
  })
})

describe('EntityActionHost — on the top tier', () => {
  it('the editor and the confirm sit over any dialog or picker the menu opened from (the nested tier)', async () => {
    const id = await usePersonStore.getState().add('Alice Chen', 'AC')
    useUIStore.getState().openEntityAction({ kind: 'person', id, action: 'edit' })
    await renderHost()
    expect((await screen.findByRole('dialog', { name: 'People' })).className).toMatch(/layerNested/)
    act(() => { useUIStore.getState().openEntityAction({ kind: 'person', id, action: 'delete' }) })
    expect((await screen.findByRole('dialog', { name: 'Delete person' })).className).toMatch(/layerNested/)
  })
})

describe('EntityActionHost — the delete confirms', () => {
  it('focus Cancel, not the destructive button', async () => {
    const tagId = await useTagStore.getState().add('alpha')
    const personId = await usePersonStore.getState().add('Alice Chen', 'AC')
    useUIStore.getState().openEntityAction({ kind: 'tag', id: tagId, action: 'delete' })
    await renderHost()
    await screen.findByRole('dialog', { name: 'Delete tag' })
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    act(() => { useUIStore.getState().openEntityAction({ kind: 'person', id: personId, action: 'delete' }) })
    await screen.findByRole('dialog', { name: 'Delete person' })
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('a tag’s count is every task carrying it, loaded or not', async () => {
    const id = await useTagStore.getState().add('alpha')
    await db.todoTags.bulkAdd([{ todoId: await addTodo('One'), tagId: id }, { todoId: await addTodo('Two'), tagId: id }])
    // No task assignments loaded.
    useUIStore.getState().openEntityAction({ kind: 'tag', id, action: 'delete' })
    await renderHost()
    const dialog = await screen.findByRole('dialog', { name: 'Delete tag' })
    await waitFor(() => expect(dialog).toHaveTextContent('Delete alpha? 2 tasks currently tagged.'))
  })
})
