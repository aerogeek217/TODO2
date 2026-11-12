import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { CheckinDialog } from '../../../components/checkin/CheckinDialog'
import { db } from '../../../data/database'
import type { Person, PersistedTodoItem, TodoPredicate } from '../../../models'
import { emptyPredicate } from '../../../models/filter-predicate'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import { DEFAULT_FOLLOWUP_INTERVAL } from '../../../utils/followup'
import { makePerson, makeTodo } from '../../helpers'

const CHECKIN_DUE_SOON_DAYS = 14
/** Due before today or within the next 14 days (a due range open at the start). */
const dueSoonCheckinFilter = (): TodoPredicate => ({
  ...emptyPredicate(),
  dates: { deadline: { match: 'range', start: null, end: { kind: 'offset', days: CHECKIN_DUE_SOON_DAYS } } },
})

// Monday 12 Oct 2026, 10:00.
const NOW = new Date(2026, 9, 12, 10)
const day = (offset: number) => new Date(2026, 9, 12 + offset)

const ada = makePerson({ id: 1, name: 'Ada Lovelace', initials: 'AL' })
const bob = makePerson({ id: 2, name: 'Bob Stone', initials: 'BS' })
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

/** A check-in filter: text "review". */
const REVIEWS: TodoPredicate = {
  showCompleted: false, personIds: null, statusIds: null, searchText: 'review', dates: {}, markers: null, tags: null,
}
const HOT: TodoPredicate = { ...REVIEWS, searchText: '', markers: [{ values: ['focus'] }] }

let events: string[]
let clipboardOk: boolean

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
  useSettingsStore.setState({
    checkinTaskFilter: { ...REVIEWS, searchText: '' }, weekStartsOn: 1,
    urgentDueWithinDays: 0, followupDefaultInterval: DEFAULT_FOLLOWUP_INTERVAL,
  })
  useUIStore.setState({ checkinDialog: null })
  useUndoStore.getState().clear()

  events = []
  clipboardOk = true
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      write: vi.fn(async () => { events.push('clipboard'); if (!clipboardOk) throw new Error('denied') }),
      writeText: vi.fn(async (text: string) => { events.push(`text:${text}`); if (!clipboardOk) throw new Error('denied') }),
    },
  })
  vi.stubGlobal('ClipboardItem', class { constructor(public data: Record<string, Blob>) {} })
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'clipboard')
  vi.unstubAllGlobals()
  vi.useRealTimers()
  useUndoStore.getState().clear()
})

const dialog = () => screen.getByRole('dialog', { name: 'Task check-ins' })
const list = () => within(dialog()).getByRole('listbox', { name: 'People' })
const row = (id: number) => dialog().querySelector<HTMLElement>(`[data-checkin-row="${id}"]`)!
const nameOf = (el: Element) => el.querySelector('[class*="name"]')?.textContent
const count = (id: number) => row(id).querySelector('[data-checkin-count]')!.textContent
const selectedName = () => nameOf(within(list()).getByRole('option', { selected: true }))
const frame = () => dialog().querySelector('iframe')
const copyButton = () => within(dialog()).getByRole('button', { name: 'Copy message' })
const subjectButton = () => within(dialog()).getByRole('button', { name: 'Copy subject' })
const status = () => within(dialog()).getByRole('status').textContent

function open(personIds?: number[]) {
  render(<CheckinDialog />)
  act(() => useUIStore.getState().openCheckinDialog(personIds))
}

/** The last rich clipboard write's two parts. */
async function copiedParts(): Promise<{ html: string; plain: string }> {
  const write = navigator.clipboard.write as unknown as ReturnType<typeof vi.fn>
  const call = write.mock.calls.at(-1) as unknown as [Array<{ data: Record<string, Blob> }>]
  const item = call[0][0]!
  return { html: await item.data['text/html']!.text(), plain: await item.data['text/plain']!.text() }
}

describe('CheckinDialog — people', () => {
  it('lists people with open tasks as one choice; the people it was opened for come first, the first selected', () => {
    open([2, 3])
    expect(within(list()).getAllByRole('option').map(nameOf)).toEqual(['Bob Stone', 'Cy Young', 'Ada Lovelace'])
    expect(selectedName()).toBe('Bob Stone')
    expect(list().getAttribute('aria-activedescendant')).toBe(row(2).id)
    expect(frame()?.getAttribute('title')).toBe('Check-in for Bob Stone')
  })

  it('opened for nobody: the first row is selected', () => {
    open()
    expect(selectedName()).toBe('Ada Lovelace')
  })

  it('a click or ↑ / ↓ / Home / End selects; the message follows', () => {
    open([1])
    fireEvent.click(row(3))
    expect(selectedName()).toBe('Cy Young')
    expect(frame()?.getAttribute('srcdoc')).toContain('Ref 55555555')
    fireEvent.keyDown(list(), { key: 'ArrowUp' })
    expect(selectedName()).toBe('Bob Stone')
    fireEvent.keyDown(list(), { key: 'Home' })
    expect(selectedName()).toBe('Ada Lovelace')
    fireEvent.keyDown(list(), { key: 'ArrowUp' })
    expect(selectedName()).toBe('Ada Lovelace')
    fireEvent.keyDown(list(), { key: 'End' })
    expect(selectedName()).toBe('Cy Young')
    fireEvent.keyDown(list(), { key: 'ArrowDown' })
    expect(selectedName()).toBe('Cy Young')
  })

  it('counts open tasks per person for Which tasks (completed ones never count)', async () => {
    open([1])
    expect([count(1), count(2), count(3)]).toEqual(['3 tasks', '2 tasks', '1 task'])
    await act(() => useSettingsStore.getState().setCheckinTaskFilter(dueSoonCheckinFilter()))
    expect([count(1), count(2), count(3)]).toEqual(['2 tasks', '2 tasks', '0 tasks'])
    await act(() => useSettingsStore.getState().setCheckinTaskFilter(REVIEWS))
    expect([count(1), count(2), count(3)]).toEqual(['1 task', '1 task', '0 tasks'])
  })

  it('nobody with open tasks: says so, and Copy is off', () => {
    usePersonStore.setState({ assignedPeopleMap: new Map() })
    open()
    expect(within(dialog()).getByText('Nobody has open tasks assigned.')).toBeTruthy()
    expect(copyButton()).toHaveProperty('disabled', true)
  })
})

describe('CheckinDialog — the message', () => {
  it('shows the subject and the selected person’s message in a sandboxed frame that fetches nothing', () => {
    open([1])
    expect(within(dialog()).getByTestId('checkin-subject').textContent).toBe('Task check-in: 3 open tasks')
    const f = frame()!
    expect(f.getAttribute('sandbox')).toBe('')
    expect(f.getAttribute('srcdoc')).toContain('Ref 11111111')
    expect(f.getAttribute('srcdoc')).toContain("default-src 'none'")
    expect(f.getAttribute('srcdoc')).toContain('Check-in for Ada Lovelace · sent 2026-10-12')
  })

  it('follows Which tasks and Include', async () => {
    open([1])
    await act(() => useSettingsStore.getState().setCheckinTaskFilter(dueSoonCheckinFilter()))
    let doc = frame()!.getAttribute('srcdoc')!
    expect(doc).toContain('Ref 22222222')
    expect(doc).not.toContain('Ref 33333333')
    expect(doc).toContain('>Notes:</td>')
    expect(doc).toContain('Also assigned')
    expect(within(dialog()).getByTestId('checkin-subject').textContent).toBe('Task check-in: 2 open tasks')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Task notes' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Other people on the task' }))
    doc = frame()!.getAttribute('srcdoc')!
    expect(doc).toContain('>Status:</td>')
    expect(doc).not.toContain('>Notes:</td>')
    expect(doc).not.toContain('Also assigned')
  })

  it('no task matches Which tasks: no frame, the reason in its place, Copy off', async () => {
    open([1])
    await act(() => useSettingsStore.getState().setCheckinTaskFilter(HOT))
    expect(frame()).toBeNull()
    expect(within(dialog()).getByTestId('checkin-no-tasks').textContent).toBe('No open tasks match Which tasks.')
    expect(copyButton()).toHaveProperty('disabled', true)
    expect(subjectButton()).toHaveProperty('disabled', true)
  })

  it('a person it was opened for with no open tasks, no filter: “<name> has no open tasks.”', async () => {
    const dee = makePerson({ id: 4, name: 'Dee Ray', initials: 'DR' })
    usePersonStore.setState({ people: [ada, bob, cy, dee] })
    await act(() => useSettingsStore.getState().setCheckinTaskFilter(emptyPredicate()))
    open([4])
    expect(selectedName()).toBe('Dee Ray')
    expect(within(dialog()).getByTestId('checkin-no-tasks').textContent).toBe('Dee Ray has no open tasks.')
  })
})

describe('CheckinDialog — Copy', () => {
  it('puts rich HTML and plain text on the clipboard; the row shows Copied ✓; the status line says so', async () => {
    open([1, 2])
    await act(async () => { fireEvent.click(copyButton()) })
    expect(events).toEqual(['clipboard'])
    const { html, plain } = await copiedParts()
    expect(html).toContain('Ref 11111111')
    expect(plain).toContain('Ref 11111111')
    expect(plain.split('\n').at(-1)).toBe('Check-in for Ada Lovelace · sent 2026-10-12')
    expect(row(1).textContent).toContain('Copied ✓')
    expect(row(2).textContent).not.toContain('Copied ✓')
    expect(status()).toBe('Copied the check-in for Ada Lovelace. Paste it into your message.')
  })

  it('records no follow-up and no undo entry', async () => {
    open([1])
    await act(async () => { fireEvent.click(copyButton()) })
    expect(useTodoStore.getState().todos.filter((t) => t.lastFollowupAt)).toEqual([])
    expect((await db.todos.toArray()).filter((t) => t.lastFollowupAt)).toEqual([])
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(useUndoStore.getState().snackbar).toBeNull()
  })

  it('Copy subject copies the subject as plain text', async () => {
    open([1])
    await act(async () => { fireEvent.click(subjectButton()) })
    expect(events).toEqual(['text:Task check-in: 3 open tasks'])
    expect(status()).toBe('Copied the subject for Ada Lovelace.')
  })

  it('a refused clipboard: an error line, nothing marked copied', async () => {
    clipboardOk = false
    open([1])
    await act(async () => { fireEvent.click(copyButton()) })
    expect(status()).toBe('Couldn’t copy to the clipboard. Try again.')
    expect(row(1).textContent).not.toContain('Copied ✓')
    await act(async () => { fireEvent.click(subjectButton()) })
    expect(status()).toBe('Couldn’t copy to the clipboard. Try again.')
  })
})

describe('CheckinDialog — Which tasks', () => {
  const filterLine = () => within(dialog()).getByTestId('checkin-filter')

  it('is a filter line: no filter reads “All open tasks”; + Filter offers every field but People', () => {
    open([1])
    expect(filterLine().textContent).toContain('All open tasks')
    expect(within(filterLine()).queryAllByTestId('list-filter-chip')).toHaveLength(0)
    fireEvent.click(within(filterLine()).getByRole('button', { name: 'Filter' }))
    const menu = screen.getByRole('menu', { name: 'Add a filter' })
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent))
      .toEqual(['Priority', 'Tags', 'Dates', 'Status', 'Text contains…'])
  })

  it('its date panel leaves Completed out (a check-in takes open tasks only)', () => {
    open([1])
    fireEvent.click(within(filterLine()).getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dates' }))
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Due', 'Next follow-up', 'Last follow-up', 'Created', 'Modified'])
  })

  it('a filter added from + Filter is saved at once; the counts follow it', async () => {
    open([1, 2])
    expect([count(1), count(2)]).toEqual(['3 tasks', '2 tasks'])
    fireEvent.click(within(filterLine()).getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Priority' }))
    await act(async () => { fireEvent.click(screen.getByRole('option', { name: /Focus/ })) })
    expect(useSettingsStore.getState().checkinTaskFilter.markers).toEqual([{ values: ['focus'] }])
    expect(await db.settings.get('checkinTaskFilter')).toBeTruthy()
    expect([count(1), count(2)]).toEqual(['0 tasks', '0 tasks'])
    expect(within(filterLine()).getAllByTestId('list-filter-chip').map((c) => c.textContent)).toEqual(['PriorityFocus'])
    expect(copyButton()).toHaveProperty('disabled', true)
  })

  it('a chip shows the kept filter; its × clears it (all open tasks, nothing stored)', async () => {
    await useSettingsStore.getState().setCheckinTaskFilter(REVIEWS)
    open([1])
    expect(count(1)).toBe('1 task')
    const chip = within(filterLine()).getByTestId('list-filter-chip')
    expect(chip.textContent).toContain('review')
    await act(async () => { fireEvent.click(within(chip).getByRole('button', { name: 'Remove filter' })) })
    expect(useSettingsStore.getState().checkinTaskFilter).toEqual(emptyPredicate())
    expect(await db.settings.get('checkinTaskFilter')).toBeUndefined()
    expect(count(1)).toBe('3 tasks')
    expect(filterLine().textContent).toContain('All open tasks')
  })

  it('Esc in a filter picker closes the picker only, not the dialog', () => {
    open([1])
    fireEvent.click(within(filterLine()).getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Priority' }))
    const focus = screen.getByRole('option', { name: /Focus/ })
    fireEvent.keyDown(focus, { key: 'Escape' })
    expect(screen.queryByRole('option', { name: /Focus/ })).toBeNull()
    expect(dialog()).toBeTruthy()
  })
})

describe('CheckinDialog — closing', () => {
  it('has no mail parts: no address, no open method, no preview dialog', () => {
    open([1])
    expect(dialog().textContent).not.toMatch(/@example|mail app|\.eml|Preview email|How to open/)
    expect(within(dialog()).queryByRole('radio', { name: /Open in mail app|Download draft/ })).toBeNull()
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
