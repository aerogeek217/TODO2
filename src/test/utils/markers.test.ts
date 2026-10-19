import { describe, it, expect } from 'vitest'
import { activeMarkers, hasExcludedMarker, hasMarkers, markerCondition, markerConditions, markerSummary, isHotFilter, markersEqual, markersTooltip, markersValue, matchesMarkers, priorityRank, toggleHot, withMarkerCondition, type MarkerSettings } from '../../utils/markers'
import { DEFAULT_HOT_RULE } from '../../utils/hot'

const today = new Date(2026, 9, 10)
const within = (urgentRange: number | null): MarkerSettings => ({ urgentRange, hotRule: DEFAULT_HOT_RULE })

describe('Priority filter helpers', () => {
  it('lists the tested markers (Yes or No) in display order (Focus › Urgent › Important)', () => {
    expect(activeMarkers({ focus: true, urgent: true })).toEqual(['focus', 'urgent'])
    expect(activeMarkers({ important: false, focus: true })).toEqual(['focus', 'important'])
    expect(activeMarkers(null)).toEqual([])
    expect(activeMarkers({})).toEqual([])
    expect(hasMarkers({})).toBe(false)
    expect(hasMarkers({ important: true })).toBe(true)
    expect(hasMarkers({ important: false })).toBe(true)
  })

  it('reads each marker as Yes (true), No (false) or Any (undefined)', () => {
    expect(markerCondition({ urgent: true, important: false }, 'urgent')).toBe(true)
    expect(markerCondition({ urgent: true, important: false }, 'important')).toBe(false)
    expect(markerCondition({ urgent: true }, 'focus')).toBeUndefined()
    expect(markerCondition('hot', 'urgent')).toBeUndefined()
    expect(markerConditions({ important: false, urgent: true })).toEqual({ urgent: true, important: false })
    expect(Object.keys(markerConditions({ important: false, focus: true }))).toEqual(['focus', 'important'])
  })

  it('sets a marker to Yes / No / Any; Any on the last one is no filter', () => {
    expect(withMarkerCondition(null, 'focus', true)).toEqual({ focus: true })
    expect(withMarkerCondition(null, 'important', false)).toEqual({ important: false })
    expect(withMarkerCondition({ focus: true }, 'urgent', false)).toEqual({ focus: true, urgent: false })
    expect(withMarkerCondition({ urgent: false, focus: true }, 'urgent', true)).toEqual({ focus: true, urgent: true })
    expect(withMarkerCondition({ urgent: true, focus: true }, 'urgent', undefined)).toEqual({ focus: true })
    expect(withMarkerCondition({ important: false }, 'important', undefined)).toBeNull()
  })

  it('compares by each marker condition', () => {
    expect(markersEqual(null, undefined)).toBe(true)
    expect(markersEqual({}, null)).toBe(true)
    expect(markersEqual({ focus: true, urgent: true }, { urgent: true, focus: true })).toBe(true)
    expect(markersEqual({ focus: true }, { urgent: true })).toBe(false)
    expect(markersEqual({ urgent: false }, { urgent: true })).toBe(false)
    expect(markersEqual({ urgent: false }, null)).toBe(false)
    expect(markersEqual({ urgent: false, focus: true }, { focus: true, urgent: false })).toBe(true)
  })

  it('reads every tested marker, a No one as `not <marker>`', () => {
    expect(markersValue({ focus: true })).toBe('Focus')
    expect(markersValue({ important: true, focus: true })).toBe('Focus, Important')
    expect(markersValue({ urgent: true, important: false })).toBe('Urgent, not Important')
    expect(markersValue({ urgent: true, important: false, focus: true })).toBe('Focus, Urgent, not Important')
    expect(markersValue({ urgent: false })).toBe('not Urgent')
    expect(markersValue(null)).toBe('')
  })

  it('spells out what a No hides in the tooltip; none without a No', () => {
    expect(markersTooltip({ urgent: true, important: false })).toBe('Priority: Urgent, not Important\nHides tasks that are Important')
    expect(markersTooltip({ urgent: false, focus: false })).toBe('Priority: not Focus, not Urgent\nHides tasks that are Focus or Urgent (flagged or due soon)')
    expect(markersTooltip({ urgent: true })).toBeNull()
    expect(markersTooltip('hot')).toBeNull()
    expect([hasExcludedMarker({ urgent: true, important: false }), hasExcludedMarker({ urgent: true }), hasExcludedMarker('hot'), hasExcludedMarker(null)]).toEqual([true, false, false, false])
    expect(markersTooltip(null)).toBeNull()
  })

  it('a task must have every Yes marker; Urgent includes urgent by due date', () => {
    const base = { isCompleted: false }
    expect(matchesMarkers({ ...base, focus: true, important: true }, { focus: true, important: true }, today, within(3))).toBe(true)
    expect(matchesMarkers({ ...base, focus: true }, { focus: true, important: true }, today, within(3))).toBe(false)
    expect(matchesMarkers({ ...base, dueDate: new Date(2026, 9, 12) }, { urgent: true }, today, within(3))).toBe(true)
    expect(matchesMarkers({ ...base, dueDate: new Date(2026, 9, 12) }, { urgent: true }, today, within(1))).toBe(false)
    expect(matchesMarkers(base, null, today, within(3))).toBe(true)
  })

  it('a task must have none of the No markers; Urgent No leaves out urgent by due date too', () => {
    const base = { isCompleted: false }
    const notImportant = { important: false }
    expect(matchesMarkers(base, notImportant, today, within(3))).toBe(true)
    expect(matchesMarkers({ ...base, important: true }, notImportant, today, within(3))).toBe(false)
    const notUrgent = { urgent: false }
    expect(matchesMarkers(base, notUrgent, today, within(3))).toBe(true)
    expect(matchesMarkers({ ...base, urgent: true }, notUrgent, today, within(3))).toBe(false)
    // Due in two days: urgent within 3 days (left out), not within 1 day (kept).
    expect(matchesMarkers({ ...base, dueDate: new Date(2026, 9, 12) }, notUrgent, today, within(3))).toBe(false)
    expect(matchesMarkers({ ...base, dueDate: new Date(2026, 9, 12) }, notUrgent, today, within(1))).toBe(true)
    // Overdue counts as urgent.
    expect(matchesMarkers({ ...base, dueDate: new Date(2026, 9, 1) }, notUrgent, today, within(0))).toBe(false)
    expect(matchesMarkers({ ...base, dueDate: new Date(2026, 9, 12) }, notUrgent, today, within(null))).toBe(true)
  })

  it('Yes and No markers AND together (Delegate: Urgent, not Important)', () => {
    const base = { isCompleted: false }
    const delegate = { urgent: true, important: false }
    expect(matchesMarkers({ ...base, urgent: true }, delegate, today, within(3))).toBe(true)
    expect(matchesMarkers({ ...base, urgent: true, important: true }, delegate, today, within(3))).toBe(false)
    expect(matchesMarkers({ ...base, important: false }, delegate, today, within(3))).toBe(false)
    expect(matchesMarkers({ ...base, dueDate: new Date(2026, 9, 11) }, delegate, today, within(3))).toBe(true)
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
    expect(toggleHot({ urgent: false })).toBe('hot')
    expect(toggleHot('hot')).toBeNull()
  })

  it('single markers are disabled while Hot is ticked', () => {
    expect(withMarkerCondition('hot', 'urgent', true)).toBe('hot')
    expect(withMarkerCondition('hot', 'urgent', false)).toBe('hot')
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

describe('markerSummary (the row gutter)', () => {
  const base = { isCompleted: false }
  it('names the markers in order Focus › Urgent › Important; no marker = No markers', () => {
    expect(markerSummary({ ...base, urgent: true, important: true, focus: true }, today, 3).label)
      .toBe('Priority: Focus, Urgent, Important')
    expect(markerSummary(base, today, 3)).toMatchObject({ label: 'No priority', focus: false, urgent: null, important: false })
  })

  it('urgent only by its due date: the ring, named and explained', () => {
    const s = markerSummary({ ...base, focus: true, dueDate: new Date(2026, 9, 12) }, today, 3)
    expect(s.urgent).toBe('date')
    expect(s.label).toBe('Priority: Focus, Urgent (due soon)')
    expect(s.tooltip).toBe('Priority: Focus, Urgent (due soon)\nDue Mon 12, within 3 days.')
    expect(markerSummary({ ...base, urgent: true, dueDate: new Date(2026, 9, 12) }, today, 3).urgent).toBe('flag')
    expect(markerSummary({ ...base, dueDate: new Date(2026, 9, 12) }, today, null).urgent).toBeNull()
  })
})

describe('priorityRank', () => {
  const base = { isCompleted: false }
  it('ranks Focus, Urgent + Important, Urgent, Important, none — Urgent by due date counts', () => {
    expect(priorityRank({ ...base, focus: true, important: true }, today, 3)).toBe(0)
    expect(priorityRank({ ...base, urgent: true, important: true }, today, 3)).toBe(1)
    expect(priorityRank({ ...base, dueDate: new Date(2026, 9, 12), important: true }, today, 3)).toBe(1)
    expect(priorityRank({ ...base, urgent: true }, today, 3)).toBe(2)
    expect(priorityRank({ ...base, important: true }, today, 3)).toBe(3)
    expect(priorityRank({ ...base, dueDate: new Date(2026, 9, 12) }, today, null)).toBe(4)
  })
})
