import { describe, it, expect } from 'vitest'
import { activeMarkers, hasMarkers, isHotFilter, markersEqual, markersValue, matchesMarkers, toggleHot, toggleMarker, type MarkerSettings } from '../../utils/markers'
import { DEFAULT_HOT_RULE } from '../../utils/hot'

const today = new Date(2026, 9, 10)
const within = (urgentRange: number | null): MarkerSettings => ({ urgentRange, hotRule: DEFAULT_HOT_RULE })

describe('Markers filter helpers', () => {
  it('lists ticked markers in display order (Focus › Urgent › Important)', () => {
    expect(activeMarkers({ focus: true, urgent: true })).toEqual(['focus', 'urgent'])
    expect(activeMarkers(null)).toEqual([])
    expect(activeMarkers({})).toEqual([])
    expect(hasMarkers({})).toBe(false)
    expect(hasMarkers({ important: true })).toBe(true)
  })

  it('toggles a marker; unticking the last one is no filter', () => {
    expect(toggleMarker(null, 'focus')).toEqual({ focus: true })
    expect(toggleMarker({ focus: true }, 'urgent')).toEqual({ urgent: true, focus: true })
    expect(toggleMarker({ urgent: true, focus: true }, 'urgent')).toEqual({ focus: true })
    expect(toggleMarker({ focus: true }, 'focus')).toBeNull()
  })

  it('compares by the set of markers', () => {
    expect(markersEqual(null, undefined)).toBe(true)
    expect(markersEqual({}, null)).toBe(true)
    expect(markersEqual({ focus: true, urgent: true }, { urgent: true, focus: true })).toBe(true)
    expect(markersEqual({ focus: true }, { urgent: true })).toBe(false)
  })

  it('reads as the first marker +N', () => {
    expect(markersValue({ focus: true })).toBe('Focus')
    expect(markersValue({ important: true, focus: true })).toBe('Focus +1')
    expect(markersValue({ urgent: true, important: true, focus: true })).toBe('Focus +2')
    expect(markersValue(null)).toBe('')
  })

  it('a task must have every ticked marker; Urgent includes urgent by due date', () => {
    const base = { isCompleted: false }
    expect(matchesMarkers({ ...base, focus: true, important: true }, { focus: true, important: true }, today, within(3))).toBe(true)
    expect(matchesMarkers({ ...base, focus: true }, { focus: true, important: true }, today, within(3))).toBe(false)
    expect(matchesMarkers({ ...base, dueDate: new Date(2026, 9, 12) }, { urgent: true }, today, within(3))).toBe(true)
    expect(matchesMarkers({ ...base, dueDate: new Date(2026, 9, 12) }, { urgent: true }, today, within(1))).toBe(false)
    expect(matchesMarkers(base, null, today, within(3))).toBe(true)
  })

  it('Hot is its own choice: no single markers, narrows, reads "Hot"', () => {
    expect(isHotFilter('hot')).toBe(true)
    expect(isHotFilter({ urgent: true })).toBe(false)
    expect(activeMarkers('hot')).toEqual([])
    expect(hasMarkers('hot')).toBe(true)
    expect(markersValue('hot')).toBe('Hot')
  })

  it('ticking Hot replaces the single markers; unticking it is no filter', () => {
    expect(toggleHot(null)).toBe('hot')
    expect(toggleHot({ urgent: true, focus: true })).toBe('hot')
    expect(toggleHot('hot')).toBeNull()
  })

  it('single markers are disabled while Hot is ticked', () => {
    expect(toggleMarker('hot', 'urgent')).toBe('hot')
  })

  it('Hot only equals Hot', () => {
    expect(markersEqual('hot', 'hot')).toBe(true)
    expect(markersEqual('hot', null)).toBe(false)
    expect(markersEqual({ urgent: true, important: true }, 'hot')).toBe(false)
  })

  it('a Hot filter keeps hot tasks by the rule it is given', () => {
    const base = { isCompleted: false }
    expect(matchesMarkers({ ...base, focus: true }, 'hot', today, within(3))).toBe(true)
    expect(matchesMarkers({ ...base, important: true, dueDate: new Date(2026, 9, 12) }, 'hot', today, within(3))).toBe(true)
    expect(matchesMarkers({ ...base, important: true, dueDate: new Date(2026, 9, 12) }, 'hot', today, within(null))).toBe(false)
    expect(matchesMarkers({ ...base, focus: true }, 'hot', today, { urgentRange: 3, hotRule: [{ important: true }] })).toBe(false)
    expect(matchesMarkers({ isCompleted: true, focus: true }, 'hot', today, within(3))).toBe(false)
  })
})
