import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCommands, searchDynamicCommands } from '../../services/command-registry'
import type { CommandContext } from '../../services/command-registry'
import { makeTodo, makeProject } from '../helpers'

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    navigateTo: vi.fn(),
    openQuickAdd: vi.fn(),
    selectionCount: 0,
    bulkSetCompleted: vi.fn().mockResolvedValue(undefined),
    bulkSetStatus: vi.fn().mockResolvedValue(undefined),
    bulkRemove: vi.fn().mockResolvedValue(undefined),
    getSelectedIds: vi.fn().mockReturnValue([]),
    clearAllFilters: vi.fn(),
    setShowCompleted: vi.fn(),
    getShowCompleted: vi.fn().mockReturnValue(false),
    setDateRange: vi.fn(),
    getTodos: () => [],
    getProjects: () => [],
    focusTask: vi.fn(),
    focusProject: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Navigation commands ─────────────────────────────────────────────────────

describe('createCommands — navigation commands', () => {
  it('createCommands_noSelection_includesCanvasNavCommand', () => {
    const ctx = makeContext()
    const commands = createCommands(ctx)
    expect(commands.some(c => c.id === 'nav-canvas')).toBe(true)
  })

  it('createCommands_noSelection_includesAllFourNavigationCommands', () => {
    const ctx = makeContext()
    const commands = createCommands(ctx)
    const navIds = commands.filter(c => c.category === 'navigation').map(c => c.id)
    expect(navIds).toContain('nav-canvas')
    expect(navIds).toContain('nav-list')
    expect(navIds).toContain('nav-calendar')
    expect(navIds).toContain('nav-settings')
  })

  it('createCommands_navCanvas_actionCallsNavigateTo', () => {
    const ctx = makeContext()
    const commands = createCommands(ctx)
    const cmd = commands.find(c => c.id === 'nav-canvas')!
    cmd.action()
    expect(ctx.navigateTo).toHaveBeenCalledWith('/')
  })

  it('createCommands_navList_actionCallsNavigateToList', () => {
    const ctx = makeContext()
    const commands = createCommands(ctx)
    const cmd = commands.find(c => c.id === 'nav-list')!
    cmd.action()
    expect(ctx.navigateTo).toHaveBeenCalledWith('/list')
  })

  it('createCommands_navCalendar_actionCallsNavigateToCalendar', () => {
    const ctx = makeContext()
    const commands = createCommands(ctx)
    const cmd = commands.find(c => c.id === 'nav-calendar')!
    cmd.action()
    expect(ctx.navigateTo).toHaveBeenCalledWith('/calendar')
  })

  it('createCommands_navSettings_actionCallsNavigateToSettings', () => {
    const ctx = makeContext()
    const commands = createCommands(ctx)
    const cmd = commands.find(c => c.id === 'nav-settings')!
    cmd.action()
    expect(ctx.navigateTo).toHaveBeenCalledWith('/settings')
  })

  it('createCommands_noSelection_includesNewTaskCommand', () => {
    const ctx = makeContext()
    const commands = createCommands(ctx)
    const cmd = commands.find(c => c.id === 'new-task')!
    expect(cmd).toBeDefined()
    cmd.action()
    expect(ctx.openQuickAdd).toHaveBeenCalled()
  })
})

// ─── Bulk actions ─────────────────────────────────────────────────────────────

describe('createCommands — bulk actions with selectionCount > 0', () => {
  it('createCommands_selectionCountOne_includesCompleteAndDelete', () => {
    const ctx = makeContext({ selectionCount: 1, getSelectedIds: vi.fn().mockReturnValue([42]) })
    const commands = createCommands(ctx)
    const bulkIds = commands.filter(c => c.category === 'bulk').map(c => c.id)
    expect(bulkIds).toContain('bulk-complete')
    expect(bulkIds).toContain('bulk-uncomplete')
    expect(bulkIds).toContain('bulk-delete')
  })

  it('createCommands_selectionCountOne_commandNamesContainOneTaskLabel', () => {
    const ctx = makeContext({ selectionCount: 1, getSelectedIds: vi.fn().mockReturnValue([1]) })
    const commands = createCommands(ctx)
    const bulkComplete = commands.find(c => c.id === 'bulk-complete')!
    expect(bulkComplete.name).toContain('1 Task')
  })

  it('createCommands_selectionCountThree_commandNamesContainThreeTasksLabel', () => {
    const ctx = makeContext({ selectionCount: 3, getSelectedIds: vi.fn().mockReturnValue([1, 2, 3]) })
    const commands = createCommands(ctx)
    const bulkComplete = commands.find(c => c.id === 'bulk-complete')!
    expect(bulkComplete.name).toContain('3 Tasks')
  })

  it('createCommands_selectionCountZero_doesNotIncludeBulkCommands', () => {
    const ctx = makeContext({ selectionCount: 0 })
    const commands = createCommands(ctx)
    expect(commands.filter(c => c.category === 'bulk')).toHaveLength(0)
  })

  it('createCommands_bulkComplete_actionCallsBulkSetCompletedWithSelectedIds', () => {
    const selectedIds = [10, 20]
    const ctx = makeContext({
      selectionCount: 2,
      getSelectedIds: vi.fn().mockReturnValue(selectedIds),
    })
    const commands = createCommands(ctx)
    const cmd = commands.find(c => c.id === 'bulk-complete')!
    cmd.action()
    expect(ctx.bulkSetCompleted).toHaveBeenCalledWith(selectedIds, true)
  })

  it('createCommands_bulkUncomplete_actionCallsBulkSetCompletedFalse', () => {
    const selectedIds = [10]
    const ctx = makeContext({
      selectionCount: 1,
      getSelectedIds: vi.fn().mockReturnValue(selectedIds),
    })
    const commands = createCommands(ctx)
    const cmd = commands.find(c => c.id === 'bulk-uncomplete')!
    cmd.action()
    expect(ctx.bulkSetCompleted).toHaveBeenCalledWith(selectedIds, false)
  })

  it('createCommands_bulkDelete_actionCallsBulkRemoveWithSelectedIds', () => {
    const selectedIds = [5, 6]
    const ctx = makeContext({
      selectionCount: 2,
      getSelectedIds: vi.fn().mockReturnValue(selectedIds),
    })
    const commands = createCommands(ctx)
    const cmd = commands.find(c => c.id === 'bulk-delete')!
    cmd.action()
    expect(ctx.bulkRemove).toHaveBeenCalledWith(selectedIds)
  })
})

// ─── focus-filter command ─────────────────────────────────────────────────────

describe('createCommands — focus-filter command', () => {
  it('createCommands_focusFilter_commandExists', () => {
    const ctx = makeContext()
    const commands = createCommands(ctx)
    expect(commands.some(c => c.id === 'focus-filter')).toBe(true)
  })

  it('createCommands_focusFilter_actionFocusesFirstButtonInFilterRow', () => {
    // Arrange: create a DOM structure matching what the action queries
    const filterRow = document.createElement('div')
    filterRow.setAttribute('data-filter-row', '')
    const btn = document.createElement('button')
    btn.focus = vi.fn()
    filterRow.appendChild(btn)
    document.body.appendChild(filterRow)

    try {
      const ctx = makeContext()
      const commands = createCommands(ctx)
      const cmd = commands.find(c => c.id === 'focus-filter')!

      // Act
      cmd.action()

      // Assert
      expect(btn.focus).toHaveBeenCalled()
    } finally {
      document.body.removeChild(filterRow)
    }
  })

  it('createCommands_focusFilter_actionDoesNotThrowWhenFilterRowAbsent', () => {
    // Ensure no data-filter-row in document
    const existing = document.querySelector('[data-filter-row]')
    if (existing) existing.remove()

    const ctx = makeContext()
    const commands = createCommands(ctx)
    const cmd = commands.find(c => c.id === 'focus-filter')!

    // Should not throw even when the element is missing
    expect(() => cmd.action()).not.toThrow()
  })
})

// ─── searchDynamicCommands — lazy task search ────────────────────────────────

describe('searchDynamicCommands — task search', () => {
  it('searchDynamicCommands_withMatchingQuery_returnsMatchingTodos', () => {
    const todos = [
      makeTodo({ id: 1, title: 'Write unit tests' }),
      makeTodo({ id: 2, title: 'Fix login bug' }),
      makeTodo({ id: 3, title: 'Write docs' }),
    ]
    const ctx = makeContext({ getTodos: () => todos })
    const results = searchDynamicCommands('write', ctx)
    expect(results.filter(c => c.category === 'tasks')).toHaveLength(2)
  })

  it('searchDynamicCommands_withQuery_commandIdsMatchTodoIds', () => {
    const todos = [makeTodo({ id: 7, title: 'Alpha' }), makeTodo({ id: 42, title: 'Beta' })]
    const ctx = makeContext({ getTodos: () => todos })
    const results = searchDynamicCommands('alpha', ctx)
    expect(results.some(c => c.id === 'task-7')).toBe(true)
    expect(results.some(c => c.id === 'task-42')).toBe(false)
  })

  it('searchDynamicCommands_withQuery_commandNameIsTodoTitle', () => {
    const todos = [makeTodo({ id: 5, title: 'Write unit tests' })]
    const ctx = makeContext({ getTodos: () => todos })
    const results = searchDynamicCommands('unit', ctx)
    const cmd = results.find(c => c.id === 'task-5')!
    expect(cmd.name).toBe('Write unit tests')
  })

  it('searchDynamicCommands_withQuery_actionCallsFocusTask', () => {
    const todos = [makeTodo({ id: 9, title: 'Test task' })]
    const ctx = makeContext({ getTodos: () => todos })
    const results = searchDynamicCommands('test', ctx)
    const cmd = results.find(c => c.id === 'task-9')!
    cmd.action()
    expect(ctx.focusTask).toHaveBeenCalledWith(9)
  })

  it('searchDynamicCommands_emptyQuery_returnsEmpty', () => {
    const todos = [makeTodo({ id: 1, title: 'Something' })]
    const ctx = makeContext({ getTodos: () => todos })
    expect(searchDynamicCommands('', ctx)).toHaveLength(0)
  })

  it('searchDynamicCommands_noMatch_returnsEmpty', () => {
    const todos = [makeTodo({ id: 1, title: 'Something' })]
    const ctx = makeContext({ getTodos: () => todos })
    expect(searchDynamicCommands('zzz', ctx)).toHaveLength(0)
  })

  it('searchDynamicCommands_caseInsensitive_matchesRegardlessOfCase', () => {
    const todos = [makeTodo({ id: 1, title: 'Fix Login Bug' })]
    const ctx = makeContext({ getTodos: () => todos })
    expect(searchDynamicCommands('fix login', ctx)).toHaveLength(1)
  })
})

// ─── searchDynamicCommands — lazy project search ─────────────────────────────

describe('searchDynamicCommands — project search', () => {
  it('searchDynamicCommands_withMatchingQuery_returnsMatchingProjects', () => {
    const projects = [
      makeProject({ id: 1, canvasId: 1, name: 'Backend' }),
      makeProject({ id: 2, canvasId: 1, name: 'Frontend' }),
    ]
    const ctx = makeContext({ getProjects: () => projects })
    const results = searchDynamicCommands('back', ctx)
    expect(results.filter(c => c.category === 'projects')).toHaveLength(1)
  })

  it('searchDynamicCommands_withQuery_commandNameIsProjectName', () => {
    const projects = [makeProject({ id: 3, canvasId: 1, name: 'My Sprint' })]
    const ctx = makeContext({ getProjects: () => projects })
    const results = searchDynamicCommands('sprint', ctx)
    const cmd = results.find(c => c.id === 'project-3')!
    expect(cmd.name).toBe('My Sprint')
  })

  it('searchDynamicCommands_withQuery_actionCallsFocusProject', () => {
    const projects = [makeProject({ id: 4, canvasId: 1, name: 'Design' })]
    const ctx = makeContext({ getProjects: () => projects })
    const results = searchDynamicCommands('design', ctx)
    const cmd = results.find(c => c.id === 'project-4')!
    cmd.action()
    expect(ctx.focusProject).toHaveBeenCalledWith(4)
  })

  it('searchDynamicCommands_noMatchingProjects_returnsEmpty', () => {
    const projects = [makeProject({ id: 1, canvasId: 1, name: 'Backend' })]
    const ctx = makeContext({ getProjects: () => projects })
    expect(searchDynamicCommands('zzz', ctx).filter(c => c.category === 'projects')).toHaveLength(0)
  })
})

// ─── createCommands no longer includes dynamic commands ──────────────────────

describe('createCommands — no dynamic commands', () => {
  it('createCommands_withTodosAndProjects_doesNotIncludeDynamicCommands', () => {
    const ctx = makeContext({
      getTodos: () => [makeTodo({ id: 1 })],
      getProjects: () => [makeProject({ id: 1, canvasId: 1 })],
    })
    const commands = createCommands(ctx)
    expect(commands.filter(c => c.category === 'tasks')).toHaveLength(0)
    expect(commands.filter(c => c.category === 'projects')).toHaveLength(0)
  })
})
