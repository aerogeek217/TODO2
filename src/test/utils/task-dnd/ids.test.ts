import { describe, it, expect } from 'vitest'
import {
  TASKBOARD_SINGLETON_DROP_ID,
  calendarDayDropId,
  isTaskDragId,
  parseTaskboardEntryId,
  projectDropId,
  taskboardFloatDropId,
  taskDragId,
  type TaskSurfaceKey,
} from '../../../utils/task-dnd'

describe('taskDragId — per-surface id format', () => {
  it.each([
    ['canvas-project' as TaskSurfaceKey, 42, undefined, 'todo-42'],
    ['inset' as TaskSurfaceKey, 42, undefined, 'inset-todo-42'],
    ['lens' as TaskSurfaceKey, 42, undefined, 'lens-todo-42'],
    ['list' as TaskSurfaceKey, 42, undefined, 'list-todo-42'],
    ['taskboard-panel' as TaskSurfaceKey, 42, undefined, 'tbp-42'],
    ['calendar-view' as TaskSurfaceKey, 42, undefined, 'calview-todo-42'],
    ['calendar-strip' as TaskSurfaceKey, 42, undefined, 'calstrip-todo-42'],
    ['search' as TaskSurfaceKey, 42, undefined, 'search-todo-42'],
  ])('%s → %s', (surface, id, extras, expected) => {
    expect(taskDragId(surface, id, extras)).toBe(expected)
  })

  it('dashboard embeds listKey', () => {
    expect(taskDragId('dashboard', 42, { listKey: 'hero' })).toBe('dashboard-hero-42')
    expect(taskDragId('dashboard', 42, { listKey: 'user-7' })).toBe('dashboard-user-7-42')
  })

  it('taskboard-float embeds floatingId', () => {
    expect(taskDragId('taskboard-float', 42, { floatingId: 7 })).toBe('tb-7-42')
  })

  it('throws when dashboard extras are missing', () => {
    expect(() => taskDragId('dashboard', 42)).toThrow(/listKey/)
  })

  it('throws when taskboard-float extras are missing', () => {
    expect(() => taskDragId('taskboard-float', 42)).toThrow(/floatingId/)
  })
})

describe('isTaskDragId', () => {
  it('accepts every surface id format', () => {
    expect(isTaskDragId('todo-1')).toBe(true)
    expect(isTaskDragId('inset-todo-1')).toBe(true)
    expect(isTaskDragId('lens-todo-1')).toBe(true)
    expect(isTaskDragId('list-todo-1')).toBe(true)
    expect(isTaskDragId('dashboard-hero-1')).toBe(true)
    expect(isTaskDragId('tbp-1')).toBe(true)
    expect(isTaskDragId('tb-7-1')).toBe(true)
    expect(isTaskDragId('calview-todo-1')).toBe(true)
    expect(isTaskDragId('calstrip-todo-1')).toBe(true)
    expect(isTaskDragId('search-todo-1')).toBe(true)
  })

  it('rejects non-dashboard drop-target ids', () => {
    expect(isTaskDragId('project-drop-5')).toBe(false)
    expect(isTaskDragId('taskboard-drop-7')).toBe(false)
    expect(isTaskDragId('rails:slot:s-1')).toBe(false)
  })

  // Pinned: isTaskDragId is a cheap prefix-only check. The dashboard
  // singleton-taskboard droppable happens to start with `dashboard-`, so this
  // conservative helper says "maybe a drag id" — callers that need precision
  // must decode further (drop handlers route on `over.data.current.type`).
  it('conservatively accepts the dashboard-taskboard-drop id (documented)', () => {
    expect(isTaskDragId('dashboard-taskboard-drop')).toBe(true)
  })

  it('rejects non-string / null / number ids', () => {
    expect(isTaskDragId(null)).toBe(false)
    expect(isTaskDragId(undefined)).toBe(false)
    expect(isTaskDragId(42)).toBe(false)
  })
})

describe('parseTaskboardEntryId — F9 regression', () => {
  it('parses the singleton panel form', () => {
    expect(parseTaskboardEntryId('tbp-42')).toEqual({ todoId: 42 })
  })

  it('parses the floating-node form', () => {
    expect(parseTaskboardEntryId('tb-7-42')).toEqual({ todoId: 42, floatingId: 7 })
  })

  it('returns null for other id shapes', () => {
    expect(parseTaskboardEntryId('todo-1')).toBeNull()
    expect(parseTaskboardEntryId('list-todo-1')).toBeNull()
    expect(parseTaskboardEntryId('dashboard-hero-1')).toBeNull()
    expect(parseTaskboardEntryId('project-drop-1')).toBeNull()
  })

  it('returns null for malformed tb-* ids', () => {
    expect(parseTaskboardEntryId('tb-')).toBeNull()
    expect(parseTaskboardEntryId('tb-7')).toBeNull()
    expect(parseTaskboardEntryId('tb-abc-42')).toBeNull()
    expect(parseTaskboardEntryId('tb--42')).toBeNull()
  })

  it('returns null for fully malformed tbp-* ids', () => {
    expect(parseTaskboardEntryId('tbp-abc')).toBeNull()
  })

  // Empty trailing segments parse as todoId 0. Harmless because no real todo
  // has id 0, but worth pinning: any future work that tightens the parser
  // should update this test.
  it('empty trailing id segments yield todoId 0 (current behavior)', () => {
    expect(parseTaskboardEntryId('tbp-')).toEqual({ todoId: 0 })
    expect(parseTaskboardEntryId('tb-7-')).toEqual({ floatingId: 7, todoId: 0 })
  })

  // F9: the old `Number(id.split('-').pop())` sniff reads the trailing numeric
  // segment regardless of prefix. If a hypothetical future prefix ever emits
  // a "<prefix>-<otherNumber>-<todoId>" shape for something that ISN'T a
  // taskboard entry, the legacy parse silently returns a bogus todoId; this
  // parser instead returns null so callers can fall through safely.
  it('rejects a <prefix>-<n>-<n> shape that would have fooled the legacy parse', () => {
    // A future hypothetical task-surface id
    expect(parseTaskboardEntryId('dashboard-user-7-42')).toBeNull()
  })
})

describe('drop-zone id helpers', () => {
  it('projectDropId', () => {
    expect(projectDropId(5)).toBe('project-drop-5')
  })

  it('taskboardFloatDropId', () => {
    expect(taskboardFloatDropId(77)).toBe('taskboard-drop-77')
  })

  it('TASKBOARD_SINGLETON_DROP_ID is the dashboard/rail singleton id', () => {
    expect(TASKBOARD_SINGLETON_DROP_ID).toBe('dashboard-taskboard-drop')
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
