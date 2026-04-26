import { describe, it, expect, afterEach, vi } from 'vitest'
import { createCommands, type CommandContext } from '../../services/command-registry'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubPlatform(platform: string) {
  vi.stubGlobal('navigator', { platform } as Navigator)
}

function makeContext(): CommandContext {
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
    getTodos: vi.fn().mockReturnValue([]),
    getProjects: vi.fn().mockReturnValue([]),
    focusTask: vi.fn(),
    focusProject: vi.fn(),
  }
}

function shortcutFor(id: string): string | undefined {
  const cmds = createCommands(makeContext())
  return cmds.find(c => c.id === id)?.shortcut
}

describe('command-registry shortcut labels', () => {
  it('renders ⌘-prefixed Mod shortcuts on Mac', () => {
    stubPlatform('MacIntel')
    expect(shortcutFor('new-task')).toBe('⌘Space')
    expect(shortcutFor('select-all')).toBe('⌘A')
    expect(shortcutFor('redo')).toBe('⌘⇧Z')
  })

  it('renders Ctrl+ prefixed Mod shortcuts on Windows', () => {
    stubPlatform('Win32')
    expect(shortcutFor('new-task')).toBe('Ctrl+Space')
    expect(shortcutFor('select-all')).toBe('Ctrl+A')
    expect(shortcutFor('redo')).toBe('Ctrl+Shift+Z')
  })
})
