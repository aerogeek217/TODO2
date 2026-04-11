import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCommands } from '../../services/command-registry'
import type { CommandContext } from '../../services/command-registry'
import { Priority } from '../../models'
import { makeTodo, makeProject } from '../helpers'

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    navigateTo: vi.fn(),
    openQuickAdd: vi.fn(),
    selectionCount: 0,
    bulkSetCompleted: vi.fn().mockResolvedValue(undefined),
    bulkSetStarred: vi.fn().mockResolvedValue(undefined),
    bulkSetPriority: vi.fn().mockResolvedValue(undefined),
    bulkRemove: vi.fn().mockResolvedValue(undefined),
    getSelectedIds: vi.fn().mockReturnValue([]),
    toggleStarredOnly: vi.fn(),
    toggleHardDeadlineOnly: vi.fn(),
    setPriorities: vi.fn(),
    getPriorities: vi.fn().mockReturnValue(null),
    clearAllFilters: vi.fn(),
    toggleShowCompleted: vi.fn(),
    setDateRange: vi.fn(),
    todos: [],
    projects: [],
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
  it('createCommands_selectionCountOne_includesBulkCommands', () => {
    const ctx = makeContext({ selectionCount: 1, getSelectedIds: vi.fn().mockReturnValue([42]) })
    const commands = createCommands(ctx)
    const bulkIds = commands.filter(c => c.category === 'bulk').map(c => c.id)
    expect(bulkIds).toContain('bulk-complete')
    expect(bulkIds).toContain('bulk-uncomplete')
    expect(bulkIds).toContain('bulk-star')
    expect(bulkIds).toContain('bulk-unstar')
    expect(bulkIds).toContain('bulk-priority-high')
    expect(bulkIds).toContain('bulk-priority-medium')
    expect(bulkIds).toContain('bulk-priority-normal')
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

  it('createCommands_bulkPriorityHigh_actionCallsBulkSetPriorityHigh', () => {
    const selectedIds = [3]
    const ctx = makeContext({
      selectionCount: 1,
      getSelectedIds: vi.fn().mockReturnValue(selectedIds),
    })
    const commands = createCommands(ctx)
    const cmd = commands.find(c => c.id === 'bulk-priority-high')!
    cmd.action()
    expect(ctx.bulkSetPriority).toHaveBeenCalledWith(selectedIds, Priority.High)
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

// ─── filter-high command ──────────────────────────────────────────────────────

describe('createCommands — filter-high command', () => {
  it('createCommands_filterHigh_commandExists', () => {
    const ctx = makeContext()
    const commands = createCommands(ctx)
    expect(commands.some(c => c.id === 'filter-high')).toBe(true)
  })

  it('createCommands_filterHighNotActive_setsHighPriorityFilter', () => {
    // Arrange: no active priority filter
    const ctx = makeContext({ getPriorities: vi.fn().mockReturnValue(null) })
    const commands = createCommands(ctx)
    const cmd = commands.find(c => c.id === 'filter-high')!

    // Act
    cmd.action()

    // Assert: sets High priority
    expect(ctx.setPriorities).toHaveBeenCalledWith(new Set([Priority.High]))
  })

  it('createCommands_filterHighAlreadyHighOnly_clearsFilter', () => {
    // Arrange: already filtering by High only
    const highOnlySet = new Set([Priority.High])
    const ctx = makeContext({
      getPriorities: vi.fn().mockReturnValue(highOnlySet),
    })
    const commands = createCommands(ctx)
    const cmd = commands.find(c => c.id === 'filter-high')!

    // Act
    cmd.action()

    // Assert: clears the filter (sets null)
    expect(ctx.setPriorities).toHaveBeenCalledWith(null)
  })

  it('createCommands_filterHighWithMultiplePriorities_setsHighPriorityFilter', () => {
    // Arrange: filtering by High + Medium (not High-only)
    const multiSet = new Set([Priority.High, Priority.Medium])
    const ctx = makeContext({
      getPriorities: vi.fn().mockReturnValue(multiSet),
    })
    const commands = createCommands(ctx)
    const cmd = commands.find(c => c.id === 'filter-high')!

    // Act
    cmd.action()

    // Assert: replaces with High-only (since it wasn't High-only before)
    expect(ctx.setPriorities).toHaveBeenCalledWith(new Set([Priority.High]))
  })

  it('createCommands_filterHighWithMediumOnly_setsHighPriorityFilter', () => {
    // Arrange: filtering by Medium only (not High)
    const mediumOnlySet = new Set([Priority.Medium])
    const ctx = makeContext({
      getPriorities: vi.fn().mockReturnValue(mediumOnlySet),
    })
    const commands = createCommands(ctx)
    const cmd = commands.find(c => c.id === 'filter-high')!

    // Act
    cmd.action()

    // Assert: sets High priority filter
    expect(ctx.setPriorities).toHaveBeenCalledWith(new Set([Priority.High]))
  })
})

// ─── Dynamic task commands ────────────────────────────────────────────────────

describe('createCommands — dynamic task commands', () => {
  it('createCommands_withTodos_generatesOneCommandPerTodo', () => {
    const todos = [
      makeTodo({ id: 1 }),
      makeTodo({ id: 2 }),
      makeTodo({ id: 3 }),
    ]
    const ctx = makeContext({ todos })
    const commands = createCommands(ctx)
    const taskCmds = commands.filter(c => c.category === 'tasks')
    expect(taskCmds).toHaveLength(3)
  })

  it('createCommands_withTodos_commandIdsMatchTodoIds', () => {
    const todos = [makeTodo({ id: 7 }), makeTodo({ id: 42 })]
    const ctx = makeContext({ todos })
    const commands = createCommands(ctx)
    expect(commands.some(c => c.id === 'task-7')).toBe(true)
    expect(commands.some(c => c.id === 'task-42')).toBe(true)
  })

  it('createCommands_withTodos_commandNameIsTodoTitle', () => {
    const todos = [makeTodo({ id: 5, title: 'Write unit tests' })]
    const ctx = makeContext({ todos })
    const commands = createCommands(ctx)
    const cmd = commands.find(c => c.id === 'task-5')!
    expect(cmd.name).toBe('Write unit tests')
  })

  it('createCommands_withTodos_actionCallsFocusTask', () => {
    const todos = [makeTodo({ id: 9 })]
    const ctx = makeContext({ todos })
    const commands = createCommands(ctx)
    const cmd = commands.find(c => c.id === 'task-9')!
    cmd.action()
    expect(ctx.focusTask).toHaveBeenCalledWith(9)
  })

  it('createCommands_noTodos_generatesNoTaskCommands', () => {
    const ctx = makeContext({ todos: [] })
    const commands = createCommands(ctx)
    expect(commands.filter(c => c.category === 'tasks')).toHaveLength(0)
  })
})

// ─── Dynamic project commands ─────────────────────────────────────────────────

describe('createCommands — dynamic project commands', () => {
  it('createCommands_withProjects_generatesOneCommandPerProject', () => {
    const projects = [
      makeProject({ id: 1, canvasId: 1 }),
      makeProject({ id: 2, canvasId: 1 }),
    ]
    const ctx = makeContext({ projects })
    const commands = createCommands(ctx)
    const projCmds = commands.filter(c => c.category === 'projects')
    expect(projCmds).toHaveLength(2)
  })

  it('createCommands_withProjects_commandIdsMatchProjectIds', () => {
    const projects = [makeProject({ id: 11, canvasId: 1 })]
    const ctx = makeContext({ projects })
    const commands = createCommands(ctx)
    expect(commands.some(c => c.id === 'project-11')).toBe(true)
  })

  it('createCommands_withProjects_commandNameIsProjectName', () => {
    const projects = [makeProject({ id: 3, canvasId: 1, name: 'My Sprint' })]
    const ctx = makeContext({ projects })
    const commands = createCommands(ctx)
    const cmd = commands.find(c => c.id === 'project-3')!
    expect(cmd.name).toBe('My Sprint')
  })

  it('createCommands_withProjects_actionCallsFocusProject', () => {
    const projects = [makeProject({ id: 4, canvasId: 1 })]
    const ctx = makeContext({ projects })
    const commands = createCommands(ctx)
    const cmd = commands.find(c => c.id === 'project-4')!
    cmd.action()
    expect(ctx.focusProject).toHaveBeenCalledWith(4)
  })

  it('createCommands_noProjects_generatesNoProjectCommands', () => {
    const ctx = makeContext({ projects: [] })
    const commands = createCommands(ctx)
    expect(commands.filter(c => c.category === 'projects')).toHaveLength(0)
  })
})
