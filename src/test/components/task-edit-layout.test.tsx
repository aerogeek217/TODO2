// The one task layout (boards BJ, BL) in the task editor: the header (box,
// title, ⋯, ×), then the body — the facts rail (Priority, Status, People,
// Tags, Due, Follow-up last, each under its header: the standard section
// label, no icon) beside the writing (Notes and Subtasks in what scrolls,
// Status updates in the dock under it) —, then the footer (the dates and
// Done; Duplicate, Make subtask of… and Delete are the ⋯'s). The Notes box
// and every heading are there while empty. Edit and create mode; a draft
// has no Last row. Sizes, scrolling, the dock's place and the narrow
// stacking are the real browser's (`e2e/task-layout.spec.ts`,
// `e2e/reviewer-layout.spec.ts`).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TaskEditPopup } from '../../components/task/TaskEditPopup'
import { TaskEditPopupHost } from '../../components/task/TaskEditPopupHost'
import { db } from '../../data/database'
import { useStatusStore } from '../../stores/status-store'
import { useStatusUpdateStore } from '../../stores/status-update-store'
import { useSubtaskStore } from '../../stores/subtask-store'
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
  // Each fact a region named by its header: its name alone, one class for all six, no icon (board BL).
  const headers = facts.map((f) => f.querySelector('[id]') as HTMLElement)
  for (const [i, fact] of facts.entries()) {
    const header = headers[i]!
    expect(header.querySelector('svg')).toBeNull()
    expect(header.children).toHaveLength(0)
    expect(fact).toHaveAccessibleName(header.textContent ?? '')
  }
  expect(new Set(headers.map((h) => h.className)).size).toBe(1)
  expect(headers.map((h) => h.textContent))
    .toEqual(HEADERS.filter((_, i) => rail.includes(RAIL[i] ?? '')))
  // The writing: Notes and Subtasks in what scrolls, then the dock with Status updates.
  const scroll = writing.querySelector('[data-task-writing-scroll]') as HTMLElement
  const dock = writing.querySelector('[data-task-dock]') as HTMLElement
  expect(follows(scroll, dock)).toBe(true)
  const notes = scroll.querySelector('[data-task-notes]')!
  const subtasks = scroll.querySelector('[data-subtasks]')!
  const updates = dock.querySelector('[data-status-updates]')!
  expect(follows(notes, subtasks)).toBe(true)
  expect(follows(subtasks, updates)).toBe(true)
  expect(dock.children).toHaveLength(1)
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

  it('an empty task: the Notes box with its toolbar and placeholder is there; the Subtasks and Status updates headings show', async () => {
    const dialog = await openStored()
    const writing = dialog.querySelector('[data-task-writing]') as HTMLElement
    const w = within(writing)
    // Notes: no `+ Add notes` line — the label, the toolbar and the editor, its placeholder drawn.
    expect(w.queryByRole('button', { name: 'Add notes' })).toBeNull()
    const notes = writing.querySelector('[data-task-notes]') as HTMLElement
    expect(within(notes).getByText('Notes')).toBeVisible()
    expect(within(notes).getByRole('toolbar', { name: 'Notes formatting' })).toBeInTheDocument()
    expect(notes.querySelector('[data-task-notes-box] .cm-editor')).not.toBeNull()
    expect(notes.querySelector('.cm-placeholder')).toHaveTextContent('Add notes…')
    // Subtasks: its label (no count, no bar) and the add line.
    const subtasks = w.getByRole('region', { name: 'Subtasks' })
    expect(within(subtasks).getByText('Subtasks')).toBeVisible()
    expect(subtasks.querySelector('[data-subtask-count-text]')).toBeNull()
    expect(within(subtasks).getByPlaceholderText('Add subtask')).toBeInTheDocument()
    expect(within(subtasks).queryByRole('list')).toBeNull()
    // Status updates: its label (no count) and the add line — never the add line alone.
    const updates = w.getByRole('region', { name: 'Status updates' })
    const heading = within(updates).getByText('Status updates')
    expect(heading).toBeVisible()
    // The one section label: Notes', Subtasks' and Status updates' alike.
    const label = within(notes).getByText('Notes').className
    expect(heading.classList.contains(label)).toBe(true)
    expect(within(subtasks).getByText('Subtasks').classList.contains(label)).toBe(true)
    expect(updates.querySelector('[data-status-update-count]')).toBeNull()
    expect(within(updates).getByRole('textbox', { name: 'New status update' })).toBeInTheDocument()
  })

  it('a task with notes, subtasks and updates: the editor holds the notes; the counts sit beside the headings', async () => {
    const todo = makeTodo({ id: 8, title: 'With notes', notes: 'Legal wants a rewrite' })
    await db.subtasks.bulkAdd([
      { todoId: 8, title: 'Draft', isCompleted: true, sortOrder: 0, createdAt: new Date() },
      { todoId: 8, title: 'Send', isCompleted: false, sortOrder: 1, createdAt: new Date() },
    ])
    await db.statusUpdates.add({ todoId: 8, date: new Date(2026, 10, 3), text: 'Sent the redlines', createdAt: new Date() })
    await useSubtaskStore.getState().load()
    await useStatusUpdateStore.getState().load()
    const dialog = await openStored(todo)
    const notes = dialog.querySelector('[data-task-notes]') as HTMLElement
    expect(within(notes).getByText('Notes')).toBeInTheDocument()
    expect(notes.querySelector('.cm-content')).toHaveTextContent('Legal wants a rewrite')
    expect(notes.querySelector('.cm-placeholder')).toBeNull()
    await waitFor(() => expect(dialog.querySelector('[data-subtask-count-text]')).toHaveTextContent('1 of 2'))
    await waitFor(() => expect(dialog.querySelector('[data-status-update-count]')).toHaveTextContent('1'))
    // The entries are in the dock, under the heading, over the add line.
    const dock = dialog.querySelector('[data-task-dock]') as HTMLElement
    const list = within(dock).getByRole('list', { name: 'Status updates' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(follows(list, within(dock).getByRole('textbox', { name: 'New status update' }))).toBe(true)
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
