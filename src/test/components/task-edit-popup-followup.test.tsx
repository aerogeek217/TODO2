import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { TaskEditPopup } from '../../components/task/TaskEditPopup'
import { useProjectStore } from '../../stores/project-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTaskboardStore } from '../../stores/taskboard-store'
import { makeTodo } from '../helpers'
import type { PersistedTodoItem } from '../../models'

const TITLE_PLACEHOLDER = 'New task... (@person @org #tag /project tomorrow "this week")'
// Sat 10 Oct 2026, 15:30 local.
const NOW = new Date(2026, 9, 10, 15, 30)
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  HTMLInputElement.prototype.showPicker = vi.fn()
  useProjectStore.setState({ projects: [] })
  useSettingsStore.setState({ defaultProjectId: undefined, themeMode: 'dark', followupDefaultInterval: { count: 1, unit: 'm' } })
  useTaskboardStore.setState({ board: { id: 1, entries: [], createdAt: new Date(), updatedAt: new Date() } })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const baseProps = {
  assignedPeople: [],
  allPeople: [],
  onClose: vi.fn(),
  onAssignPerson: vi.fn(),
  onUnassignPerson: vi.fn(),
}

function renderCreate() {
  const onCreate = vi.fn().mockResolvedValue(42)
  render(<TaskEditPopup {...baseProps} mode="create" onCreate={onCreate} />)
  fireEvent.change(screen.getByPlaceholderText(TITLE_PLACEHOLDER), { target: { value: 'Chase invoice' } })
  return { onCreate }
}

function renderEdit(todo: PersistedTodoItem, extra: { onFollowedUp?: () => void } = {}) {
  const onUpdate = vi.fn()
  render(
    <TaskEditPopup
      {...baseProps}
      mode="edit"
      todo={todo}
      onUpdate={onUpdate}
      onToggleComplete={vi.fn()}
      onDelete={vi.fn()}
      {...extra}
    />,
  )
  return { onUpdate }
}

const nextInput = () => screen.getByLabelText('Next follow-up') as HTMLInputElement
const lastInput = () => screen.getByLabelText('Last follow-up') as HTMLInputElement

describe('TaskEditPopup — follow-up group', () => {
  it('create mode: Next is pre-filled with the default and passed to onCreate', async () => {
    const { onCreate } = renderCreate()
    expect(nextInput().value).toBe('Tue 10 Nov')
    expect(screen.getByText('Default · 1 month')).toBeInTheDocument()
    expect(lastInput().value).toBe('')
    fireEvent.click(screen.getByText('Create task'))
    await waitFor(() => expect(onCreate).toHaveBeenCalled())
    const partial = onCreate.mock.calls[0]![0]
    expect(partial.nextFollowupAt).toEqual(day(2026, 11, 10))
    expect(partial.lastFollowupAt).toBeUndefined()
  })

  it('create mode: clearing Next creates the task with no follow-up (key present)', async () => {
    const { onCreate } = renderCreate()
    fireEvent.click(screen.getByLabelText('Clear next follow-up'))
    expect(nextInput().value).toBe('')
    expect(screen.getByText('None')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Create task'))
    await waitFor(() => expect(onCreate).toHaveBeenCalled())
    const partial = onCreate.mock.calls[0]![0]
    expect('nextFollowupAt' in partial).toBe(true)
    expect(partial.nextFollowupAt).toBeUndefined()
  })

  it('create mode: typing an interval shows the resolved date; blur commits it', async () => {
    const { onCreate } = renderCreate()
    fireEvent.change(nextInput(), { target: { value: '2w' } })
    expect(screen.getByText('Sat 24 Oct')).toBeInTheDocument()
    fireEvent.blur(nextInput())
    expect(nextInput().value).toBe('Sat 24 Oct')
    fireEvent.click(screen.getByText('Create task'))
    await waitFor(() => expect(onCreate).toHaveBeenCalled())
    expect(onCreate.mock.calls[0]![0].nextFollowupAt).toEqual(day(2026, 10, 24))
  })

  it('create mode: Followed up stamps last = now and next = default', async () => {
    const { onCreate } = renderCreate()
    fireEvent.click(screen.getByRole('button', { name: 'Followed up' }))
    expect(screen.getByText('✓ Today')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Create task'))
    await waitFor(() => expect(onCreate).toHaveBeenCalled())
    const partial = onCreate.mock.calls[0]![0]
    expect(partial.lastFollowupAt).toEqual(NOW)
    expect(partial.nextFollowupAt).toEqual(day(2026, 11, 10))
  })

  it('edit mode: Next edits apply immediately; invalid input keeps the old value; Esc reverts', () => {
    const todo = makeTodo({ id: 7, nextFollowupAt: day(2026, 10, 13) })
    const { onUpdate } = renderEdit(todo)
    expect(nextInput().value).toBe('Tue 13 Oct')
    expect(screen.getByText('in 3 days')).toBeInTheDocument()

    fireEvent.change(nextInput(), { target: { value: 'whenever' } })
    expect(screen.getByText('Try 2w, 10d, 1m, fri, 24 Oct or 10/24')).toBeInTheDocument()
    fireEvent.blur(nextInput())
    expect(onUpdate).not.toHaveBeenCalled()

    fireEvent.keyDown(nextInput(), { key: 'Escape' })
    expect(nextInput().value).toBe('Tue 13 Oct')
    expect(onUpdate).not.toHaveBeenCalled()

    fireEvent.change(nextInput(), { target: { value: '24 Oct' } })
    fireEvent.keyDown(nextInput(), { key: 'Enter' })
    fireEvent.blur(nextInput())
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0]![0]).toMatchObject({ id: 7, nextFollowupAt: day(2026, 10, 24) })
  })

  it('edit mode: quick interval buttons and × apply immediately', () => {
    const todo = makeTodo({ id: 7, nextFollowupAt: day(2026, 10, 13) })
    const { onUpdate } = renderEdit(todo)
    fireEvent.click(screen.getByRole('button', { name: 'Follow up in 3 months' }))
    expect(onUpdate.mock.calls[0]![0].nextFollowupAt).toEqual(day(2027, 1, 10))
    fireEvent.click(screen.getByLabelText('Clear next follow-up'))
    expect(onUpdate.mock.calls[1]![0].nextFollowupAt).toBeUndefined()
  })

  it('edit mode: Last rejects future dates; Followed up goes to the bulk-aware handler', () => {
    const onFollowedUp = vi.fn()
    const todo = makeTodo({ id: 7, nextFollowupAt: day(2026, 10, 13) })
    const { onUpdate } = renderEdit(todo, { onFollowedUp })
    fireEvent.change(lastInput(), { target: { value: 'tomorrow' } })
    expect(screen.getByText("Last follow-up can't be in the future")).toBeInTheDocument()
    fireEvent.blur(lastInput())
    expect(onUpdate).not.toHaveBeenCalled()
    fireEvent.change(lastInput(), { target: { value: '13 Sep' } })
    fireEvent.blur(lastInput())
    expect(onUpdate.mock.calls[0]![0].lastFollowupAt).toEqual(day(2026, 9, 13))
    fireEvent.click(screen.getByRole('button', { name: 'Followed up' }))
    expect(onFollowedUp).toHaveBeenCalledTimes(1)
  })
})
