import { describe, it, expect, vi } from 'vitest'
import { buildTaskMenuEntries, type TaskMenuHandlers } from '../../../components/task/task-menu-entries'
import type { MenuEntry, MenuItemEntry } from '../../../components/workspace/MenuPopover'
import type { PersistedTodoItem } from '../../../models'
import { makeTodo } from '../../helpers'

const TODAY = new Date(2026, 9, 10) // Sat 10 Oct 2026

function handlers(over: Partial<TaskMenuHandlers> = {}): TaskMenuHandlers {
  return {
    onOpen: vi.fn(),
    onToggleComplete: vi.fn(),
    onSetDueDate: vi.fn(),
    onSetFollowup: vi.fn(),
    onPickFollowup: vi.fn(),
    onFollowedUp: vi.fn(),
    onAssignPeople: vi.fn(),
    onAddTag: vi.fn(),
    onSetMarker: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  }
}

function build(todo: PersistedTodoItem, opts: { targets?: PersistedTodoItem[]; h?: TaskMenuHandlers; range?: number | null } = {}) {
  return buildTaskMenuEntries({
    todo,
    targets: opts.targets ?? [todo],
    today: TODAY,
    urgentRange: opts.range === undefined ? 3 : opts.range,
    handlers: opts.h ?? handlers(),
  })
}

const shape = (entries: readonly MenuEntry[]) => entries.map((e) =>
  e.kind === 'separator' ? '--' : e.kind === 'label' ? `[${e.text}]` : e.label)

function item(entries: readonly MenuEntry[], label: string): MenuItemEntry {
  const hit = entries.find((e): e is MenuItemEntry => e.kind === 'item' && e.label === label)
  if (!hit) throw new Error(`no item ${label}: ${shape(entries).join(', ')}`)
  return hit
}

describe('buildTaskMenuEntries — the one task menu', () => {
  it('single task: Open · Mark complete | due · follow-up · followed up · people · tag | Markers | Delete', () => {
    expect(shape(build(makeTodo({ id: 1 })))).toEqual([
      'Open', 'Mark complete', '--',
      'Set due date…', 'Follow-up', 'Followed up', 'Assign people…', 'Add tag…', '--',
      '[Markers]', 'Urgent', 'Important', 'Focus', '--',
      'Delete',
    ])
  })

  it('leaves out the items a surface has no handler for', () => {
    const entries = build(makeTodo({ id: 1 }), {
      h: handlers({ onOpen: undefined, onSetDueDate: undefined, onAssignPeople: undefined, onAddTag: undefined, onPickFollowup: undefined }),
    })
    expect(shape(entries)).toEqual([
      'Mark complete', '--', 'Follow-up', 'Followed up', '--',
      '[Markers]', 'Urgent', 'Important', 'Focus', '--', 'Delete',
    ])
    expect(shape(item(entries, 'Follow-up').children!)).toEqual(['1 week', '2 weeks', '1 month', '3 months'])
  })

  it('shows current dates as trailing notes and Mark incomplete for a completed task', () => {
    const entries = build(makeTodo({
      id: 1, isCompleted: true, dueDate: new Date(2026, 9, 15), nextFollowupAt: new Date(2026, 9, 13),
    }))
    expect(item(entries, 'Mark incomplete').kbd).toBe('Space')
    expect(item(entries, 'Set due date…').note).toBe('Thu 15')
    expect(item(entries, 'Follow-up').note).toBe('Tue 13')
    expect(item(entries, 'Delete')).toMatchObject({ danger: true, kbd: 'Del' })
  })

  it('Follow-up submenu: intervals with their dates, Pick…, and Clear only when set', () => {
    const h = handlers()
    const none = item(build(makeTodo({ id: 1 }), { h }), 'Follow-up').children!
    expect(shape(none)).toEqual(['1 week', '2 weeks', '1 month', '3 months', '--', 'Pick a date or interval…'])
    expect(none.filter((e): e is MenuItemEntry => e.kind === 'item').map((e) => e.note))
      .toEqual(['Sat 17 Oct', 'Sat 24 Oct', 'Tue 10 Nov', 'Sun 10 Jan 2027', undefined])
    item(none, '2 weeks').onSelect!()
    expect(h.onSetFollowup).toHaveBeenCalledWith(new Date(2026, 9, 24))
    item(none, 'Pick a date or interval…').onSelect!()
    expect(h.onPickFollowup).toHaveBeenCalled()

    const set = item(build(makeTodo({ id: 1, nextFollowupAt: new Date(2026, 9, 13) }), { h }), 'Follow-up').children!
    expect(shape(set).at(-1)).toBe('Clear follow-up')
    item(set, 'Clear follow-up').onSelect!()
    expect(h.onSetFollowup).toHaveBeenLastCalledWith(null)
  })

  it('markers are checkbox items: Urgent follows effective urgency (due within the range)', () => {
    const h = handlers()
    const entries = build(makeTodo({ id: 1, dueDate: new Date(2026, 9, 12), focus: true }), { h })
    expect(item(entries, 'Urgent')).toMatchObject({ checkbox: true, checked: true })
    expect(item(entries, 'Important')).toMatchObject({ checkbox: true, checked: false })
    expect(item(entries, 'Focus')).toMatchObject({ checkbox: true, checked: true })
    item(entries, 'Urgent').onSelect!()
    item(entries, 'Important').onSelect!()
    item(entries, 'Focus').onSelect!()
    expect(h.onSetMarker).toHaveBeenNthCalledWith(1, 'urgent', false)
    expect(h.onSetMarker).toHaveBeenNthCalledWith(2, 'important', true)
    expect(h.onSetMarker).toHaveBeenNthCalledWith(3, 'focus', false)
    // With the range off the due date doesn't make it urgent.
    expect(item(build(makeTodo({ id: 1, dueDate: new Date(2026, 9, 12) }), { range: null }), 'Urgent').checked).toBe(false)
  })

  it('several tasks: a count label replaces Open, Delete names the count, mixed markers', () => {
    const h = handlers()
    const a = makeTodo({ id: 1, urgent: true, important: true })
    const b = makeTodo({ id: 2, important: true })
    const c = makeTodo({ id: 3 })
    const entries = build(a, { targets: [a, b, c], h })
    expect(shape(entries).slice(0, 2)).toEqual(['[3 tasks]', 'Mark complete'])
    expect(shape(entries).at(-1)).toBe('Delete 3 tasks')
    expect(item(entries, 'Urgent')).toMatchObject({ checked: 'mixed', note: '1 of 3' })
    expect(item(entries, 'Important')).toMatchObject({ checked: 'mixed', note: '2 of 3' })
    expect(item(entries, 'Focus')).toMatchObject({ checked: false, note: undefined })
    // Mixed → on for all.
    item(entries, 'Urgent').onSelect!()
    expect(h.onSetMarker).toHaveBeenCalledWith('urgent', true)
    // No per-task trailing dates for a selection.
    expect(item(entries, 'Set due date…').note).toBeUndefined()
  })

  it('Followed up is dimmed (with a "Today" note) only when every task was followed up today', () => {
    const todayAt = new Date(2026, 9, 10, 9, 30)
    const done = makeTodo({ id: 1, lastFollowupAt: todayAt })
    const notDone = makeTodo({ id: 2, lastFollowupAt: new Date(2026, 9, 9) })
    expect(item(build(done), 'Followed up')).toMatchObject({ dim: true, note: 'Today' })
    expect(item(build(notDone), 'Followed up')).toMatchObject({ dim: false })
    expect(item(build(done, { targets: [done, notDone] }), 'Followed up').dim).toBe(false)
  })
})
