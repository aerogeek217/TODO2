import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useToday } from '../../hooks/use-today'

/** One consumer: the day it reads, and how often it rendered. */
function Day({ name, renders }: { name: string; renders: Map<string, number> }) {
  const today = useToday()
  renders.set(name, (renders.get(name) ?? 0) + 1)
  return <span data-testid={name}>{today.getDate()}</span>
}

const day = (name: string) => screen.getByTestId(name).textContent

describe('useToday — one shared day (cr33 M10)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 16, 23, 59))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('every consumer reads the same Date, rolls over at midnight together, from one timer', () => {
    const renders = new Map<string, number>()
    const seen: Date[] = []
    function Probe() { seen.push(useToday()); return null }
    render(<><Day name="a" renders={renders} /><Day name="b" renders={renders} /><Probe /><Probe /></>)
    expect(day('a')).toBe('16')
    expect(seen.at(-1)).toBe(seen.at(-2))
    // One midnight timer however many rows read the day.
    expect(vi.getTimerCount()).toBe(1)
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(day('a')).toBe('16')
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(day('a')).toBe('17')
    expect(day('b')).toBe('17')
    expect(seen.at(-1)?.getTime()).toBe(new Date(2026, 3, 17).getTime())
    // Re-armed for the next midnight, still one.
    expect(vi.getTimerCount()).toBe(1)
    act(() => { vi.advanceTimersByTime(24 * 60 * 60_000) })
    expect(day('a')).toBe('18')
  })

  it('a consumer under a memo boundary re-renders on its own at midnight; nothing re-renders before', () => {
    const renders = new Map<string, number>()
    render(<Day name="row" renders={renders} />)
    const before = renders.get('row') ?? 0
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(renders.get('row')).toBe(before)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(renders.get('row')).toBe(before + 1)
  })

  it('the page coming back into view re-reads the day (a timer suspended while the machine slept)', () => {
    const renders = new Map<string, number>()
    render(<Day name="a" renders={renders} />)
    // The clock jumps past midnight with no timer run.
    vi.setSystemTime(new Date(2026, 3, 18, 9, 0))
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(day('a')).toBe('18')
  })

  it('the timer and listener go with the last consumer', () => {
    const remove = vi.spyOn(document, 'removeEventListener')
    const renders = new Map<string, number>()
    const { unmount } = render(<><Day name="a" renders={renders} /><Day name="b" renders={renders} /></>)
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  })
})
