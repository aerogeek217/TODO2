import { describe, it, expect } from 'vitest'
import {
  calendarDayDropId,
  isTaskDragId,
  projectDropId,
  taskDragId,
  type TaskSurfaceKey,
} from '../../../utils/task-dnd'

describe('taskDragId — per-surface id format', () => {
  it.each([
    ['canvas-project' as TaskSurfaceKey, 42, undefined, 'todo-42'],
    ['inset' as TaskSurfaceKey, 42, undefined, 'inset-todo-42'],
    ['lens' as TaskSurfaceKey, 42, undefined, 'lens-todo-42'],
    ['list' as TaskSurfaceKey, 42, undefined, 'list-todo-42'],
    ['calendar-view' as TaskSurfaceKey, 42, undefined, 'calview-todo-42'],
    ['calendar-strip' as TaskSurfaceKey, 42, undefined, 'calstrip-todo-42'],
  ])('%s → %s', (surface, id, extras, expected) => {
    expect(taskDragId(surface, id, extras)).toBe(expected)
  })

  it('list-widget: one id per occurrence (widget + group + task)', () => {
    const a = taskDragId('list-widget', 3, { scope: 't1', sectionKey: 'person-1' })
    const b = taskDragId('list-widget', 3, { scope: 't1', sectionKey: 'person-2' })
    const c = taskDragId('list-widget', 3, { scope: 't2', sectionKey: 'person-1' })
    expect(new Set([a, b, c]).size).toBe(3)
    expect(isTaskDragId(a)).toBe(true)
    expect(() => taskDragId('list-widget', 3, { scope: 't1' })).toThrow()
  })
})

describe('isTaskDragId', () => {
  it('accepts every surface id format', () => {
    expect(isTaskDragId('todo-1')).toBe(true)
    expect(isTaskDragId('inset-todo-1')).toBe(true)
    expect(isTaskDragId('lens-todo-1')).toBe(true)
    expect(isTaskDragId('list-todo-1')).toBe(true)
    expect(isTaskDragId('calview-todo-1')).toBe(true)
    expect(isTaskDragId('calstrip-todo-1')).toBe(true)
  })

  it('rejects drop-target ids', () => {
    expect(isTaskDragId('project-drop-5')).toBe(false)
    expect(isTaskDragId('calday-view-0')).toBe(false)
    expect(isTaskDragId('rails:slot:s-1')).toBe(false)
  })

  it('rejects non-string / null / number ids', () => {
    expect(isTaskDragId(null)).toBe(false)
    expect(isTaskDragId(undefined)).toBe(false)
    expect(isTaskDragId(42)).toBe(false)
  })
})

describe('drop-zone id helpers', () => {
  it('projectDropId', () => {
    expect(projectDropId(5)).toBe('project-drop-5')
  })

  it('calendarDayDropId embeds scope + ms', () => {
    expect(calendarDayDropId('view', 1700000000000)).toBe('calday-view-1700000000000')
    expect(calendarDayDropId('strip-rail-left', 42)).toBe('calday-strip-rail-left-42')
  })

  it('distinct scopes yield distinct ids for the same date', () => {
    const dateMs = 1700000000000
    const a = calendarDayDropId('view', dateMs)
    const b = calendarDayDropId('rail-left', dateMs)
    expect(a).not.toBe(b)
  })
})
