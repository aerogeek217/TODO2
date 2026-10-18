import { describe, it, expect, afterEach, vi } from 'vitest'
import { createCommands, type CommandContext } from '../../services/command-registry'
import { useSettingsStore } from '../../stores/settings-store'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubPlatform(platform: string) {
  vi.stubGlobal('navigator', { platform } as Navigator)
}

function makeContext(): CommandContext {
  return {
    openSettings: vi.fn(),
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
    focusTask: vi.fn(),
    openShortcutsModal: vi.fn(),
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
    expect(shortcutFor('redo')).toBe('⌘Y')
  })

  it('renders Ctrl+ prefixed Mod shortcuts on Windows', () => {
    stubPlatform('Win32')
    expect(shortcutFor('new-task')).toBe('Ctrl+Space')
    expect(shortcutFor('select-all')).toBe('Ctrl+A')
    expect(shortcutFor('redo')).toBe('Ctrl+Y')
    expect(shortcutFor('open-settings')).toBe('G then S')
    expect(shortcutFor('keyboard-shortcuts')).toBe('?')
  })

  it('shows the live keys of changed bindings', () => {
    stubPlatform('Win32')
    useSettingsStore.setState({
      shortcutOverrides: {
        'quick-add': [{ key: 'Space', mod: true, shift: true }],
        'open-settings': [{ key: 'g' }, { key: 'o' }],
        'focus-filters': [{ key: 'f', shift: true }],
      },
    })
    expect(shortcutFor('new-task')).toBe('Ctrl+Shift+Space')
    expect(shortcutFor('open-settings')).toBe('G then O')
    expect(shortcutFor('focus-filter')).toBe('Shift+F')
  })
})
