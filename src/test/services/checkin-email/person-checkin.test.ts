import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../../data/database'
import type { Person, PersistedTodoItem, TodoPredicate } from '../../../models'
import {
  ASSIGNMENTS_LOADING_NOTICE,
  CHECKIN_INCLUDE_DEFAULTS,
  checkinSentMessage,
  checkinSentStatus,
  COPY_FAILED_NOTICE,
  noTasksNotice,
  sendPersonCheckin,
} from '../../../services/checkin-email/person-checkin'
import { emptyFilterClauses, emptyPredicate } from '../../../models/filter-predicate'
import { usePersonStore } from '../../../stores/person-store'
import { autoNextFollowup, useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import { DEFAULT_FOLLOWUP_INTERVAL } from '../../../utils/followup'
import { DEFAULT_HOT_RULE } from '../../../utils/hot'
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

const ada = makePerson({ id: 1, name: 'Ada Lovelace', initials: 'AL', email: 'ada@example.com' })
const bob = makePerson({ id: 2, name: 'Bob Stone', initials: 'BS', email: 'bob@example.com' })
const cy = makePerson({ id: 3, name: 'Cy Young', initials: 'CY' })

const TODOS: PersistedTodoItem[] = [
  makeTodo({ id: 1, uid: '11111111-0000-4000-8000-000000000001', title: 'Overdue report', dueDate: day(-2), notes: 'Ada note' }),
  makeTodo({ id: 2, uid: '22222222-0000-4000-8000-000000000002', title: 'Shared review', dueDate: day(5) }),
  makeTodo({ id: 3, uid: '33333333-0000-4000-8000-000000000003', title: 'Cy thing' }),
  makeTodo({ id: 4, uid: '44444444-0000-4000-8000-000000000004', title: 'Done already', isCompleted: true }),
]
const ASSIGNED = new Map<number, Person[]>([[1, [ada]], [2, [ada, bob]], [3, [cy]], [4, [bob]]])

let events: string[]
let clicked: HTMLAnchorElement[]
let blobs: Blob[]
let clipboardOk: boolean
let write: ReturnType<typeof vi.fn>
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
  useSettingsStore.setState({
    checkinOpenMethod: 'mailto', checkinTaskFilter: emptyPredicate(), weekStartsOn: 1,
    urgentDueWithinDays: 0, hotRule: DEFAULT_HOT_RULE, followupDefaultInterval: DEFAULT_FOLLOWUP_INTERVAL,
  })
  useUIStore.setState({ checkinDialog: null })
  useUndoStore.getState().clear()

  events = []
  clicked = []
  blobs = []
  clipboardOk = true
  write = vi.fn(async () => { events.push('clipboard'); if (!clipboardOk) throw new Error('denied') })
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { write, writeText: vi.fn(async () => { events.push('clipboard'); if (!clipboardOk) throw new Error('denied') }) },
  })
  vi.stubGlobal('ClipboardItem', class { constructor(public data: Record<string, Blob>) {} })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    events.push(this.download ? 'download' : 'anchor')
    clicked.push(this)
  })
  objectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true, writable: true, value: (b: Blob) => { blobs.push(b); return 'blob:checkin' },
  })
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
  if (objectUrl) Object.defineProperty(URL, 'createObjectURL', objectUrl)
  else Reflect.deleteProperty(URL, 'createObjectURL')
  vi.useRealTimers()
  useUndoStore.getState().clear()
})

const followedUp = () => useTodoStore.getState().todos.filter((t) => t.lastFollowupAt).map((t) => t.id)
const clipboardHtml = async () => {
  const [[items]] = write.mock.calls as unknown as [[Array<{ data: Record<string, Blob> }>]]
  return items[0]!.data['text/html']!.text()
}

describe('sendPersonCheckin', () => {
  it('sends at once: clipboard, then mailto:, the follow-up as one undo entry named for the send', async () => {
    expect(await sendPersonCheckin(1)).toBe('opened')
    expect(events).toEqual(['clipboard', 'anchor'])
    expect(clicked[0]!.getAttribute('href')).toBe('mailto:ada@example.com?subject=Task%20check-in%3A%202%20open%20tasks')
    expect(useUIStore.getState().checkinDialog).toBeNull()
    await vi.waitFor(() => expect(useUndoStore.getState().undoStack).toHaveLength(1))
    expect(followedUp()).toEqual([1, 2])
    // The second line: where it went (the address) and how to finish — the dialog's own words.
    expect(useUndoStore.getState().snackbar).toEqual({
      description: 'Check-in for Ada Lovelace opened · 2 tasks followed up',
      detail: 'Opened a message to Ada Lovelace <ada@example.com>. The body is on your clipboard: paste it with Ctrl+V.',
    })
    expect(useUndoStore.getState().snackbar?.detail).toBe(checkinSentStatus('Ada Lovelace', 'ada@example.com', 'opened', NOW))

    await useUndoStore.getState().undo()
    expect(followedUp()).toEqual([])
    expect((await db.todos.get(1))?.lastFollowupAt).toBeUndefined()
  })

  it('the follow-up a send records uses Mark followed up’s rule: today + the interval, or cleared while the automatic next follow-up is off', async () => {
    await sendPersonCheckin(1)
    await vi.waitFor(() => expect(followedUp()).toEqual([1, 2]))
    const nextOf = (id: number) => useTodoStore.getState().todos.find((t) => t.id === id)?.nextFollowupAt
    expect(nextOf(1)).toEqual(autoNextFollowup(NOW))
    expect(nextOf(1)).not.toBeNull()
    await useUndoStore.getState().undo()

    useSettingsStore.setState({ autoFollowup: false })
    await sendPersonCheckin(1)
    await vi.waitFor(() => expect(followedUp()).toEqual([1, 2]))
    expect(nextOf(1)).toBeUndefined()
    expect(nextOf(2)).toBeUndefined()
    expect((await db.todos.get(1))?.nextFollowupAt).toBeUndefined()
  })

  it('starts the clipboard write synchronously, inside the click', () => {
    void sendPersonCheckin(1)
    expect(events).toEqual(['clipboard'])
  })

  it('uses the include defaults: notes and the other people on the task', async () => {
    expect(CHECKIN_INCLUDE_DEFAULTS).toEqual({ includeNotes: true, includeOthers: true })
    await sendPersonCheckin(1)
    const html = await clipboardHtml()
    expect(html).toContain('>Notes:</td>')
    expect(html).toContain('Ada note')
    expect(html).toContain('Also assigned')
  })

  it('uses the saved check-in filter', async () => {
    useSettingsStore.setState({ checkinTaskFilter: dueSoonCheckinFilter() })
    expect(await sendPersonCheckin(1)).toBe('opened')
    expect(clicked[0]!.getAttribute('href')).toContain('subject=Task%20check-in%3A%202%20open%20tasks')
    await vi.waitFor(() => expect(followedUp()).toEqual([1, 2]))
  })

  it('.eml: downloads the draft; the notice says downloaded', async () => {
    useSettingsStore.setState({ checkinOpenMethod: 'eml' })
    expect(await sendPersonCheckin(2)).toBe('downloaded')
    expect(events).toEqual(['download'])
    expect(clicked[0]!.download).toBe('Check-in - Bob Stone - 2026-10-12.eml')
    expect(await blobs[0]!.text()).toContain('To: "Bob Stone" <bob@example.com>\r\n')
    await vi.waitFor(() => expect(useUndoStore.getState().snackbar).toEqual({
      description: 'Check-in for Bob Stone downloaded · 1 task followed up',
      detail: 'Downloaded the draft for Bob Stone <bob@example.com> (Check-in - Bob Stone - 2026-10-12.eml) — open it from your Downloads folder to review and send.',
    }))
  })

  it('no address: mailto: with an empty To, an .eml with no To header', async () => {
    expect(await sendPersonCheckin(3)).toBe('opened')
    expect(clicked[0]!.getAttribute('href')).toBe('mailto:?subject=Task%20check-in%3A%201%20open%20task')
    await vi.waitFor(() => expect(useUndoStore.getState().snackbar?.detail)
      .toBe('Opened a message to Cy Young. The body is on your clipboard: paste it with Ctrl+V. Add the recipient in your mail app.'))
    useSettingsStore.setState({ checkinOpenMethod: 'eml' })
    expect(await sendPersonCheckin(3)).toBe('downloaded')
    const eml = await blobs[0]!.text()
    expect(eml).not.toMatch(/^To:/im)
    expect(eml).toMatch(/^X-Unsent: 1\r\n/)
  })

  it('no open tasks match the filter: opens the dialog for the person with the reason; nothing copied or recorded', async () => {
    useSettingsStore.setState({ checkinTaskFilter: { ...emptyPredicate(), markers: 'hot' } })
    expect(await sendPersonCheckin(1)).toBe('dialog')
    expect(events).toEqual([])
    expect(useUIStore.getState().checkinDialog).toEqual({ personIds: [1], notice: noTasksNotice('Ada Lovelace', true) })
    expect(noTasksNotice('Ada Lovelace', true))
      .toBe('Ada Lovelace has no open tasks that match the check-in filter, so nothing was sent. Change the filter under Which tasks.')
    expect(noTasksNotice('Ada Lovelace', false)).toBe('Ada Lovelace has no open tasks, so nothing was sent.')
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('clipboard refused: nothing opened or recorded; the dialog opens with the reason', async () => {
    clipboardOk = false
    expect(await sendPersonCheckin(1)).toBe('dialog')
    expect(events).not.toContain('anchor')
    expect(useUIStore.getState().checkinDialog).toEqual({ personIds: [1], notice: COPY_FAILED_NOTICE })
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('an unknown person: the dialog, no notice', async () => {
    expect(await sendPersonCheckin(99)).toBe('dialog')
    expect(useUIStore.getState().checkinDialog).toEqual({ personIds: [99] })
  })

  it('a follow-up that can’t be written after the send: a notice says so (no unhandled rejection)', async () => {
    useTodoStore.setState({ markFollowedUp: () => Promise.reject(new Error('disk full')) })
    expect(await sendPersonCheckin(1)).toBe('opened')
    await vi.waitFor(() => expect(useUndoStore.getState().snackbar)
      .toEqual({ description: 'Check-in for Ada Lovelace opened, but the follow-up couldn’t be recorded.', notice: true }))
  })

  it('a second click while the first send runs sends nothing', async () => {
    const first = sendPersonCheckin(1)
    expect(await sendPersonCheckin(1)).toBe('busy')
    expect(await first).toBe('opened')
    expect(events).toEqual(['clipboard', 'anchor'])
    // Once it is done, the next click sends again.
    expect(await sendPersonCheckin(1)).toBe('opened')
  })
})

describe('sendPersonCheckin before the tasks’ people and tags are loaded', () => {
  const home = { id: 7, name: 'home', color: '#888888' }
  // "Tags is not #home": Ada's report (no tags) is in, the shared review (#home) is not.
  beforeEach(() => {
    useSettingsStore.setState({ checkinTaskFilter: { ...emptyPredicate(), tags: [7], negate: { tags: true } } })
  })

  it('a filter on tags sends once every open task’s tags are loaded', async () => {
    useTagStore.setState({ tags: [home], assignedTagsMap: new Map([[1, []], [2, [home]], [3, []], [4, []]]) })
    expect(await sendPersonCheckin(1)).toBe('opened')
    expect(clicked[0]!.getAttribute('href')).toContain('subject=Task%20check-in%3A%201%20open%20task')
  })

  it('a filter on tags with tags not loaded opens the dialog instead: an "is not" tag clause would let #home tasks in', async () => {
    useTagStore.setState({ tags: [home], assignedTagsMap: new Map([[1, []]]) })
    expect(await sendPersonCheckin(1)).toBe('dialog')
    expect(events).toEqual([])
    expect(useUIStore.getState().checkinDialog).toEqual({ personIds: [1], notice: ASSIGNMENTS_LOADING_NOTICE })
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('a Text contains filter with tags not loaded opens the dialog instead: the text matches tag names too', async () => {
    useSettingsStore.setState({ checkinTaskFilter: { ...emptyPredicate(), searchText: 'home' } })
    useTagStore.setState({ tags: [home], assignedTagsMap: new Map([[1, []]]) })
    expect(await sendPersonCheckin(1)).toBe('dialog')
    expect(useUIStore.getState().checkinDialog).toEqual({ personIds: [1], notice: ASSIGNMENTS_LOADING_NOTICE })
  })

  it('a Tags or Text clause inside an or group with tags not loaded opens the dialog instead', async () => {
    // "Hot, or Tags is not #home" ("or Text home"): read as untagged, every task would pass.
    useTagStore.setState({ tags: [home], assignedTagsMap: new Map([[1, []]]) })
    for (const group of [{ tags: [7], negate: { tags: true as const } }, { searchText: 'home' }]) {
      useUIStore.setState({ checkinDialog: null })
      useSettingsStore.setState({
        checkinTaskFilter: { ...emptyPredicate(), orGroups: [{ ...emptyFilterClauses(), markers: 'hot', ...group }] },
      })
      expect(await sendPersonCheckin(1)).toBe('dialog')
      expect(useUIStore.getState().checkinDialog).toEqual({ personIds: [1], notice: ASSIGNMENTS_LOADING_NOTICE })
    }
    expect(events).toEqual([])
  })

  it('any filter with an open task’s people not loaded opens the dialog instead', async () => {
    useSettingsStore.setState({ checkinTaskFilter: emptyPredicate() })
    usePersonStore.setState({ assignedPeopleMap: new Map([[1, [ada]], [2, [ada, bob]]]) })
    expect(await sendPersonCheckin(1)).toBe('dialog')
    expect(events).toEqual([])
    expect(useUIStore.getState().checkinDialog).toEqual({ personIds: [1], notice: ASSIGNMENTS_LOADING_NOTICE })
  })
})

describe('checkinSentMessage', () => {
  it('names the person, how it went and the follow-ups', () => {
    expect(checkinSentMessage('Ann', 'opened', 5)).toBe('Check-in for Ann opened · 5 tasks followed up')
    expect(checkinSentMessage('Ann', 'downloaded', 1)).toBe('Check-in for Ann downloaded · 1 task followed up')
  })
})

describe('checkinSentStatus', () => {
  it('shows the address it went to and how to finish; without one, to add the recipient', () => {
    expect(checkinSentStatus('Ann', 'ann@example.com', 'opened', NOW))
      .toBe('Opened a message to Ann <ann@example.com>. The body is on your clipboard: paste it with Ctrl+V.')
    expect(checkinSentStatus('Ann', '', 'downloaded', NOW))
      .toBe('Downloaded the draft for Ann (Check-in - Ann - 2026-10-12.eml) — open it from your Downloads folder to review and send. Add the recipient in your mail app.')
  })
})
