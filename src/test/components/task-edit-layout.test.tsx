// The one task layout (board BJ) in the task editor: the header (box, title,
// ⋯, ×), then the body — the facts rail (Priority, Status, People, Tags,
// Due, Follow-up last, each under its coloured, iconed header) beside the
// writing (Notes, Subtasks, Status updates) —, then the footer (the dates
// and Done; Duplicate, Make subtask of… and Delete are the ⋯'s). An empty
// writing section is one line. Edit and create mode; a draft has no Last row.
// Sizes, scrolling and the narrow stacking are the real browser's
// (`e2e/task-layout.spec.ts`).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { TaskEditPopup } from '../../components/task/TaskEditPopup'
import { TaskEditPopupHost } from '../../components/task/TaskEditPopupHost'
import { db } from '../../data/database'
import { useStatusStore } from '../../stores/status-store'
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

const RAIL = ['priority', 'status', 'people', 'tags', 'due', 'followup']
const HEADERS = ['Priority', 'Status', 'People', 'Tags', 'Due', 'Follow-up']

function expectLayout(root: HTMLElement, rail = RAIL) {
  const railEl = root.querySelector('[data-task-rail]') as HTMLElement
  const writing = root.querySelector('[data-task-writing]') as HTMLElement
  expect(railEl).not.toBeNull()
  expect(writing).not.toBeNull()
  // The rail first (in the reading and focus order), the writing after it.
  expect(follows(railEl, writing)).toBe(true)
  const facts = Array.from(railEl.querySelectorAll('[data-fact]'))
  expect(facts.map((f) => f.getAttribute('data-fact'))).toEqual(rail)
  // Each fact a region named by its header, the header an icon and its name.
  for (const fact of facts) {
    const header = fact.querySelector('[id]') as HTMLElement
    expect(header.querySelector('svg')).not.toBeNull()
    expect(fact).toHaveAccessibleName(header.textContent ?? '')
  }
  expect(facts.map((f) => f.querySelector('[id]')?.textContent))
    .toEqual(HEADERS.filter((_, i) => rail.includes(RAIL[i] ?? '')))
  // The writing: Notes, Subtasks, Status updates.
  const notes = writing.querySelector('[data-task-notes]')!
  const subtasks = writing.querySelector('[data-subtasks]')!
  const updates = writing.querySelector('[data-status-updates]')!
  expect(follows(notes, subtasks)).toBe(true)
  expect(follows(subtasks, updates)).toBe(true)
  // No badges row and no framed fields block any more.
  expect(root.querySelector('[data-task-fields], [data-task-pair]')).toBeNull()
  return { rail: railEl, writing, followup: railEl.querySelector('[data-task-followup]') as HTMLElement }
}

async function openStored(todo = makeTodo({ id: 7, title: 'Vendor contract renewal' })) {
  await db.todos.add(todo)
  useTodoStore.setState({ todos: [todo] })
  act(() => useUIStore.getState().openEditPopup(todo.id))
  render(<TaskEditPopupHost />)
  await act(async () => { await Promise.resolve() })
  return screen.getByRole('dialog', { name: 'Edit task' })
}

describe('the task layout in the editor', () => {
  it('edit mode: the facts rail in its order beside the writing; Follow-up last with Next, Last, Mark followed up', async () => {
    useStatusStore.setState({ statuses: [{ id: 1, name: 'Waiting', color: '#f5c842', sortOrder: 0 }] })
    const dialog = await openStored()
    const { followup } = expectLayout(dialog)
    const f = within(followup)
    expect(f.getByRole('textbox', { name: 'Next follow-up' })).toBeInTheDocument()
    expect(f.getByRole('textbox', { name: 'Last follow-up' })).toBeInTheDocument()
    expect(f.getByRole('button', { name: 'Mark followed up' })).toBeInTheDocument()
    // The quick intervals: 1w 2w 1m 3m.
    expect(within(f.getByRole('group', { name: 'Quick follow-up intervals' })).getAllByRole('button').map((b) => b.textContent))
      .toEqual(['1w', '2w', '1m', '3m'])
  })

  it('without statuses the rail has no Status', async () => {
    useStatusStore.setState({ statuses: [] })
    const dialog = await openStored()
    expectLayout(dialog, RAIL.filter((f) => f !== 'status'))
  })

  it('an empty task: Notes, Subtasks and Status updates are one line each; + Add notes opens the editor', async () => {
    const dialog = await openStored()
    const writing = dialog.querySelector('[data-task-writing]') as HTMLElement
    const w = within(writing)
    expect(w.getByRole('button', { name: 'Add notes' })).toBeInTheDocument()
    expect(writing.querySelector('[data-task-notes] .cm-editor')).toBeNull()
    // Subtasks: the add line; its label only names the region.
    const subtasks = w.getByRole('region', { name: 'Subtasks' })
    expect(subtasks).toHaveAttribute('data-empty')
    expect(within(subtasks).getByPlaceholderText('Add subtask')).toBeInTheDocument()
    expect(within(subtasks).queryByRole('list')).toBeNull()
    // Status updates: the add line alone.
    const updates = w.getByRole('region', { name: 'Status updates' })
    expect(updates).toHaveAttribute('data-empty')
    expect(within(updates).getByRole('textbox', { name: 'New status update' })).toBeInTheDocument()

    fireEvent.click(w.getByRole('button', { name: 'Add notes' }))
    expect(w.queryByRole('button', { name: 'Add notes' })).toBeNull()
    expect(writing.querySelector('[data-task-notes] .cm-editor')).not.toBeNull()
  })

  it('a task with notes shows the notes editor under its label', async () => {
    const dialog = await openStored(makeTodo({ id: 8, title: 'With notes', notes: 'Legal wants a rewrite' }))
    const notes = dialog.querySelector('[data-task-notes]') as HTMLElement
    expect(notes).not.toHaveAttribute('data-empty')
    expect(within(notes).getByText('Notes')).toBeInTheDocument()
    expect(notes.querySelector('.cm-editor')).not.toBeNull()
  })

  it('the header’s ⋯ holds Duplicate, Make subtask of… and Delete; the footer is the dates and Done', async () => {
    const dialog = await openStored()
    const footerButtons = Array.from(dialog.querySelectorAll('button')).filter((b) => ['Duplicate', 'Delete', 'Make subtask of…'].includes(b.textContent ?? ''))
    expect(footerButtons).toEqual([])
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(dialog.textContent).toMatch(/Created .* · Modified /)
    fireEvent.click(within(dialog).getByRole('button', { name: 'More actions' }))
    const menu = screen.getByRole('menu', { name: 'Task actions' })
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Duplicate', 'Make subtask of…', 'Delete'])
    // Make subtask of… opens the task picker for this task.
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Make subtask of…' }))
    await act(async () => { await Promise.resolve() })
    expect(useUIStore.getState().taskPicker).toMatchObject({ kind: 'make-subtask', todoId: 7 })
  })

  it('create mode: the same layout, no ⋯; a draft has no Last row', () => {
    const base = {
      mode: 'create' as const,
      assignedPeople: [],
      allPeople: [],
      onClose: vi.fn(),
      onCreate: vi.fn().mockResolvedValue(1),
      onAssignPerson: vi.fn(),
      onUnassignPerson: vi.fn(),
    }
    useStatusStore.setState({ statuses: [] })
    render(<TaskEditPopup {...base} />)
    const dialog = screen.getByRole('dialog', { name: 'New task' })
    expectLayout(dialog, RAIL.filter((f) => f !== 'status'))
    expect(screen.getByRole('textbox', { name: 'Last follow-up' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'More actions' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Create task' })).toBeInTheDocument()
    cleanup()

    render(<TaskEditPopup {...base} onSaveDraft={vi.fn()} />)
    const { followup } = expectLayout(screen.getByRole('dialog', { name: 'New task' }), RAIL.filter((f) => f !== 'status'))
    expect(within(followup).queryByRole('textbox', { name: 'Last follow-up' })).toBeNull()
    expect(within(followup).queryByRole('button', { name: 'Mark followed up' })).toBeNull()
  })
})
