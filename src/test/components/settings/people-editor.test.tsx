import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Profiler } from 'react'
import { useTodoStore } from '../../../stores/todo-store'
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { PeopleEditor } from '../../../components/settings/PeopleEditor'
import { db } from '../../../data/database'
import { usePersonStore } from '../../../stores/person-store'
import { NEUTRAL_PERSON_COLOR } from '../../../constants'
import { newTodoUid } from '../../../utils/todo-uid'

const realLoad = usePersonStore.getState().load

beforeEach(async () => {
  await db.delete()
  await db.open()
  usePersonStore.setState({ people: [], assignedPeopleMap: new Map() })
})

afterEach(() => {
  cleanup()
  usePersonStore.setState({ load: realLoad })
})

/** Renders the editor and waits for its mount-time `load()` (see TagEditor's test). */
async function renderEditor() {
  let mountLoad: Promise<void> | undefined
  usePersonStore.setState({ load: () => (mountLoad = realLoad()) })
  const utils = render(<PeopleEditor onClose={() => {}} />)
  await act(async () => { await mountLoad })
  return utils
}

function hexInput(root: HTMLElement): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>('input[type="text"][maxlength="7"]')
  if (!input) throw new Error('hex input not found')
  return input
}

async function addTodo(title: string, isCompleted: boolean): Promise<number> {
  return (await db.todos.add({
    uid: newTodoUid(), title, isCompleted,
    createdAt: new Date(), modifiedAt: new Date(), sortOrder: 1,
  })) as number
}

describe('PeopleEditor', () => {
  it('shows each person’s task count, open and completed, as Tags does', async () => {
    const ann = await db.people.add({ name: 'Ann', initials: 'AN' }) as number
    await db.people.add({ name: 'Bob', initials: 'BO' })
    const open = await addTodo('Open', false)
    const done = await addTodo('Done', true)
    await db.todoPeople.bulkAdd([{ todoId: open, personId: ann }, { todoId: done, personId: ann }])

    const { findByText } = await renderEditor()
    await findByText('Ann')
    const counts = () => [...document.body.querySelectorAll('[data-testid="entity-task-count"]')].map((el) => [el.textContent, el.getAttribute('title')])
    await waitFor(() => expect(counts()).toEqual([['2', '2 tasks'], ['', '0 tasks']]))
  })

  it('a task edit while it is open renders nothing (the counts follow the set of tasks, not each edit)', async () => {
    const ann = await db.people.add({ name: 'Ann', initials: 'AN' }) as number
    const open = await addTodo('Open', false)
    await db.todoPeople.add({ todoId: open, personId: ann })
    const renders = { n: 0 }
    let mountLoad: Promise<void> | undefined
    usePersonStore.setState({ load: () => (mountLoad = realLoad()) })
    const { findByText, getByTestId } = render(
      <Profiler id="people" onRender={() => { renders.n++ }}>
        <PeopleEditor onClose={() => {}} />
      </Profiler>,
    )
    await act(async () => { await mountLoad })
    await findByText('Ann')
    await waitFor(() => expect(getByTestId('entity-task-count').textContent).toBe('1'))
    renders.n = 0
    await act(async () => { await useTodoStore.getState().update(open, { title: 'Open, renamed' }) })
    expect(renders.n).toBe(0)
  })

  it('adds a person without a color by default (neutral swatch)', async () => {
    const { getByPlaceholderText, getByText, findByText } = await renderEditor()
    fireEvent.click(getByText('+ Add Person'))
    fireEvent.change(getByPlaceholderText('Name'), { target: { value: 'Org: Acme' } })
    fireEvent.click(getByText('Add'))

    await findByText('Org: Acme')
    const [person] = usePersonStore.getState().people
    expect(person).toMatchObject({ name: 'Org: Acme', initials: 'OA' })
    expect('color' in person!).toBe(false)
    const swatch = document.body.querySelector<HTMLElement>('[class*="colorSwatch"]')
    expect(swatch?.style.background).toBe('rgb(156, 163, 175)') // NEUTRAL_PERSON_COLOR
    expect(NEUTRAL_PERSON_COLOR).toBe('#9CA3AF')
  })

  it('adds a person with a picked color', async () => {
    const { getByPlaceholderText, getByText, findByText } = await renderEditor()
    fireEvent.click(getByText('+ Add Person'))
    fireEvent.change(getByPlaceholderText('Name'), { target: { value: 'Ann Lee' } })
    fireEvent.change(hexInput(document.body), { target: { value: '#f28c4e' } })
    fireEvent.click(getByText('Add'))

    await findByText('Ann Lee')
    expect(usePersonStore.getState().people[0]).toMatchObject({ name: 'Ann Lee', color: '#f28c4e' })
    expect((await db.people.toArray())[0]).toMatchObject({ color: '#f28c4e' })
  })

  it('edits and then removes a person color', async () => {
    await usePersonStore.getState().add('Ann Lee', 'AL')
    const { getByText, findByText, getByLabelText, queryByLabelText } = await renderEditor()

    fireEvent.click(await findByText('Ann Lee'))
    expect(queryByLabelText('Remove color')).toBeNull()
    fireEvent.change(hexInput(document.body), { target: { value: '#123456' } })
    fireEvent.click(getByText('Save'))
    await waitFor(() => expect(usePersonStore.getState().people[0]?.color).toBe('#123456'))

    fireEvent.click(await findByText('Ann Lee'))
    fireEvent.click(getByLabelText('Remove color'))
    fireEvent.click(getByText('Save'))
    await waitFor(() => expect('color' in usePersonStore.getState().people[0]!).toBe(false))
    const stored = await db.people.toArray()
    expect('color' in stored[0]!).toBe(false)
  })

  it('has no org membership control', async () => {
    await usePersonStore.getState().add('Ann Lee', 'AL')
    const { findByText, queryByText } = await renderEditor()
    fireEvent.click(await findByText('Ann Lee'))
    expect(queryByText('Orgs')).toBeNull()
  })

  it('has no Email field: a new person is saved with a name, initials and color only', async () => {
    const { getByPlaceholderText, getByText, queryByLabelText, findByText } = await renderEditor()
    fireEvent.click(getByText('+ Add Person'))
    expect(queryByLabelText('Email')).toBeNull()
    fireEvent.change(getByPlaceholderText('Name'), { target: { value: 'Ann Lee' } })
    fireEvent.click(getByText('Add'))
    await findByText('Ann Lee')
    expect(await db.people.toArray()).toEqual([expect.objectContaining({ name: 'Ann Lee', initials: 'AL' })])
    expect('email' in (await db.people.toArray())[0]!).toBe(false)

    fireEvent.click(await findByText('Ann Lee'))
    expect(queryByLabelText('Email')).toBeNull()
  })
})
