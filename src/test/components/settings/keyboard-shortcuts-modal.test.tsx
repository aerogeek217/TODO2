import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { KeyboardShortcutsModal } from '../../../components/settings/KeyboardShortcutsModal'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function stubPlatform(platform: string) {
  vi.stubGlobal('navigator', { platform } as Navigator)
}

describe('KeyboardShortcutsModal', () => {
  it('renders ⌘-prefixed labels on Mac and never spells redo as ⌘⇧Z', () => {
    stubPlatform('MacIntel')
    const { container } = render(<KeyboardShortcutsModal onClose={vi.fn()} />)
    const text = container.textContent ?? ''

    expect(text).toContain('⌘Space')
    expect(text).toContain('⌘K')
    expect(text).toContain('⌘Z')
    expect(text).toContain('⌘Y')
    expect(text).toContain('⌘A')
    expect(text).not.toContain('⌘⇧Z')
    expect(text).not.toContain('Ctrl+')
  })

  it('renders Ctrl+ prefixed labels on Windows and never spells redo as Ctrl+Shift+Z', () => {
    stubPlatform('Win32')
    const { container } = render(<KeyboardShortcutsModal onClose={vi.fn()} />)
    const text = container.textContent ?? ''

    expect(text).toContain('Ctrl+Space')
    expect(text).toContain('Ctrl+K')
    expect(text).toContain('Ctrl+Z')
    expect(text).toContain('Ctrl+Y')
    expect(text).toContain('Ctrl+A')
    expect(text).not.toContain('Ctrl+Shift+Z')
    expect(text).not.toContain('⌘')
  })
})
