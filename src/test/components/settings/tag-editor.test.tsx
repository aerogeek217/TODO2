import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { TagEditor } from '../../../components/settings/TagEditor'
import { db } from '../../../data/database'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTagStore.setState({ tags: [], assignedTagsMap: new Map() })
  useTodoStore.setState({ todos: [], todosVersion: 0 })
})

const realLoad = useTagStore.getState().load

afterEach(() => {
  cleanup()
  useTagStore.setState({ load: realLoad })
})

/**
 * Renders the editor and waits for its mount-time `load()` to finish. Without
 * the wait, a test that edits right away races that read: the load's
 * `set({ tags })` can land after the edit's optimistic update and put the
 * pre-edit rows back.
 */
async function renderEditor() {
  let mountLoad: Promise<void> | undefined
  useTagStore.setState({ load: () => (mountLoad = realLoad()) })
  const utils = render(<TagEditor onClose={() => {}} />)
  await act(async () => { await mountLoad })
  return utils
}

async function addTodo(title = 'Task'): Promise<number> {
  return (await db.todos.add({
    title, isCompleted: false,
    createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
  })) as number
}

describe('TagEditor', () => {
  it('adds a new tag via the inline form', async () => {
    const { getByPlaceholderText, getByText, findByText } = await renderEditor()
    fireEvent.click(getByText('+ Add Tag'))
    fireEvent.change(getByPlaceholderText('Tag name'), { target: { value: 'urgent' } })
    fireEvent.click(getByText('Add'))

    await findByText('urgent')
    expect(useTagStore.getState().tags).toHaveLength(1)
    expect(useTagStore.getState().tags[0]!.name).toBe('urgent')
  })

  it('rejects a case-insensitive duplicate name with an inline error', async () => {
    await useTagStore.getState().add('urgent')

    const { getByPlaceholderText, getByText, findByText, container } = await renderEditor()
    await findByText('urgent')

    fireEvent.click(getByText('+ Add Tag'))
    fireEvent.change(getByPlaceholderText('Tag name'), { target: { value: 'URGENT' } })
    fireEvent.click(getByText('Add'))

    await waitFor(() => expect(container.textContent).toMatch(/already exists/i))
    expect(useTagStore.getState().tags).toHaveLength(1)
  })

  it('edits a tag name via click-on-name', async () => {
    await useTagStore.getState().add('urgent')

    const { getByDisplayValue, getByText, findByText } = await renderEditor()
    const row = await findByText('urgent')
    fireEvent.click(row)

    const input = getByDisplayValue('urgent')
    fireEvent.change(input, { target: { value: 'critical' } })
    fireEvent.click(getByText('Save'))

    await findByText('critical')
    expect(useTagStore.getState().tags[0]!.name).toBe('critical')
  })

  it('surfaces the assigned task count in the delete confirmation and cascades the join rows', async () => {
    const tagId = await useTagStore.getState().add('urgent')
    const todoId = await addTodo()
    await db.todoTags.add({ todoId, tagId })
    // Pre-populate the todo + assignment caches so the count selector has the
    // data it needs on first render. In production the user has navigated
    // through a view that loaded these before reaching Settings; here we mirror
    // that preload explicitly so the test doesn't race the editor's own
    // mount-time fetches.
    await useTodoStore.getState().loadAll()
    await useTagStore.getState().loadAssignments([todoId])

    const { container, getByText, findByText } = await renderEditor()
    await findByText('urgent')

    const deleteBtn = container.querySelector('[title="Delete"]') as HTMLButtonElement | null
    expect(deleteBtn).not.toBeNull()
    fireEvent.click(deleteBtn!)

    await waitFor(() => expect(container.textContent).toMatch(/1 task currently tagged/i))

    fireEvent.click(getByText('Delete'))

    await waitFor(() => expect(useTagStore.getState().tags).toHaveLength(0))
    expect(await db.todoTags.count()).toBe(0)
  })
})
