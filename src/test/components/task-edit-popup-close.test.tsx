// The task editor's header × (cr34, answer 19): in the new-task editor it
// closes as Esc and the backdrop do — a form that differs from how it opened
// asks Create task / Discard / Keep editing first (Discard / Keep editing
// with no title) — while the Cancel button still discards without asking.
// In edit mode there is nothing unsaved: the × just closes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TaskEditPopup } from '../../components/task/TaskEditPopup'
import { useUIStore } from '../../stores/ui-store'
import { makeTodo, resetDb } from '../helpers'

const TITLE_PLACEHOLDER = 'New task… (@person #tag !status /command)'

beforeEach(async () => {
  HTMLInputElement.prototype.showPicker = vi.fn()
  await resetDb()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderCreate() {
  const onClose = vi.fn()
  const onCreate = vi.fn().mockResolvedValue(42)
  render(
    <TaskEditPopup
      mode="create"
      assignedPeople={[]}
      allPeople={[]}
      onClose={onClose}
      onCreate={onCreate}
      onAssignPerson={vi.fn()}
      onUnassignPerson={vi.fn()}
    />,
  )
  return { onClose, onCreate }
}

const closeButton = () => screen.getByRole('button', { name: 'Close' })
const typeTitle = (text: string) => fireEvent.change(screen.getByPlaceholderText(TITLE_PLACEHOLDER), { target: { value: text } })
const settle = () => act(async () => {})

describe('the new-task editor’s ×', () => {
  it('an untouched form closes at once, asking nothing', async () => {
    const { onClose } = renderCreate()
    const choice = vi.spyOn(useUIStore.getState(), 'askChoice')
    const confirm = vi.spyOn(useUIStore.getState(), 'askConfirmation')
    fireEvent.click(closeButton())
    await settle()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(choice).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('a typed title asks Create task / Discard / Keep editing; Keep editing stays', async () => {
    const { onClose, onCreate } = renderCreate()
    const choice = vi.spyOn(useUIStore.getState(), 'askChoice').mockResolvedValue('cancel')
    typeTitle('Call the vendor')
    fireEvent.click(closeButton())
    await settle()
    expect(choice).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Keep this new task?',
      confirmLabel: 'Create task',
      discardLabel: 'Discard',
      cancelLabel: 'Keep editing',
    }))
    expect(onClose).not.toHaveBeenCalled()
    expect(onCreate).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText(TITLE_PLACEHOLDER)).toHaveValue('Call the vendor')
  })

  it('Discard closes without creating; Create task creates, then closes', async () => {
    const first = renderCreate()
    const choice = vi.spyOn(useUIStore.getState(), 'askChoice').mockResolvedValue('discard')
    typeTitle('Call the vendor')
    fireEvent.click(closeButton())
    await settle()
    expect(first.onClose).toHaveBeenCalledTimes(1)
    expect(first.onCreate).not.toHaveBeenCalled()
    cleanup()

    choice.mockResolvedValue('confirm')
    const second = renderCreate()
    typeTitle('Call the vendor')
    fireEvent.click(closeButton())
    await settle()
    expect(second.onCreate).toHaveBeenCalledTimes(1)
    expect(second.onCreate.mock.calls[0]?.[0]).toMatchObject({ title: 'Call the vendor' })
    expect(second.onClose).toHaveBeenCalledTimes(1)
  })

  it('a change with no title asks Discard / Keep editing (it can’t be created)', async () => {
    const { onClose } = renderCreate()
    const confirm = vi.spyOn(useUIStore.getState(), 'askConfirmation').mockResolvedValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Urgent' }))
    fireEvent.click(closeButton())
    await settle()
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard this new task?', confirmLabel: 'Discard', cancelLabel: 'Keep editing' }))
    expect(onClose).not.toHaveBeenCalled()

    confirm.mockResolvedValue(true)
    fireEvent.click(closeButton())
    await settle()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the Cancel button still discards without asking', async () => {
    const { onClose, onCreate } = renderCreate()
    const choice = vi.spyOn(useUIStore.getState(), 'askChoice')
    typeTitle('Call the vendor')
    fireEvent.click(screen.getByRole('button', { name: /^Cancel/ }))
    await settle()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onCreate).not.toHaveBeenCalled()
    expect(choice).not.toHaveBeenCalled()
  })
})

describe('the edit-mode editor’s ×', () => {
  it('closes at once: every edit is already saved', async () => {
    const onClose = vi.fn()
    const choice = vi.spyOn(useUIStore.getState(), 'askChoice')
    render(
      <TaskEditPopup
        mode="edit"
        todo={makeTodo({ title: 'Stored task' })}
        assignedPeople={[]}
        allPeople={[]}
        onClose={onClose}
        onUpdate={vi.fn()}
        onToggleComplete={vi.fn()}
        onDelete={vi.fn()}
        onAssignPerson={vi.fn()}
        onUnassignPerson={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText('Task title'), { target: { value: 'Stored task, renamed' } })
    fireEvent.click(closeButton())
    await settle()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(choice).not.toHaveBeenCalled()
  })
})
