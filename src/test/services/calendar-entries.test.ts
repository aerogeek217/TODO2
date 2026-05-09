import { describe, it, expect } from 'vitest'
import { buildEntries } from '../../services/calendar-entries'
import { startOfDay, MS_PER_DAY } from '../../utils/date'
import { makeTodo } from '../helpers'

const today = startOfDay(new Date('2026-04-15T00:00:00')) // Wed
const days = Array.from({ length: 7 }, (_, i) =>
  startOfDay(new Date(today.getTime() + (i - 3) * MS_PER_DAY)),
)

describe('buildEntries (shared)', () => {
  it('places a precise-scheduled todo on its scheduled day', () => {
    const t = makeTodo({
      id: 1,
      scheduledDate: { kind: 'date', value: today },
    })
    const map = buildEntries([t], days, { today, weekStartsOn: 1, sortMode: 'sortOrder' })
    const entries = map.get(today.toISOString()) ?? []
    expect(entries.map((e) => e.todo.id)).toEqual([1])
    expect(entries[0]!.isVirtual).toBe(false)
  })

  it('places a deadline-only todo on its deadline day', () => {
    const t = makeTodo({ id: 1, dueDate: today })
    const map = buildEntries([t], days, { today, weekStartsOn: 1, sortMode: 'sortOrder' })
    const entries = map.get(today.toISOString()) ?? []
    expect(entries.map((e) => e.todo.id)).toEqual([1])
  })

  it('skips todos whose primary day is outside the visible range', () => {
    const farOff = startOfDay(new Date(today.getTime() + 30 * MS_PER_DAY))
    const t = makeTodo({ id: 1, dueDate: farOff })
    const map = buildEntries([t], days, { today, weekStartsOn: 1, sortMode: 'sortOrder' })
    expect([...map.values()].flat()).toHaveLength(0)
  })

  it('sortMode = effective sorts by effective date then sortOrder', () => {
    const day = today
    const a = makeTodo({ id: 1, scheduledDate: { kind: 'date', value: day }, sortOrder: 30 })
    const b = makeTodo({ id: 2, scheduledDate: { kind: 'date', value: day }, sortOrder: 10 })
    const map = buildEntries([a, b], days, { today, weekStartsOn: 1, sortMode: 'effective' })
    const entries = map.get(day.toISOString()) ?? []
    expect(entries.map((e) => e.todo.id)).toEqual([2, 1])
  })

  it('sortMode = sortOrder ignores effective date when sortOrder differs', () => {
    const earlier = startOfDay(new Date(today.getTime() - MS_PER_DAY))
    const later = today
    const a = makeTodo({ id: 1, scheduledDate: { kind: 'date', value: earlier }, sortOrder: 30 })
    const b = makeTodo({ id: 2, scheduledDate: { kind: 'date', value: later }, sortOrder: 10 })
    const map = buildEntries([a, b], days, { today, weekStartsOn: 1, sortMode: 'sortOrder' })
    // Each lands on a different day; sort within each day-bucket is by sortOrder
    expect(map.get(earlier.toISOString())?.[0]?.todo.id).toBe(1)
    expect(map.get(later.toISOString())?.[0]?.todo.id).toBe(2)
  })

  it('emits no entries for empty days array', () => {
    const t = makeTodo({ id: 1, dueDate: today })
    const map = buildEntries([t], [], { today, weekStartsOn: 1, sortMode: 'sortOrder' })
    expect(map.size).toBe(0)
  })

  it('places aged fuzzy this-week on the original week\'s window-end day, not the current week\'s', () => {
    // Regression for fuzzy-schedule-aging-2026-05-09: pre-P1, a fuzzy
    // `this-week` always resolved to the upcoming Sunday, pinning the card
    // to the current week's window-end. Post-P1 the resolution anchors on
    // `setAt`, so a "this-week" picked two weeks ago places on that week's
    // Sunday — which here is BEFORE the visible window (Wed today − 3 days).
    // Days array spans today − 3 .. today + 3 (Sun 4/12 .. Sat 4/18).
    // setAt 2026-04-01 (Wed) → Mon-first this-week ends Sun 4/5 (out of window).
    const setAt = new Date(2026, 3, 1)
    const t = makeTodo({
      id: 1,
      scheduledDate: { kind: 'fuzzy', token: 'this-week', setAt },
    })
    const map = buildEntries([t], days, { today, weekStartsOn: 1, sortMode: 'sortOrder' })
    expect([...map.values()].flat()).toHaveLength(0)
  })

  it('places fuzzy tomorrow stamped today on today + 1 (within the visible window)', () => {
    // Mirror of the aging regression above: a fresh-stamp fuzzy resolves
    // forward via resolveFuzzyOrigin(setAt=today), so 'tomorrow' lands on
    // today + 1 (Apr 16 = days[4]). Pre-P1 the same input would have
    // resolved against `today` and given the same answer; this test pins
    // the post-P1 setAt-anchored path produces a placement that's still in
    // window.
    const t = makeTodo({
      id: 1,
      scheduledDate: { kind: 'fuzzy', token: 'tomorrow', setAt: today },
    })
    const map = buildEntries([t], days, { today, weekStartsOn: 1, sortMode: 'sortOrder' })
    const tomorrow = days[4]! // today + 1
    const entries = map.get(tomorrow.toISOString()) ?? []
    expect(entries.map((e) => e.todo.id)).toEqual([1])
  })
})
