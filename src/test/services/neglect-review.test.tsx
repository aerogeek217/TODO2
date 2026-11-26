import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useStatsBase } from '../../hooks/use-glance-data'
import { useReviewWidgetQueue } from '../../hooks/use-review-widget-queue'
import type { Tag } from '../../models'
import { REVIEW_POPUP_TAB_ID } from '../../models/review'
import { neglectZoneReviewFilter, type NeglectReviewZone } from '../../services/review'
import { jumpToPopupReview } from '../../services/review-jump'
import { useListWidgetStore } from '../../stores/list-widget-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { printExpression } from '../../utils/filter-expression'
import { buildNeglectMap } from '../../utils/neglect-map'
import { clearFilterStore, makeTodo, patchScreenFilter, resetEntityStores } from '../helpers'

/**
 * A Neglect map zone's Review: the zone written as an expression in the
 * words that read Settings, the tab's hidden statuses left out, opened in
 * the popup review. Its queue is the map's count: both start from the
 * screen-filtered tasks (`useStatsBase().shown`).
 */

const PARKED = { id: 4, name: 'Parked', color: '#8a8a8a', sortOrder: 1 }
const WAITING = { id: 2, name: 'Waiting', color: '#a070e0', sortOrder: 2 }
const names = {
  person: () => undefined,
  tag: () => undefined,
  status: (id: number) => [PARKED, WAITING].find((s) => s.id === id)?.name,
}
const printed = (zone: NeglectReviewZone, hidden?: number[]) => {
  const f = neglectZoneReviewFilter(zone, hidden)
  return printExpression(f.expression, f.showCompleted, names)
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000)

beforeEach(() => {
  resetEntityStores()
  clearFilterStore()
  useStatusStore.setState({ statuses: [PARKED, WAITING] })
  useSettingsStore.setState({ staleAfterDays: 14, urgentDueWithinDays: 3 })
})

describe('neglectZoneReviewFilter', () => {
  it('writes each zone in the words that read Settings', () => {
    expect(printed('slipping')).toBe('(due soon or followup soon) and stale')
    expect(printed('drifting')).toBe('(due any or followup any) and not due soon and not followup soon and stale')
    expect(printed('forgotten')).toBe('no due and no followup and planned none and stale')
  })

  it('leaves out each hidden status that still exists; never done', () => {
    expect(printed('slipping', [4, 99])).toBe('(due soon or followup soon) and stale and not !Parked')
    expect(printed('forgotten', [2, 4])).toBe('no due and no followup and planned none and stale and not !Waiting and not !Parked')
    expect(neglectZoneReviewFilter('slipping').showCompleted).toBe(false)
  })
})

describe('a zone’s review keeps what the map counts', () => {
  const project: Tag = { id: 7, name: 'Project: Alpha', color: '#123456' }

  beforeEach(() => {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'Late, old', modifiedAt: daysAgo(20), dueDate: daysAgo(3) }),
        makeTodo({ id: 2, title: 'Follow-up late, old', modifiedAt: daysAgo(30), dueDate: inDays(20), nextFollowupAt: daysAgo(1) }),
        makeTodo({ id: 3, title: 'Soon, fresh', modifiedAt: daysAgo(1), dueDate: inDays(1) }),
        makeTodo({ id: 4, title: 'Later, old', modifiedAt: daysAgo(40), dueDate: inDays(15) }),
        makeTodo({ id: 5, title: 'Follow-up later, old', modifiedAt: daysAgo(40), nextFollowupAt: inDays(12) }),
        makeTodo({ id: 6, title: 'No dates, old', modifiedAt: daysAgo(50) }),
        makeTodo({ id: 7, title: 'Planned only, old', modifiedAt: daysAgo(50), doDate: inDays(2) }),
        makeTodo({ id: 8, title: 'Parked, late, old', modifiedAt: daysAgo(50), dueDate: daysAgo(2), statusId: 4 }),
        makeTodo({ id: 9, title: 'Parked, no dates', modifiedAt: daysAgo(50), statusId: 4 }),
        makeTodo({ id: 10, title: 'Done, late, old', modifiedAt: daysAgo(50), dueDate: daysAgo(2), isCompleted: true }),
      ],
    })
    useTagStore.setState({ tags: [project], assignedTagsMap: new Map([[1, [project]], [4, [project]], [6, [project]]]) })
  })

  function both(zone: NeglectReviewZone, hidden: number[]) {
    return renderHook(() => {
      const base = useStatsBase()
      const queue = useReviewWidgetQueue(useListWidgetStore((s) => s.reviewFilters[REVIEW_POPUP_TAB_ID]))
      const map = buildNeglectMap(base.shown, {
        today: base.ctx.today,
        staleAfterDays: useSettingsStore.getState().staleAfterDays,
        dueSoonDays: useSettingsStore.getState().urgentDueWithinDays,
        hiddenStatusIds: hidden,
      })
      const inZone = map.points.filter((p) => p.zone === zone).map((p) => p.todo.id).sort((a, b) => a - b)
      return { queue: [...queue.ids].sort((a, b) => a - b), inZone, zone }
    })
  }

  for (const zone of ['slipping', 'drifting', 'forgotten'] as const) {
    it(`${zone}: the same tasks, with hidden statuses and under the screen filter`, () => {
      act(() => useListWidgetStore.getState().setReviewFilter(REVIEW_POPUP_TAB_ID, neglectZoneReviewFilter(zone, [4])))
      const { result } = both(zone, [4])
      expect(result.current.inZone.length).toBeGreaterThan(0)
      expect(result.current.queue).toEqual(result.current.inZone)
      // The screen filter narrows both alike.
      act(() => patchScreenFilter({ tags: new Set([7]) }))
      expect(result.current.queue).toEqual(result.current.inZone)
    })
  }

  it('Stale after off: the zones and their reviews are empty', () => {
    act(() => useListWidgetStore.getState().setReviewFilter(REVIEW_POPUP_TAB_ID, neglectZoneReviewFilter('slipping', [])))
    const { result } = both('slipping', [])
    // Nothing hidden: the parked late task slips too.
    expect(result.current.queue).toEqual([1, 2, 8])
    act(() => useSettingsStore.setState({ staleAfterDays: 0 }))
    expect(result.current.queue).toEqual([])
  })
})

describe('jumpToPopupReview', () => {
  it('opens the popup review with the filter', async () => {
    const filter = neglectZoneReviewFilter('forgotten', [4])
    await act(() => jumpToPopupReview(filter))
    expect(useUIStore.getState().widgetPopup).toEqual({ kind: 'review' })
    expect(useListWidgetStore.getState().reviewFilters[REVIEW_POPUP_TAB_ID]).toEqual(filter)
  })
})
