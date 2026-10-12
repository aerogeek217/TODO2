import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CheckinDialog } from '../../../components/overlays/CheckinDialog'
import { db } from '../../../data/database'
import type { Person, PersistedTodoItem, TodoPredicate } from '../../../models'
import type { PersistedListDefinition } from '../../../models/list-definition'
import { createCommands, type CommandContext } from '../../../services/command-registry'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import { DEFAULT_FOLLOWUP_INTERVAL } from '../../../utils/followup'
import { DEFAULT_HOT_RULE } from '../../../utils/hot'
import { makePerson, makeTodo } from '../../helpers'

// Monday 12 Oct 2026, 10:00.
const NOW = new Date(2026, 9, 12, 10)
const day = (offset: number) => new Date(2026, 9, 12 + offset)

const ada = makePerson({ id: 1, name: 'Ada Lovelace', initials: 'AL', email: 'ada@example.com' })
const bob = makePerson({ id: 2, name: 'Bob Stone', initials: 'BS', email: 'bob@example.com' })
const cy = makePerson({ id: 3, name: 'Cy Young', initials: 'CY' })

const TODOS: PersistedTodoItem[] = [
  makeTodo({ id: 1, uid: '11111111-0000-4000-8000-000000000001', title: 'Overdue report', dueDate: day(-2) }),
  makeTodo({ id: 2, uid: '22222222-0000-4000-8000-000000000002', title: 'Next week review', dueDate: day(5) }),
  makeTodo({ id: 3, uid: '33333333-0000-4000-8000-000000000003', title: 'Someday idea' }),
  makeTodo({ id: 4, uid: '44444444-0000-4000-8000-000000000004', title: 'Bob thing', dueDate: day(1) }),
  makeTodo({ id: 5, uid: '55555555-0000-4000-8000-000000000005', title: 'Cy thing' }),
  makeTodo({ id: 6, uid: '66666666-0000-4000-8000-000000000006', title: 'Done already', isCompleted: true }),
]
const ASSIGNED = new Map<number, Person[]>([[1, [ada]], [2, [ada, bob]], [3, [ada]], [4, [bob]], [5, [cy]], [6, [ada]]])

const predicate: TodoPredicate = {
  showCompleted: false, personIds: null, statusIds: null, searchText: 'review', dateField: 'deadline',
  dateRangeStart: null, dateRangeEnd: null, dateRangeIncludeNoDate: false, hasDeadline: null,
  hasFollowup: null, markers: null, tags: null,
}
const REVIEWS: PersistedListDefinition = {
  id: 7, name: 'Reviews', sortOrder: 1, sort: 'title', grouping: 'none', pinnedToDashboard: false,
  membership: { kind: 'custom', predicate },
}

let events: string[]
let clicked: HTMLAnchorElement[]
let clipboardOk: boolean
let objectUrl: PropertyDescriptor | undefined

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  await db.delete()
  await db.open()
  await db.people.bulkAdd([ada, bob, cy])
  await db.todos.bulkAdd(TODOS)
  useTodoStore.setState({ todos: TODOS })
  usePersonStore.setState({ people: [ada, bob, cy], assignedPeopleMap: ASSIGNED })
  useTagStore.setState({ tags: [], assignedTagsMap: new Map() })
  useStatusStore.setState({ statuses: [] })
  useListDefinitionStore.setState({ listDefinitions: [REVIEWS] })
  useSettingsStore.setState({
    checkinOpenMethod: 'mailto', checkinTaskScope: { kind: 'all' }, weekStartsOn: 1,
    urgentDueWithinDays: 0, hotRule: DEFAULT_HOT_RULE, followupDefaultInterval: DEFAULT_FOLLOWUP_INTERVAL,
  })
  useUIStore.setState({ checkinDialog: null })
  useUndoStore.getState().clear()

  events = []
  clicked = []
  clipboardOk = true
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      write: vi.fn(async () => { events.push('clipboard'); if (!clipboardOk) throw new Error('denied') }),
      writeText: vi.fn(async () => { events.push('clipboard'); if (!clipboardOk) throw new Error('denied') }),
    },
  })
  vi.stubGlobal('ClipboardItem', class { constructor(public data: Record<string, Blob>) {} })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    events.push(this.download ? 'download' : 'anchor')
    clicked.push(this)
  })
  objectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: () => 'blob:checkin' })
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'clipboard')
  if (objectUrl) Object.defineProperty(URL, 'createObjectURL', objectUrl)
  else Reflect.deleteProperty(URL, 'createObjectURL')
  vi.useRealTimers()
  useUndoStore.getState().clear()
})

const dialog = () => screen.getByRole('dialog', { name: 'Email task check-ins' })
const row = (id: number) => dialog().querySelector<HTMLElement>(`[data-checkin-row="${id}"]`)!
const count = (id: number) => row(id).querySelector('[data-checkin-count]')!.textContent

function open(personIds?: number[]) {
  render(<CheckinDialog />)
  act(() => useUIStore.getState().openCheckinDialog(personIds))
}

describe('CheckinDialog — rows', () => {
  it('lists people with open tasks; the people it was opened for come first, ticked', () => {
    open([2])
    const names = Array.from(dialog().querySelectorAll('[data-checkin-row]')).map((r) => r.querySelector('label')?.textContent)
    expect(names).toEqual(['Bob Stonebob@example.com', 'Ada Lovelaceada@example.com', 'Cy YoungNo email address'])
    expect(within(row(2)).getByRole('checkbox')).toHaveProperty('checked', true)
    expect(within(row(1)).getByRole('checkbox')).toHaveProperty('checked', false)
    // Only a ticked row has a send button.
    expect(within(row(2)).getByRole('button', { name: 'Copy & open for Bob Stone' })).toBeTruthy()
    expect(within(row(1)).queryByRole('button', { name: /Copy & open/ })).toBeNull()
  })

  it('from the general command nobody is ticked and Preview is off', () => {
    open()
    for (const id of [1, 2, 3]) expect(within(row(id)).getByRole('checkbox')).toHaveProperty('checked', false)
    expect(screen.getByRole('button', { name: 'Preview email' })).toHaveProperty('disabled', true)
  })

  it('a person without an email: checkbox disabled, Add email instead of send, even when opened for them', () => {
    open([3])
    const box = within(row(3)).getByRole('checkbox')
    expect(box).toHaveProperty('disabled', true)
    expect(box).toHaveProperty('checked', false)
    expect(within(row(3)).getByText('No email address')).toBeTruthy()
    expect(within(row(3)).getByRole('button', { name: 'Add email for Cy Young' })).toBeTruthy()
    expect(within(row(3)).queryByRole('button', { name: /Copy & open/ })).toBeNull()
  })

  it('counts open tasks per person for the Which tasks choice (completed ones never count)', async () => {
    open([1])
    expect([count(1), count(2), count(3)]).toEqual(['3 tasks', '2 tasks', '1 task'])
    await act(() => useSettingsStore.getState().setCheckinTaskScope({ kind: 'due-soon' }))
    expect([count(1), count(2), count(3)]).toEqual(['2 tasks', '2 tasks', '0 tasks'])
    await act(() => useSettingsStore.getState().setCheckinTaskScope({ kind: 'list', listDefinitionId: 7 }))
    expect([count(1), count(2), count(3)]).toEqual(['1 task', '1 task', '0 tasks'])
  })

  it('a ticked person with nothing to send for the choice cannot be sent', async () => {
    open([1])
    await act(() => useSettingsStore.getState().setCheckinTaskScope({ kind: 'hot' }))
    expect(within(row(1)).getByRole('button', { name: 'Copy & open for Ada Lovelace' })).toHaveProperty('disabled', true)
  })
})

describe('CheckinDialog — Which tasks', () => {
  it('menu: quick picks and saved lists with counts for the ticked people; picking one saves it', async () => {
    open([1, 2])
    fireEvent.click(screen.getByRole('button', { name: /Which tasks/ }))
    const menu = screen.getByRole('menu', { name: 'Which tasks' })
    const items = within(menu).getAllByRole('menuitemradio').map((i) => i.textContent)
    // Ada + Bob: all = 3 + 2, due soon = 2 + 2, hot = 0, Reviews = 1 + 1.
    expect(items).toEqual(['All open tasks5 tasks', 'Overdue + next 2 weeks4 tasks', 'Hot0 tasks', 'Reviews2 tasks'])
    expect(within(menu).getByRole('menuitemradio', { name: /All open tasks/ }).getAttribute('aria-checked')).toBe('true')
    await act(async () => { fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Overdue/ })) })
    expect(useSettingsStore.getState().checkinTaskScope).toEqual({ kind: 'due-soon' })
    expect(screen.queryByRole('menu', { name: 'Which tasks' })).toBeNull()
    expect(screen.getByRole('button', { name: /Which tasks/ }).textContent).toContain('Overdue + next 2 weeks')
  })

  it('a saved list that was deleted shows as All open tasks', () => {
    useSettingsStore.setState({ checkinTaskScope: { kind: 'list', listDefinitionId: 99 } })
    open([1])
    expect(screen.getByRole('button', { name: /Which tasks/ }).textContent).toContain('All open tasks')
    expect(count(1)).toBe('3 tasks')
  })

  it('How to open it writes the setting and relabels the send buttons', async () => {
    open([1])
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /Download draft/ })) })
    expect(useSettingsStore.getState().checkinOpenMethod).toBe('eml')
    expect(within(row(1)).getByRole('button', { name: 'Download .eml for Ada Lovelace' })).toBeTruthy()
  })
})

describe('CheckinDialog — sending', () => {
  it('Copy & open: clipboard first, then the mailto: link; records one follow-up; row shows Opened', async () => {
    open([1])
    await act(async () => { fireEvent.click(within(row(1)).getByRole('button', { name: 'Copy & open for Ada Lovelace' })) })
    expect(events).toEqual(['clipboard', 'anchor'])
    expect(clicked[0]!.getAttribute('href')).toBe('mailto:ada@example.com?subject=Task%20check-in%3A%203%20open%20tasks')
    expect(within(row(1)).getByText('Opened ✓')).toBeTruthy()
    expect(screen.getByRole('status').textContent)
      .toBe('Opened a message to Ada Lovelace. The body is on your clipboard: paste it with Ctrl+V.')

    // Sending counts as a follow-up on the email's tasks only — one undo entry.
    await waitFor(() => expect(useTodoStore.getState().todos.find((t) => t.id === 1)?.lastFollowupAt).toEqual(NOW))
    const followed = useTodoStore.getState().todos.filter((t) => t.lastFollowupAt).map((t) => t.id)
    expect(followed).toEqual([1, 2, 3])
    expect((await db.todos.get(3))?.lastFollowupAt).toEqual(NOW)
    expect(useUndoStore.getState().undoStack).toHaveLength(1)

    await act(() => useUndoStore.getState().undo())
    expect(useTodoStore.getState().todos.filter((t) => t.lastFollowupAt)).toEqual([])
    expect((await db.todos.get(3))?.lastFollowupAt).toBeUndefined()
  })

  it('the email holds the scope’s tasks and the ticked options', async () => {
    const write = navigator.clipboard.write as unknown as ReturnType<typeof vi.fn>
    open([1])
    await act(() => useSettingsStore.getState().setCheckinTaskScope({ kind: 'due-soon' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Task notes' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Other people on the task' }))
    await act(async () => { fireEvent.click(within(row(1)).getByRole('button', { name: /Copy & open/ })) })
    const [[items]] = write.mock.calls as unknown as [[Array<{ data: Record<string, Blob> }>]]
    const html = await items[0]!.data['text/html']!.text()
    expect(html).toContain('Ref 11111111')
    expect(html).toContain('Ref 22222222')
    expect(html).not.toContain('Ref 33333333')
    expect(html).toContain('>Progress:</td>')
    expect(html).not.toContain('>Notes:</td>')
    expect(html).not.toContain('Also assigned')
    expect(clicked[0]!.getAttribute('href')).toContain('subject=Task%20check-in%3A%202%20open%20tasks')
  })

  it('clipboard refused: nothing opened, no follow-up, an error line', async () => {
    clipboardOk = false
    open([1])
    await act(async () => { fireEvent.click(within(row(1)).getByRole('button', { name: /Copy & open/ })) })
    expect(events).not.toContain('anchor')
    expect(screen.getByRole('status').textContent).toMatch(/Couldn’t copy the email/)
    expect(within(row(1)).getByRole('button', { name: /Copy & open/ })).toBeTruthy()
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('Download .eml: a draft download, no clipboard; row shows Downloaded; focus moves to the next row', async () => {
    useSettingsStore.setState({ checkinOpenMethod: 'eml' })
    open([1, 2])
    await act(async () => { fireEvent.click(within(row(1)).getByRole('button', { name: 'Download .eml for Ada Lovelace' })) })
    expect(events).toEqual(['download'])
    expect(clicked[0]!.download).toBe('Check-in - Ada Lovelace - 2026-10-12.eml')
    expect(within(row(1)).getByText('Downloaded ✓')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Downloaded the draft for Ada Lovelace. Open the .eml file to review and send.')
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Download .eml for Bob Stone'))
  })
})

describe('CheckinDialog — layers and closing', () => {
  it('Add email opens the people editor on that person with the Email field focused, and ticks them', async () => {
    open()
    await act(async () => { fireEvent.click(within(row(3)).getByRole('button', { name: 'Add email for Cy Young' })) })
    const email = await screen.findByRole('textbox', { name: 'Email' })
    expect(document.activeElement).toBe(email)
    expect((screen.getByPlaceholderText('Name') as HTMLInputElement).value).toBe('Cy Young')
    fireEvent.change(email, { target: { value: 'cy@example.com' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    await waitFor(() => expect(within(row(3)).getByRole('checkbox')).toHaveProperty('checked', true))
    expect(within(row(3)).getByRole('button', { name: 'Copy & open for Cy Young' })).toBeTruthy()
    // Esc belongs to the editor while it's open.
    fireEvent.keyDown(dialog(), { key: 'Escape' })
    expect(useUIStore.getState().checkinDialog).not.toBeNull()
  })

  it('Preview email renders the ticked person’s email in a sandboxed frame', () => {
    open([1])
    fireEvent.click(screen.getByRole('button', { name: 'Preview email' }))
    const frame = screen.getByTitle('Check-in email for Ada Lovelace') as HTMLIFrameElement
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.getAttribute('srcdoc')).toContain('Ref 11111111')
    expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'")
    expect(screen.getByText('Task check-in: 3 open tasks')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTitle('Check-in email for Ada Lovelace')).toBeNull()
    expect(useUIStore.getState().checkinDialog).not.toBeNull()
  })

  it('Esc, Done and the × close it', () => {
    open([1])
    fireEvent.keyDown(dialog(), { key: 'Escape' })
    expect(useUIStore.getState().checkinDialog).toBeNull()
    act(() => useUIStore.getState().openCheckinDialog())
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(useUIStore.getState().checkinDialog).toBeNull()
    act(() => useUIStore.getState().openCheckinDialog())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(useUIStore.getState().checkinDialog).toBeNull()
  })
})

describe('Email task check-ins command', () => {
  it('opens the dialog with nobody ticked', () => {
    const openCheckinDialog = vi.fn()
    const ctx = { openCheckinDialog, getStatuses: () => [], selectionCount: 0 } as unknown as CommandContext
    const cmd = createCommands(ctx).find((c) => c.id === 'email-checkins')
    expect(cmd).toMatchObject({ name: 'Email task check-ins…', category: 'email' })
    cmd!.action()
    expect(openCheckinDialog).toHaveBeenCalledWith()
  })
})
