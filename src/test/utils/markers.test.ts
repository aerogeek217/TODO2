import { describe, it, expect } from 'vitest'
import { MARKER_CLAUSES_MAX } from '../../models'
import { activeMarkers, hasMarkers, markerClauseOfIds, markerConditions, markerPickerIds, markersEqual, markerSummary, matchesMarkerClause, normalizeMarkersFilter, priorityRank, withMarkerClause, type MarkerFields, type MarkerSettings } from '../../utils/markers'

const today = new Date(2026, 9, 10)
const open = (t: object): MarkerFields => ({ isCompleted: false, ...t })
const within = (urgentRange: number | null): MarkerSettings => ({ urgentRange })

describe('Priority filter helpers', () => {
  it('a filter narrows while a condition names something', () => {
    expect(hasMarkers(null)).toBe(false)
    expect(hasMarkers([])).toBe(false)
    expect(hasMarkers([{ values: [] }])).toBe(false)
    expect(hasMarkers([{ values: ['important'] }])).toBe(true)
    expect(hasMarkers([{ values: ['none'], not: true }])).toBe(true)
  })

  it('normalises: values once, in display order; an empty condition goes; none left is null', () => {
    expect(normalizeMarkersFilter([{ values: ['none', 'important', 'focus', 'important'] }])).toEqual([{ values: ['focus', 'important', 'none'] }])
    expect(normalizeMarkersFilter([{ values: [] }, { values: ['urgent'], not: true }])).toEqual([{ values: ['urgent'], not: true }])
    expect(normalizeMarkersFilter([{ values: [] }])).toBeNull()
    expect(normalizeMarkersFilter(null)).toBeNull()
    expect(normalizeMarkersFilter(Array.from({ length: MARKER_CLAUSES_MAX + 2 }, () => ({ values: ['focus' as const] })))).toHaveLength(MARKER_CLAUSES_MAX)
  })

  it('replaces, adds and removes a condition, the later ones moving up', () => {
    const two = [{ values: ['focus' as const] }, { values: ['urgent' as const] }]
    expect(withMarkerClause(two, 1, { values: ['important'] })).toEqual([{ values: ['focus'] }, { values: ['important'] }])
    expect(withMarkerClause(two, 2, { values: ['important'] })).toHaveLength(3)
    expect(withMarkerClause(two, 0, null)).toEqual([{ values: ['urgent'] }])
    expect(withMarkerClause([{ values: ['focus'] }], 0, null)).toBeNull()
    expect(withMarkerClause(null, 0, { values: ['focus'] })).toEqual([{ values: ['focus'] }])
  })

  it('compares what the conditions ask, in any order', () => {
    expect(markersEqual(null, [])).toBe(true)
    expect(markersEqual([{ values: ['urgent', 'focus'] }], [{ values: ['focus', 'urgent'] }])).toBe(true)
    expect(markersEqual([{ values: ['urgent'] }], [{ values: ['urgent'], not: true }])).toBe(false)
    expect(markersEqual([{ values: ['urgent'] }, { values: ['focus'] }], [{ values: ['focus', 'urgent'] }])).toBe(false)
  })

  it('what a filter implies: a one-value is sets, an is not clears, several values or No priority imply nothing', () => {
    expect(markerConditions(null)).toEqual({})
    expect(markerConditions([{ values: ['urgent'] }])).toEqual({ urgent: true })
    expect(markerConditions([{ values: ['urgent', 'important'] }])).toEqual({})
    expect(markerConditions([{ values: ['none'] }])).toEqual({})
    expect(markerConditions([{ values: ['urgent', 'none'], not: true }])).toEqual({ urgent: false })
    expect(Object.keys(markerConditions([{ values: ['important'], not: true }, { values: ['focus'] }]))).toEqual(['focus', 'important'])
    expect(activeMarkers({ important: false, focus: true })).toEqual(['focus', 'important'])
    expect(activeMarkers(null)).toEqual([])
  })

  it('a condition reads the picker\'s ids and back', () => {
    const c = { values: ['urgent' as const, 'none' as const], not: true as const }
    const ids = markerPickerIds(c)
    expect(ids.has(0)).toBe(true)
    expect(ids.size).toBe(2)
    expect(markerClauseOfIds(ids, true)?.not).toBe(true)
    expect(new Set(markerClauseOfIds(ids, true)?.values)).toEqual(new Set(['urgent', 'none']))
    expect(markerClauseOfIds([], false)).toBeNull()
  })

  it('is: any of the values; Urgent includes urgent by due date', () => {
    const task = { urgent: true }
    expect(matchesMarkerClause(open(task), { values: ['urgent', 'important'] }, today, within(3))).toBe(true)
    expect(matchesMarkerClause(open({ important: true }), { values: ['urgent', 'important'] }, today, within(3))).toBe(true)
    expect(matchesMarkerClause(open({}), { values: ['urgent', 'important'] }, today, within(3))).toBe(false)
    const dueSoon = { dueDate: new Date(2026, 9, 11) }
    expect(matchesMarkerClause(open(dueSoon), { values: ['urgent'] }, today, within(3))).toBe(true)
    expect(matchesMarkerClause(open(dueSoon), { values: ['urgent'] }, today, within(null))).toBe(false)
  })

  it('is not: none of the values; is not Urgent leaves out urgent by due date too', () => {
    expect(matchesMarkerClause(open({ focus: true }), { values: ['urgent', 'important'], not: true }, today, within(3))).toBe(true)
    expect(matchesMarkerClause(open({ important: true }), { values: ['urgent', 'important'], not: true }, today, within(3))).toBe(false)
    expect(matchesMarkerClause(open({ dueDate: new Date(2026, 9, 11) }), { values: ['urgent'], not: true }, today, within(3))).toBe(false)
  })

  it('No priority: a task with no marker, effective Urgent counted', () => {
    expect(matchesMarkerClause(open({}), { values: ['none'] }, today, within(3))).toBe(true)
    expect(matchesMarkerClause(open({ focus: true }), { values: ['none'] }, today, within(3))).toBe(false)
    expect(matchesMarkerClause(open({ dueDate: new Date(2026, 9, 11) }), { values: ['none'] }, today, within(3))).toBe(false)
    expect(matchesMarkerClause(open({ focus: true }), { values: ['none'], not: true }, today, within(3))).toBe(true)
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
