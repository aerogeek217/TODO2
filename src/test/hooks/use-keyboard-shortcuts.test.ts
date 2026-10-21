import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useKeyboardShortcuts } from '../../hooks/use-keyboard-shortcuts'
import { useSettingsStore } from '../../stores/settings-store'
import { useUndoStore } from '../../stores/undo-store'

function dispatchKey(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

describe('useKeyboardShortcuts — focus gating', () => {
  const noop = () => {}
  let options: Parameters<typeof useKeyboardShortcuts>[0]
  let openShortcutsModal: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    openShortcutsModal = vi.fn<() => void>()
    options = {
      openPalette: noop,
      closePalette: noop,
      openSettings: noop,
      openShortcutsModal,
    }
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('fires `n` → openShortcutsModal when focus is on the body (no text field)', () => {
    renderHook(() => useKeyboardShortcuts(options))
    dispatchKey(window, '?')
    expect(openShortcutsModal).toHaveBeenCalledOnce()
  })

  it('does NOT fire `?` when focus is inside a contenteditable', () => {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    document.body.appendChild(editable)
    editable.focus()

    renderHook(() => useKeyboardShortcuts(options))
    dispatchKey(editable, '?')
    expect(openShortcutsModal).not.toHaveBeenCalled()
  })

  it('does NOT fire `?` when focus is inside [data-shortcut-scope="none"]', () => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-shortcut-scope', 'none')
    const child = document.createElement('span')
    child.tabIndex = 0
    wrapper.appendChild(child)
    document.body.appendChild(wrapper)
    child.focus()

    renderHook(() => useKeyboardShortcuts(options))
    dispatchKey(child, '?')
    expect(openShortcutsModal).not.toHaveBeenCalled()
  })

  it('fires Mod-K (allowed in text fields) inside [data-shortcut-scope="none"], but not inside a modal scope', () => {
    const openPalette = vi.fn<() => void>()
    renderHook(() => useKeyboardShortcuts({ ...options, openPalette }))
    const make = (scope: string) => {
      const wrapper = document.createElement('div')
      wrapper.setAttribute('data-shortcut-scope', scope)
      const input = document.createElement('input')
      wrapper.appendChild(input)
      document.body.appendChild(wrapper)
      return input
    }
    const plain = make('none')
    plain.focus()
    dispatchKey(plain, 'k', { ctrlKey: true })
    expect(openPalette).toHaveBeenCalledOnce()

    const inModal = make('modal')
    inModal.focus()
    dispatchKey(inModal, 'k', { ctrlKey: true })
    dispatchKey(inModal, '?')
    expect(openPalette).toHaveBeenCalledOnce()
    expect(openShortcutsModal).not.toHaveBeenCalled()
  })

  it('does NOT fire `?` when focus is on a plain INPUT', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    renderHook(() => useKeyboardShortcuts(options))
    dispatchKey(input, '?')
    expect(openShortcutsModal).not.toHaveBeenCalled()
  })
})

describe('useKeyboardShortcuts — sequence chords (G then …)', () => {
  const noop = () => {}
  let openSettings: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    openSettings = vi.fn<() => void>()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('G then S opens Settings', () => {
    renderHook(() => useKeyboardShortcuts({ openPalette: noop, closePalette: noop, openSettings }))
    dispatchKey(window, 'g')
    dispatchKey(window, 's')
    expect(openSettings).toHaveBeenCalledOnce()
  })

  it('G then W does nothing (the workspace is the only page)', () => {
    renderHook(() => useKeyboardShortcuts({ openPalette: noop, closePalette: noop, openSettings }))
    dispatchKey(window, 'g')
    dispatchKey(window, 'w')
    expect(openSettings).not.toHaveBeenCalled()
  })

  it('G on a select, a link or a button keeps its own use (type-ahead): not prevented; G then S still opens Settings', () => {
    renderHook(() => useKeyboardShortcuts({ openPalette: noop, closePalette: noop, openSettings }))
    for (const html of ['<select><option>General</option></select>', '<a href="#x">Link</a>', '<button type="button">Go</button>']) {
      document.body.innerHTML = html
      const el = document.body.firstElementChild as HTMLElement
      el.focus()
      const g = new KeyboardEvent('keydown', { key: 'g', bubbles: true, cancelable: true })
      el.dispatchEvent(g)
      expect(g.defaultPrevented).toBe(false)
      const s = new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true })
      el.dispatchEvent(s)
      expect(s.defaultPrevented).toBe(true)
    }
    expect(openSettings).toHaveBeenCalledTimes(3)
    // With nothing focused, G is taken at once.
    document.body.innerHTML = ''
    const g = new KeyboardEvent('keydown', { key: 'g', bubbles: true, cancelable: true })
    window.dispatchEvent(g)
    expect(g.defaultPrevented).toBe(true)
  })

  it('a shortcut whose handler fails says so in the snackbar', async () => {
    const failing = vi.fn<() => void>(() => { throw new Error('boom') })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderHook(() => useKeyboardShortcuts({ openPalette: noop, closePalette: noop, openSettings: failing }))
    dispatchKey(window, 'g')
    dispatchKey(window, 's')
    await vi.waitFor(() => expect(useUndoStore.getState().snackbar).toMatchObject({ notice: true, description: expect.stringMatching(/^Couldn't run “.+”\.$/) }))
    expect(failing).toHaveBeenCalledOnce()
    error.mockRestore()
  })

  it('G then unrelated key (e.g., x) does not open Settings', () => {
    renderHook(() => useKeyboardShortcuts({ openPalette: noop, closePalette: noop, openSettings }))
    dispatchKey(window, 'g')
    dispatchKey(window, 'x')
    expect(openSettings).not.toHaveBeenCalled()
  })
})

describe('useKeyboardShortcuts — user bindings', () => {
  const noop = () => {}

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('fires a binding on its new keys and no longer on its default', () => {
    const openPalette = vi.fn<() => void>()
    useSettingsStore.setState({ shortcutOverrides: { 'command-palette': [{ key: 'p', mod: true, shift: true }] } })
    renderHook(() => useKeyboardShortcuts({ openPalette, closePalette: noop, openSettings: noop }))
    dispatchKey(window, 'k', { ctrlKey: true })
    expect(openPalette).not.toHaveBeenCalled()
    dispatchKey(window, 'P', { ctrlKey: true, shiftKey: true })
    expect(openPalette).toHaveBeenCalledOnce()
  })

  it('follows a rebound sequence, and a binding changed while mounted', () => {
    const openSettings = vi.fn<() => void>()
    renderHook(() => useKeyboardShortcuts({ openPalette: noop, closePalette: noop, openSettings }))
    useSettingsStore.setState({ shortcutOverrides: { 'open-settings': [{ key: 'g' }, { key: 'o' }] } })
    dispatchKey(window, 'g')
    dispatchKey(window, 's')
    expect(openSettings).not.toHaveBeenCalled()
    dispatchKey(window, 'g')
    dispatchKey(window, 'o')
    expect(openSettings).toHaveBeenCalledOnce()
  })

  it('fires a binding moved onto a single key', () => {
    const openShortcutsModal = vi.fn<() => void>()
    useSettingsStore.setState({ shortcutOverrides: { 'show-shortcuts': [{ key: 'h' }] } })
    renderHook(() => useKeyboardShortcuts({ openPalette: noop, closePalette: noop, openSettings: noop, openShortcutsModal }))
    dispatchKey(window, '?')
    expect(openShortcutsModal).not.toHaveBeenCalled()
    dispatchKey(window, 'h')
    expect(openShortcutsModal).toHaveBeenCalledOnce()
  })
})
