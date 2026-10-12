import { describe, it, expect } from 'vitest'
import { activeMarkers, hasMarkers, markersEqual, markersValue, matchesMarkers, toggleMarker } from '../../utils/markers'

const today = new Date(2026, 9, 10)

describe('Markers filter helpers', () => {
  it('lists ticked markers in display order (Urgent › Important › Focus)', () => {
    expect(activeMarkers({ focus: true, urgent: true })).toEqual(['urgent', 'focus'])
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
    expect(markersValue({ important: true, focus: true })).toBe('Important +1')
    expect(markersValue({ urgent: true, important: true, focus: true })).toBe('Urgent +2')
    expect(markersValue(null)).toBe('')
  })

  it('a task must have every ticked marker; Urgent includes urgent by due date', () => {
    const base = { isCompleted: false }
    expect(matchesMarkers({ ...base, focus: true, important: true }, { focus: true, important: true }, today, 3)).toBe(true)
    expect(matchesMarkers({ ...base, focus: true }, { focus: true, important: true }, today, 3)).toBe(false)
    expect(matchesMarkers({ ...base, dueDate: new Date(2026, 9, 12) }, { urgent: true }, today, 3)).toBe(true)
    expect(matchesMarkers({ ...base, dueDate: new Date(2026, 9, 12) }, { urgent: true }, today, 1)).toBe(false)
    expect(matchesMarkers(base, null, today, 3)).toBe(true)
  })
})
