import { describe, it, expect } from 'vitest'
import {
  calendarDayDropId,
  eisenhowerQuadrantDropId,
  taskDragId,
  type TaskSurfaceKey,
} from '../../../utils/task-dnd'

describe('taskDragId — per-surface id format', () => {
  it.each([
    ['list-widget' as TaskSurfaceKey, 42, { scope: 't1', sectionKey: 'all' }, 'lw|t1|all|42'],
    ['calendar-widget' as TaskSurfaceKey, 42, { scope: 't2', sectionKey: 'due' }, 'cw|t2|due|42'],
  ])('%s → %s', (surface, id, extras, expected) => {
    expect(taskDragId(surface, id, extras)).toBe(expected)
  })

  it('list-widget: one id per occurrence (widget + group + task)', () => {
    const a = taskDragId('list-widget', 3, { scope: 't1', sectionKey: 'person-1' })
    const b = taskDragId('list-widget', 3, { scope: 't1', sectionKey: 'person-2' })
    const c = taskDragId('list-widget', 3, { scope: 't2', sectionKey: 'person-1' })
    expect(new Set([a, b, c]).size).toBe(3)
    expect(() => taskDragId('list-widget', 3, { scope: 't1' })).toThrow()
  })

  it('calendar-widget: one id per date type and per open day popover', () => {
    const due = taskDragId('calendar-widget', 3, { scope: 't1', sectionKey: 'due' })
    const followup = taskDragId('calendar-widget', 3, { scope: 't1', sectionKey: 'followup' })
    const inPopover = taskDragId('calendar-widget', 3, { scope: 't1', sectionKey: 'pop-due' })
    expect(new Set([due, followup, inPopover]).size).toBe(3)
    expect(() => taskDragId('calendar-widget', 3, { sectionKey: 'due' })).toThrow()
  })
})

describe('drop-zone id helpers', () => {
  it('calendarDayDropId embeds scope + ms', () => {
    expect(calendarDayDropId('ws-t1', 1700000000000)).toBe('calday-ws-t1-1700000000000')
  })

  it('two calendar widgets yield distinct ids for the same date', () => {
    const dateMs = 1700000000000
    expect(calendarDayDropId('ws-t1', dateMs)).not.toBe(calendarDayDropId('ws-t2', dateMs))
  })

  it('eisenhowerQuadrantDropId embeds the widget and the quadrant', () => {
    expect(eisenhowerQuadrantDropId('t1', 'do')).toBe('eis-t1-do')
    expect(eisenhowerQuadrantDropId('t1', 'do')).not.toBe(eisenhowerQuadrantDropId('t2', 'do'))
  })
})
