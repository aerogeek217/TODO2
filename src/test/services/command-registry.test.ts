import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCommands, searchDynamicCommands } from '../../services/command-registry'
import type { CommandContext } from '../../services/command-registry'
import { makeTodo } from '../helpers'
import { useUIStore } from '../../stores/ui-store'
import { useUndoStore } from '../../stores/undo-store'

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    shortcuts: { openPalette: vi.fn(), closePalette: vi.fn(), openSettings: vi.fn() },
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
    focusTask: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Navigation commands ─────────────────────────────────────────────────────

describe('createCommands — navigation commands', () => {
  it('createCommands_noSelection_includesOpenSettingsButNoWorkspaceNavigation', () => {
    const ctx = makeContext()
    const commands = createCommands(ctx)
    expect(commands.find(c => c.id === 'open-settings')?.name).toBe('Open Settings')
    expect(commands.some(c => c.id.startsWith('nav-'))).toBe(false)
  })

  it('createCommands_openSettings_actionOpensTheModal', () => {
    const ctx = makeContext()
    const commands = createCommands(ctx)
    const cmd = commands.find(c => c.id === 'open-settings')!
    cmd.action()
    expect(ctx.shortcuts.openSettings).toHaveBeenCalledOnce()
  })

  it('createCommands_noSelection_includesNewTaskCommand', () => {
    const ctx = makeContext()
    const commands = createCommands(ctx)
    const cmd = commands.find(c => c.id === 'new-task')!
    expect(cmd).toBeDefined()
    cmd.action()
    expect(useUIStore.getState().quickAddOpen).toBe(true)
  })

  it('createCommands_keyboardShortcuts_onlyWithTheModal_andOpensIt', () => {
    expect(createCommands(makeContext()).some(c => c.id === 'keyboard-shortcuts')).toBe(false)
    const openShortcutsModal = vi.fn()
    const ctx = makeContext({ shortcuts: { openPalette: vi.fn(), closePalette: vi.fn(), openSettings: vi.fn(), openShortcutsModal } })
    createCommands(ctx).find(c => c.id === 'keyboard-shortcuts')!.action()
    expect(openShortcutsModal).toHaveBeenCalledOnce()
  })

  it('createCommands_undoRedo_undoAndRedoTheLastEntry', async () => {
    let value = 0
    useUndoStore.getState().push({ description: 'Set value', undo: () => { value = 0 }, redo: () => { value = 1 } })
    value = 1
    const commands = createCommands(makeContext())
    commands.find(c => c.id === 'undo')!.action()
    await vi.waitFor(() => expect(value).toBe(0))
    commands.find(c => c.id === 'redo')!.action()
    await vi.waitFor(() => expect(value).toBe(1))
  })

  it('createCommands_focusSearch_focusesAndSelectsTheSearchField', () => {
    const input = document.createElement('input')
    input.setAttribute('data-search-input', '')
    input.value = 'old query'
    document.body.appendChild(input)
    try {
      createCommands(makeContext()).find(c => c.id === 'focus-search')!.action()
      expect(document.activeElement).toBe(input)
      expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'old query'.length])
    } finally {
      input.remove()
    }
  })

  it('createCommands_aFailingCommand_saysSoInTheSnackbar', async () => {
    const ctx = makeContext({ shortcuts: { openPalette: vi.fn(), closePalette: vi.fn(), openSettings: () => { throw new Error('boom') } } })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    createCommands(ctx).find(c => c.id === 'open-settings')!.action()
    await vi.waitFor(() => expect(useUndoStore.getState().snackbar?.description).toMatch(/Couldn't run/))
    error.mockRestore()
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
    expect(results.filter(c => c.category === 'search-results')).toHaveLength(2)
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


// ─── createCommands no longer includes dynamic commands ──────────────────────

describe('createCommands — no dynamic commands', () => {
  it('createCommands_withTodos_doesNotIncludeDynamicCommands', () => {
    const ctx = makeContext({
      getTodos: () => [makeTodo({ id: 1 })],
    })
    const commands = createCommands(ctx)
    expect(commands.filter(c => c.category === 'search-results')).toHaveLength(0)
  })
})

// ─── Email check-in commands ─────────────────────────────────────────────────

describe('createCommands — email check-ins', () => {
  const people = [
    { id: 1, name: 'Zoe Park', initials: 'ZP', email: 'zoe@example.com' },
    { id: 2, name: 'Ada Lovelace', initials: 'AL', email: 'ada@example.com' },
    { id: 3, name: 'No Email', initials: 'NE' },
    { id: 4, name: 'Idle Person', initials: 'IP', email: 'idle@example.com' },
    { id: 5, name: 'Blank Email', initials: 'BE', email: '' },
  ]
  const counts = new Map([[1, 1], [2, 4], [3, 2], [5, 3]])
  const emailCommands = (ctx: CommandContext) => createCommands(ctx).filter((c) => c.category === 'email')

  it('createCommands_people_onePerPersonWithOpenTasks_withOrWithoutEmail_byName_withOpenTaskHint', () => {
    const ctx = makeContext({
      openCheckinDialog: vi.fn(), sendPersonCheckin: vi.fn(), openCheckinImport: vi.fn(),
      getPeople: () => people, getOpenTaskCounts: () => counts,
    })
    expect(emailCommands(ctx).map((c) => [c.name, c.hint])).toEqual([
      ['Email task check-ins…', 'choose people'],
      ['Import check-in reply…', undefined],
      ['Email check-in: Ada Lovelace', '4 open tasks'],
      ['Email check-in: Blank Email', '3 open tasks'],
      ['Email check-in: No Email', '2 open tasks'],
      ['Email check-in: Zoe Park', '1 open task'],
    ])
  })

  it('createCommands_people_withCheckinFilter_hintCountsWhatItPicks_ofTheirOpenTasks', () => {
    const ctx = makeContext({
      sendPersonCheckin: vi.fn(), getPeople: () => people, getOpenTaskCounts: () => counts,
      getCheckinTaskCounts: () => new Map([[2, 1], [3, 2]]),
    })
    expect(emailCommands(ctx).map((c) => [c.name, c.hint])).toEqual([
      ['Email check-in: Ada Lovelace', '1 of 4 open tasks'],
      ['Email check-in: Blank Email', '0 of 3 open tasks'],
      ['Email check-in: No Email', '2 of 2 open tasks'],
      ['Email check-in: Zoe Park', '0 of 1 open task'],
    ])
  })

  it('createCommands_personCommand_sendsThatPersonsCheckin_noDialog', () => {
    const openCheckinDialog = vi.fn()
    const sendPersonCheckin = vi.fn()
    const ctx = makeContext({ openCheckinDialog, sendPersonCheckin, getPeople: () => people, getOpenTaskCounts: () => counts })
    createCommands(ctx).find((c) => c.id === 'email-checkin-2')!.action()
    expect(sendPersonCheckin).toHaveBeenCalledWith(2)
    expect(openCheckinDialog).not.toHaveBeenCalled()
  })

  it('createCommands_noOpenTaskCounts_noPersonCommands', () => {
    const ctx = makeContext({ openCheckinDialog: vi.fn(), sendPersonCheckin: vi.fn(), getPeople: () => people })
    expect(emailCommands(ctx).map((c) => c.id)).toEqual(['email-checkins'])
  })

  it('createCommands_withoutSendPersonCheckin_noPersonCommands', () => {
    const ctx = makeContext({ openCheckinDialog: vi.fn(), getPeople: () => people, getOpenTaskCounts: () => counts })
    expect(emailCommands(ctx).map((c) => c.id)).toEqual(['email-checkins'])
  })
})
