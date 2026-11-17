import { describe, it, expect, vi, afterEach } from 'vitest'
import { watchDragRelease } from '../../../components/workspace/drag-release'

describe('watchDragRelease', () => {
  let stop: (() => void) | null = null
  afterEach(() => {
    stop?.()
    stop = null
    vi.useRealTimers()
  })

  it.each([
    ['a release', () => window.dispatchEvent(new Event('pointerup'))],
    ['a pointer cancel', () => window.dispatchEvent(new Event('pointercancel'))],
    ['Esc', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    ['a resize', () => window.dispatchEvent(new Event('resize'))],
  ])('ends a drag still on after %s, once the event is over', (_name, fire) => {
    vi.useFakeTimers()
    const orphaned = vi.fn()
    stop = watchDragRelease(() => true, orphaned)
    fire()
    expect(orphaned).not.toHaveBeenCalled() // dnd-kit has its turn first
    vi.runAllTimers()
    expect(orphaned).toHaveBeenCalledTimes(1)
  })

  it('leaves a drag dnd-kit already ended alone', () => {
    vi.useFakeTimers()
    let on = true
    const orphaned = vi.fn()
    stop = watchDragRelease(() => on, orphaned)
    window.dispatchEvent(new Event('pointerup'))
    on = false // dnd-kit's end handler ran inside the release
    vi.runAllTimers()
    expect(orphaned).not.toHaveBeenCalled()
  })

  it('ignores other keys, and nothing reaches it once stopped', () => {
    vi.useFakeTimers()
    const orphaned = vi.fn()
    stop = watchDragRelease(() => true, orphaned)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    vi.runAllTimers()
    expect(orphaned).not.toHaveBeenCalled()
    stop()
    window.dispatchEvent(new Event('pointerup'))
    vi.runAllTimers()
    expect(orphaned).not.toHaveBeenCalled()
  })
})
