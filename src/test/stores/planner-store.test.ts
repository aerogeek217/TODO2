import { describe, expect, it } from 'vitest'
import { plannerWindowKey, usePlannerStore } from '../../stores/planner-store'

/** A tab's window: this week until it moves it. */
const win = (tabId: string) => usePlannerStore.getState().windows[tabId] ?? { offset: 0 }

describe('planner-store', () => {
  it('starts every tab on this week', () => {
    expect(win('a')).toEqual({ offset: 0 })
  })

  it('shifts a tab by whole weeks, never before this week', () => {
    const { shift } = usePlannerStore.getState()
    shift('a', 1)
    shift('a', 1)
    expect(win('a').offset).toBe(14)
    expect(win('b').offset).toBe(0)
    shift('a', -1)
    expect(win('a').offset).toBe(7)
    shift('a', -1)
    shift('a', -1)
    expect(win('a').offset).toBe(0)
  })

  it('keeps the same state when a shift changes nothing', () => {
    const before = usePlannerStore.getState().windows
    usePlannerStore.getState().shift('a', -1)
    expect(usePlannerStore.getState().windows).toBe(before)
  })

  it('holds nothing but the offset: no day is picked', () => {
    usePlannerStore.getState().shift('a', 1)
    expect(win('a')).toEqual({ offset: 7 })
    expect(usePlannerStore.getState()).not.toHaveProperty('pick')
  })

  it('resets a tab to this week', () => {
    const { shift, reset } = usePlannerStore.getState()
    shift('a', 2)
    shift('b', 1)
    reset('a')
    expect(win('a')).toEqual({ offset: 0 })
    expect(win('b').offset).toBe(7)
  })

  it('keys a window by its layout and its tab: the same tab id in another layout is another window', () => {
    const { shift } = usePlannerStore.getState()
    expect(plannerWindowKey(1, 'p')).not.toBe(plannerWindowKey(2, 'p'))
    expect(plannerWindowKey(1, 'p')).not.toBe(plannerWindowKey(1, 'q'))
    // A tab id that holds the separator can't stand for another layout's tab.
    expect(plannerWindowKey(1, '2|p')).not.toBe(plannerWindowKey(12, 'p'))
    shift(plannerWindowKey(1, 'p'), 1)
    expect(win(plannerWindowKey(1, 'p')).offset).toBe(7)
    expect(win(plannerWindowKey(2, 'p')).offset).toBe(0)
    // No layout open (a widget drawn alone): the tab alone.
    expect(plannerWindowKey(undefined, 'p')).toBe(plannerWindowKey(null, 'p'))
    expect(plannerWindowKey(undefined, 'p')).not.toBe(plannerWindowKey(0, 'p'))
  })

  it('keeps only the windows of a layout’s Planner tabs; the other layouts’ stay', () => {
    const { shift, keep } = usePlannerStore.getState()
    shift(plannerWindowKey(1, 'p'), 1)
    shift(plannerWindowKey(1, 'q'), 2)
    shift(plannerWindowKey(2, 'q'), 3)
    shift(plannerWindowKey(11, 'q'), 1)
    keep(1, ['p'])
    expect(usePlannerStore.getState().windows).toEqual({
      [plannerWindowKey(1, 'p')]: { offset: 7 },
      [plannerWindowKey(2, 'q')]: { offset: 21 },
      [plannerWindowKey(11, 'q')]: { offset: 7 },
    })
    // Nothing to drop: the same state.
    const before = usePlannerStore.getState().windows
    keep(1, ['p', 'other'])
    keep(5, [])
    expect(usePlannerStore.getState().windows).toBe(before)
    keep(1, [])
    expect(win(plannerWindowKey(1, 'p')).offset).toBe(0)
    expect(win(plannerWindowKey(11, 'q')).offset).toBe(7)
  })

  it('is back at its start in the next test (the setup resets every store)', () => {
    expect(usePlannerStore.getState().windows).toEqual({})
  })
})
