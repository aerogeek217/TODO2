import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useKeyboardShortcuts } from '../../hooks/use-keyboard-shortcuts'

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
