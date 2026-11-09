// The one task layout (D26 BB / BG) in the task editor: the header, the
// badges, then the body in its order — the fields (Due + repeat, People,
// Tags) · Subtasks | Notes side by side · Status updates · the Follow-up
// group last, which keeps Mark followed up on its Last row (edit and
// create mode; a draft has no Last row). Sizes, scrolling and the stacking
// under 640px are the real browser's (`e2e/task-layout.spec.ts`).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { TaskEditPopup } from '../../components/task/TaskEditPopup'
import { TaskEditPopupHost } from '../../components/task/TaskEditPopupHost'
import { db } from '../../data/database'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { makeTodo, resetDb } from '../helpers'

beforeEach(async () => {
  HTMLInputElement.prototype.showPicker = vi.fn()
  await resetDb()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

/** The body's blocks in document order, as their markers name them. */
function blocks(root: ParentNode) {
  return {
    fields: root.querySelector('[data-task-fields]'),
    pair: root.querySelector('[data-task-pair]'),
    subtasks: root.querySelector('[data-task-pair] [data-subtasks]'),
    notes: root.querySelector('[data-task-pair] [data-task-notes]'),
    updates: root.querySelector('[data-status-updates]'),
    followup: root.querySelector('[data-task-followup]'),
  }
}

function expectLayoutOrder(root: ParentNode) {
  const b = blocks(root)
  for (const el of Object.values(b)) expect(el).not.toBeNull()
  expect(follows(b.fields!, b.pair!)).toBe(true)
  expect(follows(b.subtasks!, b.notes!)).toBe(true)
  expect(follows(b.pair!, b.updates!)).toBe(true)
  expect(follows(b.updates!, b.followup!)).toBe(true)
  // The fields block: Due, People, Tags — no follow-up rows any more.
  expect(Array.from(b.fields!.querySelectorAll('span')).map((s) => s.textContent).filter((t) => ['Due', 'People', 'Tags', 'Next', 'Last'].includes(t ?? '')))
    .toEqual(['Due', 'People', 'Tags'])
  return b
}

describe('the task layout in the editor', () => {
  it('edit mode: fields · Subtasks | Notes · Status updates · Follow-up (Next, Last with Mark followed up)', async () => {
    const todo = makeTodo({ id: 7, title: 'Vendor contract renewal' })
    await db.todos.add(todo)
    useTodoStore.setState({ todos: [todo] })
    act(() => useUIStore.getState().openEditPopup(7))
    render(<TaskEditPopupHost />)
    await act(async () => { await Promise.resolve() })
    const dialog = screen.getByRole('dialog', { name: 'Edit task' })
    const b = expectLayoutOrder(dialog)
    const followup = within(b.followup as HTMLElement)
    expect(followup.getByText('Follow-up')).toBeInTheDocument()
    expect(followup.getByRole('textbox', { name: 'Next follow-up' })).toBeInTheDocument()
    expect(followup.getByRole('textbox', { name: 'Last follow-up' })).toBeInTheDocument()
    expect(followup.getByRole('button', { name: 'Mark followed up' })).toBeInTheDocument()
    // Status updates: the add line is the section's last field.
    const updates = b.updates as HTMLElement
    expect(within(updates).getByRole('textbox', { name: 'New status update' })).toBe(updates.querySelector('input:last-of-type'))
  })

  it('create mode: the same order; a draft has no Last row', () => {
    const base = {
      mode: 'create' as const,
      assignedPeople: [],
      allPeople: [],
      onClose: vi.fn(),
      onCreate: vi.fn().mockResolvedValue(1),
      onAssignPerson: vi.fn(),
      onUnassignPerson: vi.fn(),
    }
    render(<TaskEditPopup {...base} />)
    expectLayoutOrder(screen.getByRole('dialog', { name: 'New task' }))
    expect(screen.getByRole('textbox', { name: 'Last follow-up' })).toBeInTheDocument()
    cleanup()

    render(<TaskEditPopup {...base} onSaveDraft={vi.fn()} />)
    const b = expectLayoutOrder(screen.getByRole('dialog', { name: 'New task' }))
    expect(within(b.followup as HTMLElement).queryByRole('textbox', { name: 'Last follow-up' })).toBeNull()
    expect(within(b.followup as HTMLElement).queryByRole('button', { name: 'Mark followed up' })).toBeNull()
  })
})
