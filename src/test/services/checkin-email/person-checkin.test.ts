import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Person } from '../../../models'
import { emptyPredicate } from '../../../models/filter-predicate'
import {
  buildCheckinContext,
  CHECKIN_INCLUDE_DEFAULTS,
  checkinCopiedStatus,
  copyCheckinMessage,
  copyCheckinSubject,
  prepareCheckin,
} from '../../../services/checkin-email/person-checkin'
import { useUndoStore } from '../../../stores/undo-store'
import type { FilterSettings } from '../../../utils/filter-match'
import { makePerson, makeTodo } from '../../helpers'

const TODAY = new Date(2026, 9, 12)
const SETTINGS: FilterSettings = { urgentRange: 0, weekStartsOn: 1 }
const ada = makePerson({ id: 1, name: 'Ada Lovelace', initials: 'AL' })
const TODOS = [
  makeTodo({ id: 1, uid: '11111111-0000-4000-8000-000000000001', title: 'Overdue report', dueDate: new Date(2026, 9, 10) }),
  makeTodo({ id: 2, uid: '22222222-0000-4000-8000-000000000002', title: 'Someday idea' }),
  makeTodo({ id: 3, uid: '33333333-0000-4000-8000-000000000003', title: 'Done already', isCompleted: true }),
]
const ctx = () => buildCheckinContext({
  todos: TODOS, today: TODAY,
  assignedPeopleMap: new Map<number, Person[]>([[1, [ada]], [2, [ada]], [3, [ada]]]),
  assignedTagsMap: new Map(), statuses: [], statusUpdatesByTodo: new Map(), subtasksByTodo: new Map(),
  filterSettings: SETTINGS,
})

let write: ReturnType<typeof vi.fn>
let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  write = vi.fn(async () => {})
  writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write, writeText } })
  vi.stubGlobal('ClipboardItem', class { constructor(public data: Record<string, Blob>) {} })
  useUndoStore.getState().clear()
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
  vi.unstubAllGlobals()
})

describe('prepareCheckin', () => {
  it('builds the person’s message over their open tasks; its task ids are the message’s', () => {
    const prepared = prepareCheckin(ada, emptyPredicate(), ctx(), CHECKIN_INCLUDE_DEFAULTS, TODAY)
    expect(prepared.taskIds).toEqual([1, 2])
    expect(prepared.email.subject).toBe('Task check-in: 2 open tasks')
    expect(prepared.email.plain).toContain('Ref 11111111')
    expect(prepared.email.plain.split('\n').at(-1)).toBe('Check-in for Ada Lovelace · sent 2026-10-12')
    expect(prepared.email).not.toHaveProperty('to')
  })
})

describe('copying', () => {
  it('copyCheckinMessage writes the HTML and the plain text in one item, and records nothing', async () => {
    const { email } = prepareCheckin(ada, emptyPredicate(), ctx(), CHECKIN_INCLUDE_DEFAULTS, TODAY)
    expect(await copyCheckinMessage(email)).toBe(true)
    const item = (write.mock.calls[0] as unknown as [Array<{ data: Record<string, Blob> }>])[0][0]!
    expect(await item.data['text/html']!.text()).toBe(email.html)
    expect(await item.data['text/plain']!.text()).toBe(email.plain)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('falls back to plain text, and says false when the clipboard refuses both', async () => {
    const { email } = prepareCheckin(ada, emptyPredicate(), ctx(), CHECKIN_INCLUDE_DEFAULTS, TODAY)
    write.mockRejectedValue(new Error('no'))
    expect(await copyCheckinMessage(email)).toBe(true)
    expect(writeText).toHaveBeenCalledWith(email.plain)
    writeText.mockRejectedValue(new Error('no'))
    expect(await copyCheckinMessage(email)).toBe(false)
  })

  it('copyCheckinSubject writes the subject as plain text', async () => {
    const { email } = prepareCheckin(ada, emptyPredicate(), ctx(), CHECKIN_INCLUDE_DEFAULTS, TODAY)
    expect(await copyCheckinSubject(email)).toBe(true)
    expect(writeText).toHaveBeenCalledWith('Task check-in: 2 open tasks')
    writeText.mockRejectedValue(new Error('no'))
    expect(await copyCheckinSubject(email)).toBe(false)
  })

  it('the status line names the person', () => {
    expect(checkinCopiedStatus('Ada Lovelace')).toBe('Copied the check-in for Ada Lovelace. Paste it into your message.')
  })
})
