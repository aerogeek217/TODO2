// The one task layout (task layout B, feedback 2026-11-15) in the task
// editor: the header (box, title, Created · Modified, ⋯, ×), then the body —
// the fact band (Priority, Status, People, Tags, Due, each under its header:
// the standard section label, no icon), then the writing (Subtasks, then
// Notes) beside Status updates (the log, the add line) —, then the footer
// (the follow-up fields, Last then Next and its quick intervals; Mark
// followed up and Done; Duplicate, Make subtask of… and Delete are the ⋯'s).
// The Notes box and every heading are there while empty. Edit and create
// mode; a draft has no Last field. Sizes, scrolling and the narrow stacking
// are the real browser's (`e2e/task-layout-b.spec.ts`,
// `e2e/task-layout.spec.ts`, `e2e/reviewer-layout.spec.ts`).
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

const FACTS = ['priority', 'status', 'people', 'tags', 'due']
const HEADERS = ['Priority', 'Status', 'People', 'Tags', 'Due']

function expectLayout(root: HTMLElement, facts = FACTS) {
  const band = root.querySelector('[data-task-facts]') as HTMLElement
  const writing = root.querySelector('[data-task-writing]') as HTMLElement
  const updatesCol = root.querySelector('[data-task-updates]') as HTMLElement
  expect(band).not.toBeNull()
  expect(writing).not.toBeNull()
  expect(updatesCol).not.toBeNull()
  // The band first (in the reading and focus order), then the writing, then Status updates.
  expect(follows(band, writing)).toBe(true)
  expect(follows(writing, updatesCol)).toBe(true)
  const cells = Array.from(band.querySelectorAll('[data-fact]'))
  expect(cells.map((f) => f.getAttribute('data-fact'))).toEqual(facts)
  // Each fact a region named by its header: its name alone, one class for all five, no icon.
  const headers = cells.map((f) => f.querySelector('[id]') as HTMLElement)
  for (const [i, fact] of cells.entries()) {
    const header = headers[i]!
    expect(header.querySelector('svg')).toBeNull()
    expect(header.children).toHaveLength(0)
    expect(fact).toHaveAccessibleName(header.textContent ?? '')
  }
  expect(new Set(headers.map((h) => h.className)).size).toBe(1)
  expect(headers.map((h) => h.textContent))
    .toEqual(HEADERS.filter((_, i) => facts.includes(FACTS[i] ?? '')))
  // The writing: Subtasks, then Notes; Status updates in its own column.
  const subtasks = writing.querySelector('[data-subtasks]')!
  const notes = writing.querySelector('[data-task-notes]')!
  expect(follows(subtasks, notes)).toBe(true)
  expect(updatesCol.querySelector('[data-status-updates]')).not.toBeNull()
  // The follow-up fields are the footer's, not the body's (task layout B): Last, then Next.
  const body = root.querySelector('[data-task-body]') as HTMLElement
  expect(body.querySelector('[data-task-followup], input[aria-label$="follow-up"]')).toBeNull()
  expect(band.querySelector('input[aria-label$="follow-up"]')).toBeNull()
  const footer = root.querySelector('[data-task-footer]') as HTMLElement
  const followup = footer.querySelector('[data-task-followup]') as HTMLElement
  expect(followup).not.toBeNull()
  // No facts rail, dock or follow-up rows any more.
  expect(root.querySelector('[data-task-rail], [data-task-dock], [data-followup-row], [data-task-fields], [data-task-pair]')).toBeNull()
  return { band, writing, followup, footer }
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
  it('edit mode: the fact band in its order over the two columns; the footer’s Last, Next, Mark followed up and Done', async () => {
    useStatusStore.setState({ statuses: [{ id: 1, name: 'Waiting', color: '#f5c842', sortOrder: 0 }] })
    const dialog = await openStored()
    const { followup, footer } = expectLayout(dialog)
    const f = within(followup)
    // Two fields, Last then Next, each a label and a field (task layout B).
    expect(Array.from(followup.querySelectorAll('[data-followup-field]')).map((r) => r.getAttribute('data-followup-field'))).toEqual(['last', 'next'])
    expect(follows(f.getByRole('textbox', { name: 'Last follow-up' }), f.getByRole('textbox', { name: 'Next follow-up' }))).toBe(true)
    expect(f.queryByRole('button', { name: 'Mark followed up' })).toBeNull()
    // The quick intervals (Settings' defaults: 1d 1w 1m 3m), after Next.
    expect(within(f.getByRole('group', { name: 'Quick follow-up intervals' })).getAllByRole('button').map((b) => b.textContent))
      .toEqual(['1d', '1w', '1m', '3m'])
    // The footer: the fields, Mark followed up, then Done; Created · Modified in the header.
    const done = within(footer).getByRole('button', { name: 'Done' })
    const mark = within(footer).getByRole('button', { name: 'Mark followed up' })
    expect(follows(followup, mark)).toBe(true)
    expect(follows(mark, done)).toBe(true)
    expect(dialog.querySelector('[data-task-meta]')).toHaveTextContent(/^Created .* · Modified /)
  })

  it('the footer’s Mark followed up records a follow-up on the task', async () => {
    const markFollowedUp = vi.spyOn(useTodoStore.getState(), 'markFollowedUp').mockResolvedValue(undefined)
    const dialog = await openStored()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark followed up' }))
    expect(markFollowedUp).toHaveBeenCalledWith([7])
  })

  it('without statuses the band has no Status', async () => {
    useStatusStore.setState({ statuses: [] })
    const dialog = await openStored()
    expectLayout(dialog, FACTS.filter((f) => f !== 'status'))
  })

  it('People and Tags: a + after the pills, always there, opening the picker', async () => {
    const dialog = await openStored()
    for (const [fact, name, placeholder] of [['people', 'Add person', 'Search or create people…'], ['tags', 'Add tag', 'Search tags...']] as const) {
      const cell = dialog.querySelector(`[data-fact="${fact}"]`) as HTMLElement
      const add = within(cell).getByRole('button', { name })
      // Just the +: no `Add` words beside it.
      expect(add.textContent).toBe('')
      fireEvent.click(add)
      expect(screen.getByPlaceholderText(placeholder)).toBeInTheDocument()
      fireEvent.click(add)
    }
  })

  it('an empty task: the Notes box with its toolbar and placeholder is there; the Subtasks and Status updates headings show', async () => {
    const dialog = await openStored()
    const writing = dialog.querySelector('[data-task-writing]') as HTMLElement
    const w = within(writing)
    const u = within(dialog.querySelector('[data-task-updates]') as HTMLElement)
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
    const updates = u.getByRole('region', { name: 'Status updates' })
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
    // The entries are in the right-hand column, under the heading, over the add line.
    const column = dialog.querySelector('[data-task-updates]') as HTMLElement
    const list = within(column).getByRole('list', { name: 'Status updates' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(follows(list, within(column).getByRole('textbox', { name: 'New status update' }))).toBe(true)
  })

  it('the header’s ⋯ holds Duplicate, Make subtask of… and Delete; the footer is the dates, Mark followed up and Done', async () => {
    const dialog = await openStored()
    const footerButtons = Array.from(dialog.querySelectorAll('button')).filter((b) => ['Duplicate', 'Delete', 'Make subtask of…'].includes(b.textContent ?? ''))
    expect(footerButtons).toEqual([])
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(dialog.querySelector('[data-task-meta]')?.textContent).toMatch(/Created .* · Modified /)
    fireEvent.click(within(dialog).getByRole('button', { name: 'More actions' }))
    const menu = screen.getByRole('menu', { name: 'Task actions' })
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Duplicate', 'Make subtask of…', 'Delete'])
    // Make subtask of… opens the task picker for this task.
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Make subtask of…' }))
    await act(async () => { await Promise.resolve() })
    expect(useUIStore.getState().taskPicker).toMatchObject({ kind: 'make-subtask', todoId: 7 })
  })

  it('create mode: the same layout, no ⋯, no Mark followed up; Last and Next before Cancel; a draft has no Last field', () => {
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
    const { followup: createFollowup, footer } = expectLayout(dialog, FACTS.filter((f) => f !== 'status'))
    expect(within(createFollowup).getByRole('textbox', { name: 'Last follow-up' })).toBeInTheDocument()
    expect(follows(createFollowup, within(footer).getByRole('button', { name: 'Cancel' }))).toBe(true)
    expect(within(dialog).queryByRole('button', { name: 'Mark followed up' })).toBeNull()
    expect(dialog.querySelector('[data-task-meta]')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'More actions' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Create task' })).toBeInTheDocument()
    cleanup()

    render(<TaskEditPopup {...base} onSaveDraft={vi.fn()} />)
    const { followup } = expectLayout(screen.getByRole('dialog', { name: 'New task' }), FACTS.filter((f) => f !== 'status'))
    expect(within(followup).queryByRole('textbox', { name: 'Last follow-up' })).toBeNull()
    expect(within(followup).queryByRole('button', { name: 'Mark followed up' })).toBeNull()
  })
})
