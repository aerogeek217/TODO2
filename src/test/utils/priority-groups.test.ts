import { describe, it, expect } from 'vitest'
import { makeTodo } from '../helpers'
import type { PersistedTodoItem } from '../../models'
import {
  NO_PRIORITY_KEY,
  priorityGroupKey,
  priorityGroupsOf,
  resolvePriorityDrop,
  type PriorityGroupContext,
} from '../../utils/priority-groups'

const today = new Date(2026, 0, 12)
const ctx: PriorityGroupContext = { today, urgentRange: 3 }
const HOT = priorityGroupKey('hot')
const FOCUS = priorityGroupKey('focus')
const URGENT = priorityGroupKey('urgent')
const IMPORTANT = priorityGroupKey('important')

function task(over: Partial<PersistedTodoItem> = {}): PersistedTodoItem {
  return makeTodo({ id: 7, title: 'Plan', ...over })
}

describe('priorityGroupsOf', () => {
  it('lists the groups in order; Urgent by due date counts; none = No priority', () => {
    expect(priorityGroupsOf(task({ focus: true, urgent: true }), ctx)).toEqual(['hot', 'focus', 'urgent'])
    expect(priorityGroupsOf(task({ dueDate: new Date(2026, 0, 13) }), ctx)).toEqual(['urgent'])
    expect(priorityGroupsOf(task(), ctx)).toEqual([])
  })

  it('a completed task is never Hot but keeps its flags’ groups', () => {
    expect(priorityGroupsOf(task({ focus: true, isCompleted: true }), ctx)).toEqual(['focus'])
  })
})

describe('resolvePriorityDrop', () => {
  it('into a marker group sets its flag and clears the source group’s flag', () => {
    const drop = resolvePriorityDrop(task({ urgent: true }), URGENT, IMPORTANT, ctx)
    expect(drop).toEqual({ kind: 'write', flags: { urgent: false, important: true }, description: 'Marked not urgent, important · Plan' })
  })

  it('out of Hot or No priority clears nothing', () => {
    expect(resolvePriorityDrop(task({ focus: true }), HOT, IMPORTANT, ctx)).toMatchObject({ kind: 'write', flags: { important: true } })
    expect(resolvePriorityDrop(task(), NO_PRIORITY_KEY, FOCUS, ctx)).toMatchObject({ kind: 'write', flags: { focus: true } })
  })

  it('into No priority clears all three flags (only the ones set are written)', () => {
    const drop = resolvePriorityDrop(task({ focus: true, important: true }), FOCUS, NO_PRIORITY_KEY, ctx)
    expect(drop).toMatchObject({ kind: 'write', flags: { focus: false, important: false } })
  })

  it('into Hot is refused', () => {
    const drop = resolvePriorityDrop(task({ focus: true }), FOCUS, HOT, ctx)
    expect(drop).toEqual({
      kind: 'refused',
      lines: ['Can’t move to Hot', 'Hot comes from a task’s markers, by the Hot rule in Settings.', 'Drop it on Focus, Urgent or Important instead.'],
    })
  })

  it('out of Urgent is refused while the due date keeps the task urgent, with why', () => {
    const due = task({ urgent: true, dueDate: new Date(2026, 0, 13) })
    expect(resolvePriorityDrop(due, URGENT, IMPORTANT, ctx)).toEqual({
      kind: 'refused',
      lines: [
        'Can’t move to Important',
        expect.stringMatching(/^Plan is due .+, within 3 days, so it counts as urgent\.$/),
        'Change its due date or the due-soon range first.',
      ],
    })
    const overdue = task({ dueDate: new Date(2026, 0, 10) })
    expect(resolvePriorityDrop(overdue, URGENT, FOCUS, ctx)).toMatchObject({
      kind: 'refused',
      lines: ['Can’t move to Focus', expect.stringMatching(/^Plan is overdue \(.+\), so it counts as urgent\.$/), expect.any(String)],
    })
  })

  it('into No priority is refused while the due date keeps the task urgent', () => {
    const due = task({ focus: true, dueDate: today })
    expect(resolvePriorityDrop(due, FOCUS, NO_PRIORITY_KEY, ctx)).toMatchObject({
      kind: 'refused',
      lines: ['Can’t move to No priority', 'Plan is due today, so it counts as urgent.', expect.any(String)],
    })
  })

  it('the due date doesn’t block a drop out of another group', () => {
    const due = task({ important: true, dueDate: today })
    expect(resolvePriorityDrop(due, IMPORTANT, FOCUS, ctx)).toMatchObject({ kind: 'write', flags: { important: false, focus: true } })
  })

  it('nothing to do: same group, unknown keys, flags already so', () => {
    expect(resolvePriorityDrop(task({ urgent: true }), URGENT, URGENT, ctx)).toBeNull()
    expect(resolvePriorityDrop(task(), 'tag-1', FOCUS, ctx)).toBeNull()
    expect(resolvePriorityDrop(task({ focus: true }), HOT, FOCUS, ctx)).toBeNull()
  })
})
