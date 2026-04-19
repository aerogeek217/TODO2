import { describe, it, expect, afterEach, vi } from 'vitest'
import { isMacLike, formatShortcut } from '../../utils/platform'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubPlatform(platform: string) {
  vi.stubGlobal('navigator', { platform } as Navigator)
}

describe('isMacLike', () => {
  it('returns true for MacIntel', () => {
    stubPlatform('MacIntel')
    expect(isMacLike()).toBe(true)
  })

  it('returns true for iPhone', () => {
    stubPlatform('iPhone')
    expect(isMacLike()).toBe(true)
  })

  it('returns false for Win32', () => {
    stubPlatform('Win32')
    expect(isMacLike()).toBe(false)
  })

  it('returns false for Linux', () => {
    stubPlatform('Linux x86_64')
    expect(isMacLike()).toBe(false)
  })
})

describe('formatShortcut', () => {
  it('renders ⌘T on Mac-like platforms', () => {
    stubPlatform('MacIntel')
    expect(formatShortcut('Mod-t')).toBe('⌘T')
  })

  it('renders Ctrl+T on Windows', () => {
    stubPlatform('Win32')
    expect(formatShortcut('Mod-t')).toBe('Ctrl+T')
  })

  it('renders multi-modifier combos with + separator on Windows', () => {
    stubPlatform('Win32')
    expect(formatShortcut('Mod-Shift-k')).toBe('Ctrl+Shift+K')
  })

  it('renders multi-modifier combos without separator on Mac', () => {
    stubPlatform('MacIntel')
    expect(formatShortcut('Mod-Shift-k')).toBe('⌘⇧K')
  })
})
