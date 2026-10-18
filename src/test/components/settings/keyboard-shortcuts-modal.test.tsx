import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { KeyboardShortcutsModal } from '../../../components/settings/KeyboardShortcutsModal'
import { useSettingsStore } from '../../../stores/settings-store'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function stubPlatform(platform: string) {
  vi.stubGlobal('navigator', { platform } as Navigator)
}

/** The label shown beside a description in the list. */
function labelOf(description: string): string | null {
  return screen.getByText(description).previousElementSibling?.textContent ?? null
}

describe('KeyboardShortcutsModal', () => {
  it('renders ⌘-prefixed labels on Mac', () => {
    stubPlatform('MacIntel')
    render(<KeyboardShortcutsModal onClose={vi.fn()} />)
    expect(labelOf('Quick Add task')).toBe('⌘Space')
    expect(labelOf('Command Palette')).toBe('⌘K')
    expect(labelOf('Undo')).toBe('⌘Z')
    expect(labelOf('Redo')).toBe('⌘Y')
    expect(labelOf('Redo (alternative)')).toBe('⌘⇧Z')
    expect(labelOf('Select all visible tasks')).toBe('⌘A')
    expect(document.body.textContent).not.toContain('Ctrl+')
  })

  it('renders Ctrl+ prefixed labels on Windows', () => {
    stubPlatform('Win32')
    render(<KeyboardShortcutsModal onClose={vi.fn()} />)
    expect(labelOf('Quick Add task')).toBe('Ctrl+Space')
    expect(labelOf('Command Palette')).toBe('Ctrl+K')
    expect(labelOf('Redo (alternative)')).toBe('Ctrl+Shift+Z')
    expect(labelOf('Open Settings')).toBe('G then S')
    expect(labelOf('Bold')).toBe('Ctrl+B')
    expect(document.body.textContent).not.toContain('⌘')
  })

  it('shows the live keys of a changed binding', () => {
    stubPlatform('Win32')
    useSettingsStore.setState({
      shortcutOverrides: {
        'command-palette': [{ key: 'p', mod: true, shift: true }],
        'open-settings': [{ key: 'g' }, { key: 'o' }],
      },
    })
    render(<KeyboardShortcutsModal onClose={vi.fn()} />)
    expect(labelOf('Command Palette')).toBe('Ctrl+Shift+P')
    expect(labelOf('Open Settings')).toBe('G then O')
  })
})
