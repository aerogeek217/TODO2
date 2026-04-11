import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useClickOutside } from '../../hooks/use-click-outside'

describe('useClickOutside', () => {
  let callback: () => void

  beforeEach(() => {
    callback = vi.fn()
  })

  it('calls callback when mousedown fires outside the ref element', () => {
    // Arrange
    const inner = document.createElement('div')
    const ref = { current: inner }

    renderHook(() => useClickOutside(ref, callback, true))

    // Act — click on an unrelated element outside the ref
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    document.body.removeChild(outside)

    // Assert
    expect(callback).toHaveBeenCalledOnce()
  })

  it('does NOT call callback when mousedown fires inside the ref element', () => {
    // Arrange
    const container = document.createElement('div')
    const child = document.createElement('span')
    container.appendChild(child)
    document.body.appendChild(container)
    const ref = { current: container }

    renderHook(() => useClickOutside(ref, callback, true))

    // Act — click on a child element inside the ref
    child.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    // Assert
    expect(callback).not.toHaveBeenCalled()

    document.body.removeChild(container)
  })

  it('does NOT call callback when mousedown fires on the ref element itself', () => {
    // Arrange
    const el = document.createElement('div')
    document.body.appendChild(el)
    const ref = { current: el }

    renderHook(() => useClickOutside(ref, callback, true))

    // Act — click directly on the ref element
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    // Assert
    expect(callback).not.toHaveBeenCalled()

    document.body.removeChild(el)
  })

  it('does NOT add a listener and never calls callback when active is false', () => {
    // Arrange
    const ref = { current: document.createElement('div') }
    const addSpy = vi.spyOn(document, 'addEventListener')

    renderHook(() => useClickOutside(ref, callback, false))

    // Act — fire a mousedown on the document
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    // Assert — no listener registered for mousedown, callback never called
    const mousedownCalls = addSpy.mock.calls.filter(([type]) => type === 'mousedown')
    expect(mousedownCalls).toHaveLength(0)
    expect(callback).not.toHaveBeenCalled()

    addSpy.mockRestore()
  })

  it('removes the listener when active transitions from true to false', () => {
    // Arrange
    const el = document.createElement('div')
    document.body.appendChild(el)
    const ref = { current: el }
    const removeSpy = vi.spyOn(document, 'removeEventListener')

    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useClickOutside(ref, callback, active),
      { initialProps: { active: true } },
    )

    // Act — toggle active off, triggering cleanup
    rerender({ active: false })

    // Assert — removeEventListener called for mousedown
    const mousedownRemovals = removeSpy.mock.calls.filter(([type]) => type === 'mousedown')
    expect(mousedownRemovals.length).toBeGreaterThan(0)

    // And no callback fires for a subsequent outside click
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(callback).not.toHaveBeenCalled()

    document.body.removeChild(outside)
    document.body.removeChild(el)
    removeSpy.mockRestore()
  })

  it('removes the listener on unmount', () => {
    // Arrange
    const ref = { current: document.createElement('div') }
    const removeSpy = vi.spyOn(document, 'removeEventListener')

    const { unmount } = renderHook(() => useClickOutside(ref, callback, true))

    // Act
    unmount()

    // Assert
    const mousedownRemovals = removeSpy.mock.calls.filter(([type]) => type === 'mousedown')
    expect(mousedownRemovals.length).toBeGreaterThan(0)

    removeSpy.mockRestore()
  })

  it('does NOT call callback when ref.current is null', () => {
    // Arrange
    const ref = { current: null }

    renderHook(() => useClickOutside(ref, callback, true))

    // Act — fire outside click (ref has no element to compare against)
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    // Assert
    expect(callback).not.toHaveBeenCalled()
  })
})
