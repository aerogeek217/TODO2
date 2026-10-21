import { describe, it, expect, vi } from 'vitest'
import { buildTaskMenuEntries, type TaskMenuHandlers } from '../../../components/task/task-menu-entries'
import type { MenuEntry, MenuItemEntry } from '../../../components/shared/MenuPopover'
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
  e.kind === 'separator' ? '--' : e.kind === 'label' ? `[${e.text}]` : e.kind === 'note' ? `(${e.text})` : e.label)

function item(entries: readonly MenuEntry[], label: string): MenuItemEntry {
  const hit = entries.find((e): e is MenuItemEntry => e.kind === 'item' && e.label === label)
  if (!hit) throw new Error(`no item ${label}: ${shape(entries).join(', ')}`)
  return hit
}

describe('buildTaskMenuEntries — the one task menu', () => {
  it('single task: Open · Mark complete | due · follow-up · followed up · people · tag | Markers | Delete', () => {
    expect(shape(build(makeTodo({ id: 1 })))).toEqual([
      'Open', 'Mark complete', '--',
      'Set due date…', 'Follow-up', 'Mark followed up', 'Assign people…', 'Add tag…', '--',
      '[Priority]', 'Focus', 'Urgent', 'Important', '--',
      'Delete',
    ])
  })

  it('leaves out the items a surface has no handler for', () => {
    const entries = build(makeTodo({ id: 1 }), {
      h: handlers({ onOpen: undefined, onSetDueDate: undefined, onAssignPeople: undefined, onAddTag: undefined, onPickFollowup: undefined }),
    })
    expect(shape(entries)).toEqual([
      'Mark complete', '--', 'Follow-up', 'Mark followed up', '--',
      '[Priority]', 'Focus', 'Urgent', 'Important', '--', 'Delete',
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

  it('markers are checkbox items by flag: a due date that makes the task urgent is a note + tooltip, not a check', () => {
    const h = handlers()
    const entries = build(makeTodo({ id: 1, dueDate: new Date(2026, 9, 12), focus: true }), { h })
    expect(item(entries, 'Urgent')).toMatchObject({
      checkbox: true,
      checked: false,
      note: 'By due date',
      title: 'Urgent by due date — due Mon 12. Click to flag it urgent too.',
    })
    expect(item(entries, 'Important')).toMatchObject({ checkbox: true, checked: false })
    expect(item(entries, 'Focus')).toMatchObject({ checkbox: true, checked: true })
    item(entries, 'Urgent').onSelect!()
    item(entries, 'Important').onSelect!()
    item(entries, 'Focus').onSelect!()
    expect(h.onSetMarker).toHaveBeenNthCalledWith(1, 'urgent', true)
    expect(h.onSetMarker).toHaveBeenNthCalledWith(2, 'important', true)
    expect(h.onSetMarker).toHaveBeenNthCalledWith(3, 'focus', false)
    // Flagged and due soon: checked; clearing clears the flag only — the tooltip says the date keeps it urgent.
    const flagged = build(makeTodo({ id: 1, urgent: true, dueDate: new Date(2026, 9, 12) }), { h })
    expect(item(flagged, 'Urgent')).toMatchObject({
      checked: true,
      note: undefined,
      title: 'Its due date keeps it urgent even unflagged — due Mon 12.',
    })
    item(flagged, 'Urgent').onSelect!()
    expect(h.onSetMarker).toHaveBeenLastCalledWith('urgent', false)
    // With the range off the due date doesn't make it urgent.
    expect(item(build(makeTodo({ id: 1, dueDate: new Date(2026, 9, 12) }), { range: null }), 'Urgent'))
      .toMatchObject({ checked: false, note: undefined, title: undefined })
  })

  it('several tasks: Urgent is mixed by flag; tasks urgent by their due dates are counted in the tooltip', () => {
    const a = makeTodo({ id: 1, urgent: true })
    const b = makeTodo({ id: 2, dueDate: new Date(2026, 9, 12) })
    const c = makeTodo({ id: 3 })
    expect(item(build(a, { targets: [a, b, c] }), 'Urgent')).toMatchObject({
      checked: 'mixed',
      note: '1 of 3',
      title: '1 of 3 tasks is urgent by its due date, flagged or not.',
    })
    expect(item(build(b, { targets: [b, c] }), 'Urgent')).toMatchObject({ checked: false, note: 'By due date' })
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

  it('Mark followed up is dimmed (with a "Today" note) only when every task was followed up today', () => {
    const todayAt = new Date(2026, 9, 10, 9, 30)
    const done = makeTodo({ id: 1, lastFollowupAt: todayAt })
    const notDone = makeTodo({ id: 2, lastFollowupAt: new Date(2026, 9, 9) })
    expect(item(build(done), 'Mark followed up')).toMatchObject({ dim: true, note: 'Today' })
    expect(item(build(notDone), 'Mark followed up')).toMatchObject({ dim: false })
    expect(item(build(done, { targets: [done, notDone] }), 'Mark followed up').dim).toBe(false)
  })
})
