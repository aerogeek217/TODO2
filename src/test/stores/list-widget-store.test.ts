import { describe, it, expect } from 'vitest'
import type { FilterExpr } from '../../models'
import { REVIEW_POPUP_TAB_ID } from '../../models/review'
import { CLEARED_ON_REPLACE, reviewFilterKey, useListWidgetStore, type ReviewFilter } from '../../stores/list-widget-store'
import { reviewWidgetSession } from '../../stores/review-session'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { createTab, type PersistedWorkspaceLayout } from '../../models/workspace-layout'
import { single } from '../helpers/layout-builders'

const AT = new Date('2026-10-01T09:00:00.000Z')

function layout(id: number, tabIds: string[]): PersistedWorkspaceLayout {
  return {
    id, sortOrder: 0, name: `L${id}`, createdAt: AT, modifiedAt: AT,
    ...single({ id: 'k', tabs: tabIds.map((t) => createTab('lens', t, { listDefinitionId: 1 })) }),
  }
}

describe('list widget state of closed tabs', () => {
  it('a write drops the picks and collapsed groups of tabs in no layout; open and saved layouts keep theirs', () => {
    // Layout 1 is open, its working copy has a new tab; layout 2 is another saved layout.
    const saved = layout(1, ['saved-tab'])
    useWorkspaceStore.setState({ layouts: [saved, layout(2, ['other-layout-tab'])], working: layout(1, ['open-tab', 'saved-tab']), saved })
    useListWidgetStore.setState({
      picks: { 'gone-tab': [1], 'other-layout-tab': [2], 'saved-tab': [3] },
      collapsed: { 'gone-tab': ['a'], 'other-layout-tab': ['b'] },
    })

    useListWidgetStore.getState().setPicks('open-tab', [4])
    expect(useListWidgetStore.getState().picks).toEqual({ 'other-layout-tab': [2], 'saved-tab': [3], 'open-tab': [4] })

    useListWidgetStore.getState().toggleGroup('open-tab', 'today')
    expect(useListWidgetStore.getState().collapsed).toEqual({ 'other-layout-tab': ['b'], 'open-tab': ['today'] })
  })

  it('setCollapsed collapses exactly the given groups of a tab; an empty list expands them all (the row goes)', () => {
    useListWidgetStore.setState({ collapsed: { 'tab-a': ['x'] } })
    useListWidgetStore.getState().setCollapsed('tab-b', ['p1', 'p2', 'unassigned'])
    expect(useListWidgetStore.getState().collapsed).toEqual({ 'tab-a': ['x'], 'tab-b': ['p1', 'p2', 'unassigned'] })
    useListWidgetStore.getState().toggleGroup('tab-b', 'p1')
    expect(useListWidgetStore.getState().collapsed['tab-b']).toEqual(['p2', 'unassigned'])
    useListWidgetStore.getState().setCollapsed('tab-b', [])
    expect(useListWidgetStore.getState().collapsed).toEqual({ 'tab-a': ['x'] })
  })

  it('drops nothing before the workspace is open', () => {
    useListWidgetStore.setState({ picks: { 'tab-a': [1] } })
    useListWidgetStore.getState().setPicks('tab-b', [2])
    expect(useListWidgetStore.getState().picks).toEqual({ 'tab-a': [1], 'tab-b': [2] })
  })

  it('a Review filter set drops the reviews of tabs in no layout with their filters; the popup review’s stays', () => {
    const saved = layout(1, ['open-tab'])
    useWorkspaceStore.setState({ layouts: [saved], working: saved, saved })
    const gone = reviewWidgetSession('gone-tab')
    const open = reviewWidgetSession('open-tab')
    const popup = reviewWidgetSession(REVIEW_POPUP_TAB_ID)
    useListWidgetStore.getState().setReviewFilter('open-tab', AISHA)
    expect(reviewWidgetSession('open-tab')).toBe(open)
    expect(reviewWidgetSession(REVIEW_POPUP_TAB_ID)).toBe(popup)
    expect(reviewWidgetSession('gone-tab')).not.toBe(gone)
  })
})

const AISHA: ReviewFilter = { expression: { kind: 'person', id: 1 }, showCompleted: false }

describe('a tab id that is an object member’s name (M11: a stored id is any string)', () => {
  const HOSTILE = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']

  it('reads as absent in every record until it is set, and as what was set after', () => {
    for (const id of HOSTILE) {
      const s = useListWidgetStore.getState()
      expect(s.picks[id], id).toBeUndefined()
      expect(s.reviewFilters[id], id).toBeUndefined()
      expect(s.collapsed[id], id).toBeUndefined()
      expect(s.shown[id], id).toBeUndefined()
      expect(s.zoom[id], id).toBeUndefined()
    }
    for (const id of HOSTILE) {
      const s = useListWidgetStore.getState()
      // None of these throws or is a no-op (a prototype's member read as the tab's value).
      s.toggleGroup(id, 'today')
      s.setPicks(id, [3])
      s.setReviewFilter(id, AISHA)
      s.setShown(id, { listId: 1, label: 'L', description: '', grouped: false, sections: [] })
      s.setShownZoom(id, 'lines')
      const after = useListWidgetStore.getState()
      expect(after.collapsed[id], id).toEqual(['today'])
      expect(after.picks[id], id).toEqual([3])
      expect(after.reviewFilters[id], id).toEqual(AISHA)
      expect(after.shown[id]?.label, id).toBe('L')
      expect(after.zoom[id], id).toBe('lines')
    }
    // And each goes again.
    for (const id of HOSTILE) {
      const s = useListWidgetStore.getState()
      s.toggleGroup(id, 'today')
      s.setPicks(id, [])
      s.setReviewFilter(id, null)
      s.setShown(id, null)
      s.setShownZoom(id, null)
    }
    const end = useListWidgetStore.getState()
    for (const record of [end.picks, end.reviewFilters, end.collapsed, end.shown, end.zoom]) expect(Object.keys(record)).toEqual([])
  })

  it('also in a record put in from outside with a prototype (a test, an older caller)', () => {
    useListWidgetStore.setState({ collapsed: {}, reviewFilters: {}, shown: {}, zoom: {} })
    const s = useListWidgetStore.getState()
    expect(() => s.toggleGroup('constructor', 'today')).not.toThrow()
    expect(useListWidgetStore.getState().collapsed.constructor).toEqual(['today'])
    s.setShown('constructor', null)
    s.setShownZoom('toString', null)
    s.setReviewFilter('valueOf', null)
    expect(Object.keys(useListWidgetStore.getState().shown)).toEqual([])
  })
})

describe('a data replace (M5)', () => {
  it('clears what names ids the new data may reuse — prompt picks, Review filters, collapsed groups — and keeps what the widgets on screen wrote', () => {
    const s = useListWidgetStore.getState()
    s.setPicks('tab-a', [7])
    s.setReviewFilter('rv', AISHA)
    s.setReviewFilter(REVIEW_POPUP_TAB_ID, AISHA)
    s.setCollapsed('tab-a', ['person-7'])
    s.setShown('tab-a', { listId: 1, label: 'L', description: '', grouped: false, sections: [] })
    s.setShownZoom('tab-a', 'lines')
    useListWidgetStore.getState().resetForReplacedData()
    const after = useListWidgetStore.getState()
    expect(after.picks).toEqual({})
    expect(after.reviewFilters).toEqual({})
    expect(after.collapsed).toEqual({})
    expect(Object.keys(after.shown)).toEqual(['tab-a'])
    expect(after.zoom).toEqual({ 'tab-a': 'lines' })
  })

  it('every field of the store says whether a replace clears it: a new one has to be added to `CLEARED_ON_REPLACE`', () => {
    const fields = Object.entries(useListWidgetStore.getState()).filter(([, value]) => typeof value !== 'function').map(([key]) => key)
    expect(Object.keys(CLEARED_ON_REPLACE).sort()).toEqual(fields.sort())
  })
})

describe('reviewFilterKey: which review a filter is', () => {
  const p = (id: number): FilterExpr => ({ kind: 'person', id })
  it('the same filter built again, nested differently or re-printed is the same review; another filter is another', () => {
    expect(reviewFilterKey(null)).toBeNull()
    expect(reviewFilterKey(AISHA)).toBe(reviewFilterKey({ expression: p(1), showCompleted: false }))
    expect(reviewFilterKey({ expression: { kind: 'or', items: [p(1), { kind: 'or', items: [p(2)] }] }, showCompleted: false }))
      .toBe(reviewFilterKey({ expression: { kind: 'or', items: [p(1), p(2)] }, showCompleted: false }))
    expect(reviewFilterKey(AISHA)).not.toBe(reviewFilterKey({ expression: p(2), showCompleted: false }))
    expect(reviewFilterKey(AISHA)).not.toBe(reviewFilterKey({ expression: { kind: 'tag', id: 1 }, showCompleted: false }))
    // Every open task (a filter that prints as nothing) is a review, not none.
    expect(reviewFilterKey({ expression: { kind: 'and', items: [] }, showCompleted: false })).toBe('')
    // The field re-prints a day offset of 0 as `today`: still the same review.
    const dayRange = (end: FilterExpr) => reviewFilterKey({ expression: end, showCompleted: false })
    expect(dayRange({ kind: 'date', field: 'deadline', match: { match: 'range', start: null, end: { kind: 'offset', days: 0 } } }))
      .toBe(dayRange({ kind: 'date', field: 'deadline', match: { match: 'range', start: null, end: { kind: 'relative', token: 'today' } } }))
  })
})
