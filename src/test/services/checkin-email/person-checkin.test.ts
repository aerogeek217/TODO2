import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../../data/database'
import type { Person, PersistedTodoItem } from '../../../models'
import {
  CHECKIN_INCLUDE_DEFAULTS,
  checkinSentMessage,
  COPY_FAILED_NOTICE,
  noTasksNotice,
  sendPersonCheckin,
} from '../../../services/checkin-email/person-checkin'
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
  useListDefinitionStore.setState({ listDefinitions: [] })
  useSettingsStore.setState({
    checkinOpenMethod: 'mailto', checkinTaskScope: { kind: 'all' }, weekStartsOn: 1,
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
    expect(useUndoStore.getState().snackbar).toEqual({ description: 'Check-in for Ada Lovelace opened · 2 tasks followed up' })

    await useUndoStore.getState().undo()
    expect(followedUp()).toEqual([])
    expect((await db.todos.get(1))?.lastFollowupAt).toBeUndefined()
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

  it('uses the saved Which tasks choice', async () => {
    useSettingsStore.setState({ checkinTaskScope: { kind: 'due-soon' } })
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
    await vi.waitFor(() => expect(useUndoStore.getState().snackbar).toEqual({ description: 'Check-in for Bob Stone downloaded · 1 task followed up' }))
  })

  it('no address: mailto: with an empty To, an .eml with no To header', async () => {
    expect(await sendPersonCheckin(3)).toBe('opened')
    expect(clicked[0]!.getAttribute('href')).toBe('mailto:?subject=Task%20check-in%3A%201%20open%20task')
    useSettingsStore.setState({ checkinOpenMethod: 'eml' })
    expect(await sendPersonCheckin(3)).toBe('downloaded')
    const eml = await blobs[0]!.text()
    expect(eml).not.toMatch(/^To:/im)
    expect(eml).toMatch(/^X-Unsent: 1\r\n/)
  })

  it('no open tasks in the scope: opens the dialog for the person with the reason; nothing copied or recorded', async () => {
    useSettingsStore.setState({ checkinTaskScope: { kind: 'hot' } })
    expect(await sendPersonCheckin(1)).toBe('dialog')
    expect(events).toEqual([])
    expect(useUIStore.getState().checkinDialog).toEqual({ personIds: [1], notice: noTasksNotice('Ada Lovelace', 'Hot') })
    expect(noTasksNotice('Ada Lovelace', 'Hot'))
      .toBe('Ada Lovelace has no open tasks in “Hot”, so nothing was sent. Choose other tasks under Which tasks.')
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
})

describe('checkinSentMessage', () => {
  it('names the person, how it went and the follow-ups', () => {
    expect(checkinSentMessage('Ann', 'opened', 5)).toBe('Check-in for Ann opened · 5 tasks followed up')
    expect(checkinSentMessage('Ann', 'downloaded', 1)).toBe('Check-in for Ann downloaded · 1 task followed up')
  })
})
