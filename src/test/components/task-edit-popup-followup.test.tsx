import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { TaskEditPopup } from '../../components/task/TaskEditPopup'
import { FollowupPopover } from '../../components/shared/followup/FollowupPopover'
import { useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import { makeTodo } from '../helpers'
import type { PersistedTodoItem } from '../../models'

const TITLE_PLACEHOLDER = 'New task… (@person #tag /command)'
// Sat 10 Oct 2026, 15:30 local.
const NOW = new Date(2026, 9, 10, 15, 30)
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  HTMLInputElement.prototype.showPicker = vi.fn()
  useSettingsStore.setState({ themeMode: 'dark', followupDefaultInterval: { count: 1, unit: 'm' } })
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
  it('create mode: Next is pre-filled with the default, which onCreate leaves to the new task', async () => {
    const { onCreate } = renderCreate()
    expect(nextInput().value).toBe('Tue 10 Nov')
    expect(screen.getByText('Default · 1 month')).toBeInTheDocument()
    expect(lastInput().value).toBe('')
    fireEvent.click(screen.getByText('Create task'))
    await waitFor(() => expect(onCreate).toHaveBeenCalled())
    const partial = onCreate.mock.calls[0]![0]
    // Left out while untouched: a `/followup` in the title may still set it,
    // otherwise the store gives every new task the default.
    expect('nextFollowupAt' in partial).toBe(false)
    expect(partial.lastFollowupAt).toBeUndefined()
  })

  it('create mode: focusing Next selects the untouched default (once per click); after an edit, or in edit mode, it does not', () => {
    renderCreate()
    const next = nextInput()
    fireEvent.mouseDown(next)
    act(() => next.focus())
    expect([next.selectionStart, next.selectionEnd]).toEqual([0, 'Tue 10 Nov'.length])
    expect(fireEvent.mouseUp(next)).toBe(false)
    fireEvent.mouseDown(next)
    expect(fireEvent.mouseUp(next)).toBe(true)

    // Edited: no longer the default.
    fireEvent.change(next, { target: { value: '2w' } })
    act(() => next.blur())
    next.setSelectionRange(0, 0)
    fireEvent.mouseDown(next)
    act(() => next.focus())
    expect(next.selectionEnd).toBe(0)
    expect(fireEvent.mouseUp(next)).toBe(true)
    cleanup()

    renderEdit(makeTodo({ id: 7, nextFollowupAt: day(2026, 10, 13) }))
    const stored = nextInput()
    stored.setSelectionRange(0, 0)
    fireEvent.mouseDown(stored)
    act(() => stored.focus())
    expect(stored.selectionEnd).toBe(0)
    expect(fireEvent.mouseUp(stored)).toBe(true)
  })

  it('create mode while new tasks get no follow-up: Next starts empty, no default hint', async () => {
    useSettingsStore.setState({ autoFollowup: false })
    const { onCreate } = renderCreate()
    expect(nextInput().value).toBe('')
    expect(screen.queryByText('Default · 1 month')).toBeNull()
    fireEvent.click(screen.getByText('Create task'))
    await waitFor(() => expect(onCreate).toHaveBeenCalled())
    // Left to the store, which gives none while the setting is off.
    expect('nextFollowupAt' in onCreate.mock.calls[0]![0]).toBe(false)
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

  it('create mode: Mark followed up stamps last = now and next = default', async () => {
    const { onCreate } = renderCreate()
    fireEvent.click(screen.getByRole('button', { name: 'Mark followed up' }))
    expect(screen.getByText('✓ Today')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Create task'))
    await waitFor(() => expect(onCreate).toHaveBeenCalled())
    const partial = onCreate.mock.calls[0]![0]
    expect(partial.lastFollowupAt).toEqual(NOW)
    expect(partial.nextFollowupAt).toEqual(day(2026, 11, 10))
  })

  it('create mode with the automatic next follow-up off: Mark followed up stamps last = now and leaves no next', async () => {
    useSettingsStore.setState({ autoFollowup: false })
    const { onCreate } = renderCreate()
    fireEvent.change(nextInput(), { target: { value: '2w' } })
    fireEvent.blur(nextInput())
    fireEvent.click(screen.getByRole('button', { name: 'Mark followed up' }))
    expect(nextInput().value).toBe('')
    fireEvent.click(screen.getByText('Create task'))
    await waitFor(() => expect(onCreate).toHaveBeenCalled())
    const partial = onCreate.mock.calls[0]![0]
    expect(partial.lastFollowupAt).toEqual(NOW)
    // Key present: none, not "the default".
    expect('nextFollowupAt' in partial).toBe(true)
    expect(partial.nextFollowupAt).toBeUndefined()
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
    expect(onUpdate).toHaveBeenCalledWith({ nextFollowupAt: day(2026, 10, 24) })
  })

  it('edit mode: quick interval buttons and × apply immediately', () => {
    const todo = makeTodo({ id: 7, nextFollowupAt: day(2026, 10, 13) })
    const { onUpdate } = renderEdit(todo)
    fireEvent.click(screen.getByRole('button', { name: 'Follow up in 3 months' }))
    expect(onUpdate.mock.calls[0]![0].nextFollowupAt).toEqual(day(2027, 1, 10))
    fireEvent.click(screen.getByLabelText('Clear next follow-up'))
    expect(onUpdate.mock.calls[1]![0].nextFollowupAt).toBeUndefined()
  })

  it('edit mode: Next has a date picker; a picked day sets the next follow-up', () => {
    const todo = makeTodo({ id: 7, nextFollowupAt: day(2026, 10, 13) })
    const { onUpdate } = renderEdit(todo)
    const button = screen.getByRole('button', { name: 'Pick next follow-up date' })
    fireEvent.click(button)
    const picker = button.nextElementSibling as HTMLInputElement
    expect(picker).toHaveAttribute('type', 'date')
    expect(picker.showPicker).toHaveBeenCalled()
    expect(picker.value).toBe('2026-10-13')
    fireEvent.change(picker, { target: { value: '2026-11-20' } })
    expect(onUpdate).toHaveBeenCalledWith({ nextFollowupAt: day(2026, 11, 20) })
  })

  it('create mode: a day picked for Next goes into the new task', async () => {
    const { onCreate } = renderCreate()
    const button = screen.getByRole('button', { name: 'Pick next follow-up date' })
    fireEvent.change(button.nextElementSibling as HTMLInputElement, { target: { value: '2026-12-01' } })
    fireEvent.click(screen.getByText('Create task'))
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1))
    expect(onCreate.mock.calls[0]![0].nextFollowupAt).toEqual(day(2026, 12, 1))
  })

  it('edit mode: Last rejects future dates; Mark followed up goes to the bulk-aware handler', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Mark followed up' }))
    expect(onFollowedUp).toHaveBeenCalledTimes(1)
  })

  it('edit mode: Mark followed up from the editor shows its result in Next and Last at once (on: today + 1 month; off: cleared)', async () => {
    const id = await useTodoStore.getState().add('Edited')
    await useTodoStore.getState().update(id, { nextFollowupAt: day(2026, 10, 13) })
    const Editor = () => {
      const todo = useTodoStore((s) => s.todos.find((t) => t.id === id))!
      return <TaskEditPopup {...baseProps} mode="edit" todo={todo} onUpdate={vi.fn()} onToggleComplete={vi.fn()} onDelete={vi.fn()} />
    }
    render(<Editor />)
    expect(nextInput().value).toBe('Tue 13 Oct')
    fireEvent.click(screen.getByRole('button', { name: 'Mark followed up' }))
    await waitFor(() => expect(nextInput().value).toBe('Tue 10 Nov'))
    expect(lastInput().value).toBe('Sat 10 Oct')

    useSettingsStore.setState({ autoFollowup: false })
    fireEvent.click(screen.getByRole('button', { name: 'Mark followed up' }))
    await waitFor(() => expect(nextInput().value).toBe(''))
    expect(useTodoStore.getState().todos.find((t) => t.id === id)!.nextFollowupAt).toBeUndefined()
  })

  it('edit mode: Mark followed up is dimmed when the task was already followed up today', () => {
    renderEdit(makeTodo({ id: 7, lastFollowupAt: day(2026, 10, 9) }))
    expect(screen.getByRole('button', { name: 'Mark followed up' })).not.toHaveAttribute('data-done-today')
    cleanup()
    renderEdit(makeTodo({ id: 7, lastFollowupAt: new Date(2026, 9, 10, 9, 0) }))
    expect(screen.getByRole('button', { name: 'Mark followed up' })).toHaveAttribute('data-done-today', 'true')
  })
})

describe('FollowupPopover — Mark followed up', () => {
  it('is the primary button until the task was followed up today, then dimmed (still works)', () => {
    const onFollowedUp = vi.fn()
    const anchor = { kind: 'point' as const, x: 10, y: 10 }
    render(<FollowupPopover todo={makeTodo({ id: 1 })} anchor={anchor} onClose={vi.fn()} onSetNext={vi.fn()} onFollowedUp={onFollowedUp} />)
    expect(screen.getByRole('button', { name: /^Mark followed up/ })).not.toHaveAttribute('data-done-today')
    cleanup()
    render(<FollowupPopover todo={makeTodo({ id: 1, lastFollowupAt: NOW })} anchor={anchor} onClose={vi.fn()} onSetNext={vi.fn()} onFollowedUp={onFollowedUp} />)
    const done = screen.getByRole('button', { name: /^Mark followed up/ })
    expect(done).toHaveAttribute('data-done-today', 'true')
    fireEvent.click(done)
    expect(onFollowedUp).toHaveBeenCalledTimes(1)
    cleanup()
    // The bulk bar decides for the whole selection.
    render(<FollowupPopover todo={makeTodo({ id: 1, lastFollowupAt: NOW })} anchor={anchor} onClose={vi.fn()} onSetNext={vi.fn()} onFollowedUp={onFollowedUp} followedUpToday={false} />)
    expect(screen.getByRole('button', { name: /^Mark followed up/ })).not.toHaveAttribute('data-done-today')
  })
})
