import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useKeyboardShortcuts } from '../../hooks/use-keyboard-shortcuts'
import { matchChord } from '../../services/keyboard-shortcuts'

function dispatchKey(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

describe('useKeyboardShortcuts — focus gating', () => {
  const noop = () => {}
  let options: Parameters<typeof useKeyboardShortcuts>[0]
  let createFloatingNote: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    createFloatingNote = vi.fn<() => void>()
    options = {
      openPalette: noop,
      closePalette: noop,
      navigate: noop,
      createFloatingNote,
    }
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('fires `n` → createFloatingNote when focus is on the body (no text field)', () => {
    renderHook(() => useKeyboardShortcuts(options))
    dispatchKey(window, 'n')
    expect(createFloatingNote).toHaveBeenCalledOnce()
  })

  it('does NOT fire `n` when focus is inside a contenteditable', () => {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    document.body.appendChild(editable)
    editable.focus()

    renderHook(() => useKeyboardShortcuts(options))
    dispatchKey(editable, 'n')
    expect(createFloatingNote).not.toHaveBeenCalled()
  })

  it('does NOT fire `n` when focus is inside [data-shortcut-scope="none"]', () => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-shortcut-scope', 'none')
    const child = document.createElement('span')
    child.tabIndex = 0
    wrapper.appendChild(child)
    document.body.appendChild(wrapper)
    child.focus()

    renderHook(() => useKeyboardShortcuts(options))
    dispatchKey(child, 'n')
    expect(createFloatingNote).not.toHaveBeenCalled()
  })

  it('does NOT fire `n` when focus is on a plain INPUT', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    renderHook(() => useKeyboardShortcuts(options))
    dispatchKey(input, 'n')
    expect(createFloatingNote).not.toHaveBeenCalled()
  })
})

describe('useKeyboardShortcuts — sequence chords (G then …)', () => {
  const noop = () => {}
  let navigate: ReturnType<typeof vi.fn<(path: string) => void>>

  beforeEach(() => {
    navigate = vi.fn<(path: string) => void>()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('G then L navigates to /list', () => {
    renderHook(() => useKeyboardShortcuts({ openPalette: noop, closePalette: noop, navigate }))
    dispatchKey(window, 'g')
    dispatchKey(window, 'l')
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/list')
  })

  it('G then C navigates to /', () => {
    renderHook(() => useKeyboardShortcuts({ openPalette: noop, closePalette: noop, navigate }))
    dispatchKey(window, 'g')
    dispatchKey(window, 'c')
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/')
  })

  it('G then unrelated key (e.g., x) does not navigate', () => {
    renderHook(() => useKeyboardShortcuts({ openPalette: noop, closePalette: noop, navigate }))
    dispatchKey(window, 'g')
    dispatchKey(window, 'x')
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('matchChord predicate', () => {
  function ev(init: KeyboardEventInit) {
    return new KeyboardEvent('keydown', init)
  }

  it('matches Mod-K via ctrlKey', () => {
    expect(matchChord(ev({ key: 'k', ctrlKey: true }), { key: 'k', mod: true })).toBe(true)
  })

  it('matches Mod-K via metaKey', () => {
    expect(matchChord(ev({ key: 'k', metaKey: true }), { key: 'k', mod: true })).toBe(true)
  })

  it('rejects Mod-K with extraneous shift when shift defaults to false', () => {
    expect(matchChord(ev({ key: 'k', ctrlKey: true, shiftKey: true }), { key: 'k', mod: true })).toBe(false)
  })

  it('matches both shift states when shiftAny is set', () => {
    expect(matchChord(ev({ key: 'ArrowUp', shiftKey: false }), { key: 'arrowup', shiftAny: true })).toBe(true)
    expect(matchChord(ev({ key: 'ArrowUp', shiftKey: true }), { key: 'arrowup', shiftAny: true })).toBe(true)
  })

  it('matches Mod-Shift-Z strictly', () => {
    expect(matchChord(ev({ key: 'z', ctrlKey: true, shiftKey: true }), { key: 'z', mod: true, shift: true })).toBe(true)
    expect(matchChord(ev({ key: 'z', ctrlKey: true, shiftKey: false }), { key: 'z', mod: true, shift: true })).toBe(false)
  })

  it('matches by code when useCode is true', () => {
    // Ctrl+Space: e.key is ' ', e.code is 'Space'.
    expect(matchChord(ev({ key: ' ', code: 'Space', ctrlKey: true }), { key: 'Space', useCode: true, mod: true })).toBe(true)
  })

  it('case-insensitive on letter keys', () => {
    expect(matchChord(ev({ key: 'F' }), { key: 'f' })).toBe(true)
  })
})
