import { describe, expect, it } from 'vitest'
import { fitTabs, shownTabs, type TabSize } from '../../utils/tab-strip-fit'

const tab = (id: string, natural: number, min = natural): TabSize => ({ id, natural, min })
const GAP = 2
const OVERFLOW = 50

describe('fitTabs', () => {
  const tabs = [tab('a', 100, 70), tab('b', 120, 70), tab('c', 90, 70), tab('d', 140, 70)]
  const full = 100 + 120 + 90 + 140 + 3 * GAP // 456
  const shrunk = 4 * 70 + 3 * GAP // 286

  it('shows every tab at full width while they fit', () => {
    expect(fitTabs(tabs, 'a', full, OVERFLOW, GAP)).toEqual({ count: 4, shrink: false })
    expect(fitTabs(tabs, 'a', 2000, OVERFLOW, GAP)).toEqual({ count: 4, shrink: false })
  })

  it('shrinks them as soon as they need a pixel more than the room', () => {
    expect(fitTabs(tabs, 'a', full - 0.5, OVERFLOW, GAP)).toEqual({ count: 4, shrink: true })
  })

  it('shrinks every tab before folding any into +N', () => {
    expect(fitTabs(tabs, 'a', shrunk, OVERFLOW, GAP)).toEqual({ count: 4, shrink: true })
  })

  it('folds the last tabs when even shrunk they do not fit, leaving room for the +N button', () => {
    // 3 shrunk tabs (214) beside the +N button (50) need 264.
    expect(fitTabs(tabs, 'a', 264, OVERFLOW, GAP)).toEqual({ count: 3, shrink: true })
    expect(fitTabs(tabs, 'a', 263, OVERFLOW, GAP)).toEqual({ count: 2, shrink: true })
  })

  it('counts the active tab among the shown ones when it is past them', () => {
    const wide = [tab('a', 80, 60), tab('b', 80, 60), tab('c', 200)]
    // Shown: a + c (the active one, which never shrinks) = 262, + the button = 312.
    expect(fitTabs(wide, 'c', 312, OVERFLOW, GAP)).toEqual({ count: 2, shrink: true })
    expect(fitTabs(wide, 'c', 311, OVERFLOW, GAP)).toEqual({ count: 1, shrink: true })
  })

  it('shows no tab when not even one fits', () => {
    expect(fitTabs(tabs, 'a', 60, OVERFLOW, GAP)).toEqual({ count: 0, shrink: false })
  })

  it('an empty strip fits', () => {
    expect(fitTabs([], undefined, 0, OVERFLOW, GAP)).toEqual({ count: 0, shrink: false })
  })
})

describe('shownTabs', () => {
  const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  it('the first ones when the active tab is among them', () => {
    expect(shownTabs(tabs, 'b', 2).map((t) => t.id)).toEqual(['a', 'b'])
  })
  it('the active tab takes the last place when it is past them', () => {
    expect(shownTabs(tabs, 'd', 2).map((t) => t.id)).toEqual(['a', 'd'])
    expect(shownTabs(tabs, 'd', 1).map((t) => t.id)).toEqual(['d'])
  })
  it('none for a count of 0', () => {
    expect(shownTabs(tabs, 'd', 0)).toEqual([])
  })
})
