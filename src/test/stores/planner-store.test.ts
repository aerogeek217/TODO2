import { describe, expect, it } from 'vitest'
import { usePlannerStore } from '../../stores/planner-store'

/** A tab's window: this week with no day picked until it moves it. */
const win = (tabId: string) => usePlannerStore.getState().windows[tabId] ?? { offset: 0, picked: null }

describe('planner-store', () => {
  it('starts every tab on this week with no day picked', () => {
    expect(win('a')).toEqual({ offset: 0, picked: null })
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

  it('picks a day at its midnight, and clears it on the same day again', () => {
    const { pick } = usePlannerStore.getState()
    pick('a', new Date(2026, 10, 23, 15))
    expect(win('a').picked).toBe(new Date(2026, 10, 23).getTime())
    pick('a', new Date(2026, 10, 24))
    expect(win('a').picked).toBe(new Date(2026, 10, 24).getTime())
    pick('a', new Date(2026, 10, 24, 9))
    expect(win('a').picked).toBeNull()
    pick('a', new Date(2026, 10, 25))
    pick('a', null)
    expect(win('a').picked).toBeNull()
  })

  it('drops the pick when the window shifts', () => {
    const { pick, shift } = usePlannerStore.getState()
    pick('a', new Date(2026, 10, 23))
    shift('a', 1)
    expect(win('a')).toEqual({ offset: 7, picked: null })
  })

  it('resets a tab to this week', () => {
    const { pick, shift, reset } = usePlannerStore.getState()
    shift('a', 2)
    pick('a', new Date(2026, 11, 5))
    shift('b', 1)
    reset('a')
    expect(win('a')).toEqual({ offset: 0, picked: null })
    expect(win('b').offset).toBe(7)
  })

  it('is back at its start in the next test (the setup resets every store)', () => {
    expect(usePlannerStore.getState().windows).toEqual({})
  })
})
