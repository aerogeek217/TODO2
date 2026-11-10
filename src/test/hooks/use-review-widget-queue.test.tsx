import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { reviewPicksPredicate, useReviewWidgetQueue } from '../../hooks/use-review-widget-queue'
import { WidgetLensContext } from '../../hooks/use-widget-lens'
import { emptyPredicate, type Person, type Status, type Tag, type TodoPredicate } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'
import type { ReviewBy } from '../../models/review'
import type { PersistedWorkspaceLayout } from '../../models/workspace-layout'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListDraftStore } from '../../stores/list-draft-store'
import { useListOrderStore } from '../../stores/list-order-store'
import { useListWidgetStore } from '../../stores/list-widget-store'
import { usePersonStore } from '../../stores/person-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { clearFilterStore, makeTodo, patchScreenFilter, resetEntityStores } from '../helpers'
import { single } from '../helpers/layout-builders'

/**
 * A Review widget's queue (board BM): one or more picks of its kind,
 * OR-combined — people's, tags' or statuses' open tasks in `sortOrder`; the
 * union of what the picked lists show, each task once —, under the screen
 * filter and the widget's lens switch, with what the lens hides there.
 */

const aisha: Person = { id: 1, name: 'Aisha', initials: 'A' }
const ben: Person = { id: 2, name: 'Ben', initials: 'B' }
const cy: Person = { id: 3, name: 'Cy', initials: 'C' }
const legal: Tag = { id: 1, name: 'legal', color: '#7ec4bc' }
const q4: Tag = { id: 2, name: 'q4', color: '#c8743a' }
const waiting: Status = { id: 1, name: 'Waiting', color: '#4caf50', sortOrder: 1 }
const blocked: Status = { id: 2, name: 'Blocked', color: '#e06c75', sortOrder: 2 }

const LENS = { id: 'lens-q4', name: 'Q4', predicate: { ...emptyPredicate(), tags: [2] } }

function listDef(id: number, name: string, predicate: Partial<TodoPredicate> = {}, over: Partial<PersistedListDefinition> = {}): PersistedListDefinition {
  return {
    id, name, sortOrder: id,
    membership: { kind: 'custom', predicate: { ...emptyPredicate(), ...predicate } },
    sort: 'manual', grouping: 'none',
    owner: { layoutId: 1 },
    ...over,
  }
}

beforeEach(() => {
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ lenses: [LENS], activeLensId: null })
  useUIStore.setState({ lensLifted: false })
  useTodoStore.setState({
    todos: [
      // Out of `sortOrder` on purpose: the queue sorts.
      makeTodo({ id: 4, title: 'Ben’s own', sortOrder: 4, statusId: 1 }),
      makeTodo({ id: 1, title: 'Vendor contract', sortOrder: 1, statusId: 1 }),
      makeTodo({ id: 2, title: 'Headcount plan', sortOrder: 2, statusId: 2 }),
      makeTodo({ id: 3, title: 'Onboarding', sortOrder: 3 }),
      makeTodo({ id: 5, title: 'Done already', sortOrder: 5, isCompleted: true, statusId: 1 }),
      makeTodo({ id: 6, title: 'Cy’s', sortOrder: 6 }),
    ],
  })
  usePersonStore.setState({
    people: [aisha, ben, cy],
    assignedPeopleMap: new Map([[1, [aisha]], [2, [aisha]], [3, [aisha, ben]], [4, [ben]], [5, [aisha]], [6, [cy]]]),
  })
  useTagStore.setState({ tags: [legal, q4], assignedTagsMap: new Map([[1, [legal]], [2, [q4]], [4, [legal, q4]], [5, [legal]]]) })
  useStatusStore.setState({ statuses: [waiting, blocked] })
  useListOrderStore.setState({ ranks: new Map(), loaded: true })
})

/** The queue of `picks` by `by` — in a widget that ignores the top bar's lens with `ignoreLens`. */
function queueOf(by: ReviewBy, picks: number[], ignoreLens = false) {
  const wrapper = ({ children }: { children: ReactNode }) => <WidgetLensContext.Provider value={ignoreLens}>{children}</WidgetLensContext.Provider>
  return renderHook(({ ids }) => useReviewWidgetQueue(by, ids), { initialProps: { ids: picks }, wrapper })
}

describe('reviewPicksPredicate', () => {
  it('any of the picks, on the kind’s field; none for lists', () => {
    expect(reviewPicksPredicate('person', [1, 2])).toEqual({ ...emptyPredicate(), personIds: [1, 2] })
    expect(reviewPicksPredicate('tag', [3])).toEqual({ ...emptyPredicate(), tags: [3] })
    expect(reviewPicksPredicate('status', [1, 2])).toEqual({ ...emptyPredicate(), statusIds: [1, 2] })
    expect(reviewPicksPredicate('list', [1])).toBeNull()
  })
})

describe('useReviewWidgetQueue', () => {
  it('no picks: an empty queue, the same one each time', () => {
    const { result, rerender } = queueOf('person', [])
    expect(result.current).toEqual({ ids: [], dividers: [], hides: 0, waiting: [] })
    const first = result.current
    rerender({ ids: [] })
    expect(result.current).toBe(first)
  })

  it('people: the open tasks of any picked person, each once, in sortOrder', () => {
    expect(queueOf('person', [1]).result.current.ids).toEqual([1, 2, 3])
    expect(queueOf('person', [2]).result.current.ids).toEqual([3, 4])
    // Task 3 is both Aisha's and Ben's: once. The completed task 5 is no one's to review.
    const both = queueOf('person', [2, 1]).result.current
    expect(both.ids).toEqual([1, 2, 3, 4])
    expect(both.dividers).toEqual([])
    expect(queueOf('person', [1, 2, 3]).result.current.ids).toEqual([1, 2, 3, 4, 6])
  })

  it('tags: any picked tag', () => {
    expect(queueOf('tag', [1]).result.current.ids).toEqual([1, 4])
    expect(queueOf('tag', [1, 2]).result.current.ids).toEqual([1, 2, 4])
  })

  it('statuses: any picked status', () => {
    expect(queueOf('status', [2]).result.current.ids).toEqual([2])
    expect(queueOf('status', [1, 2]).result.current.ids).toEqual([1, 2, 4])
  })

  it('stays current: a task leaving the picks leaves the queue', () => {
    const { result } = queueOf('person', [1, 2])
    act(() => { usePersonStore.setState({ assignedPeopleMap: new Map([[1, [aisha]], [4, [cy]]]) }) })
    expect(result.current.ids).toEqual([1])
  })

  it('the screen filter’s chips narrow it', () => {
    const { result } = queueOf('person', [1, 2])
    act(() => { patchScreenFilter({ tags: new Set([1]) }) })
    expect(result.current.ids).toEqual([1, 4])
  })

  it('the top bar’s lens narrows it, with what it hides; a widget that ignores the lens keeps every task and still says what it would hide', () => {
    useSettingsStore.setState({ activeLensId: 'lens-q4' })
    const lensed = queueOf('person', [1, 2]).result.current
    expect(lensed.ids).toEqual([2, 4])
    expect(lensed.hides).toBe(2)
    const ignoring = queueOf('person', [1, 2], true).result.current
    expect(ignoring.ids).toEqual([1, 2, 3, 4])
    expect(ignoring.hides).toBe(2)
  })

  describe('lists', () => {
    beforeEach(() => {
      useListDefinitionStore.setState({
        listDefinitions: [
          listDef(11, 'Aisha 1:1', { personIds: [1] }),
          listDef(12, 'Waiting', { statusIds: [1] }),
          listDef(13, 'By person', {}, { grouping: 'people' }),
          listDef(14, 'Tasks for…', {}, { runtimeFilter: { field: 'person' } }),
        ],
      })
    })

    it('one list: what it shows as a list tab would, in its order', () => {
      const one = queueOf('list', [11]).result.current
      expect(one.ids).toEqual([1, 2, 3])
      expect(one.dividers).toEqual([])
      expect(one.waiting).toEqual([])
    })

    it('one grouped list keeps its group headers as dividers, a task at its first group', () => {
      const grouped = queueOf('list', [13]).result.current
      expect(grouped.ids).toEqual([1, 2, 3, 4, 6])
      expect(grouped.dividers).toEqual([{ index: 0, label: 'Aisha' }, { index: 3, label: 'Ben' }, { index: 4, label: 'Cy' }])
    })

    it('several lists: the union of what they show, each task once at its first list, divided by list', () => {
      const union = queueOf('list', [11, 12]).result.current
      // Aisha 1:1 shows 1, 2, 3; Waiting shows 1 and 4 — 1 is already there.
      expect(union.ids).toEqual([1, 2, 3, 4])
      expect(union.dividers).toEqual([{ index: 0, label: 'Aisha 1:1' }, { index: 3, label: 'Waiting' }])
      // The other way round, the pick order leads.
      const reversed = queueOf('list', [12, 11]).result.current
      expect(reversed.ids).toEqual([1, 4, 2, 3])
      expect(reversed.dividers).toEqual([{ index: 0, label: 'Waiting' }, { index: 2, label: 'Aisha 1:1' }])
    })

    it('a list’s unsaved edits count (its draft), as its tab shows them', () => {
      const { result } = queueOf('list', [11])
      act(() => { useListDraftStore.setState({ drafts: { 11: listDef(11, 'Aisha 1:1', { personIds: [2] }) } }) })
      expect(result.current.ids).toEqual([3, 4])
    })

    it('an id that names no list any more is ignored', () => {
      expect(queueOf('list', [99, 12]).result.current.ids).toEqual([1, 4])
      expect(queueOf('list', [99]).result.current).toEqual({ ids: [], dividers: [], hides: 0, waiting: [] })
    })

    it('a list with a prompt waits for the pick of a list tab of this layout that shows it', () => {
      const lensTab = { id: 'lt', kind: 'lens' as const, config: { listDefinitionId: 14 } }
      const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'L', createdAt: new Date(), modifiedAt: new Date(), ...single({ id: 'c', tabs: [lensTab] }) }
      useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout] })
      const { result } = queueOf('list', [14, 12])
      expect(result.current.waiting).toEqual(['Tasks for…'])
      // The other picked list still shows.
      expect(result.current.ids).toEqual([1, 4])
      act(() => { useListWidgetStore.getState().setPicks('lt', [2]) })
      expect(result.current.waiting).toEqual([])
      expect(result.current.ids).toEqual([3, 4, 1])
    })

    it('the screen filter and the lens apply to every picked list; the lens’s −N counts each hidden task once', () => {
      useSettingsStore.setState({ activeLensId: 'lens-q4' })
      const lensed = queueOf('list', [11, 12]).result.current
      // Of 1, 2, 3, 4 the lens (tag q4) keeps 2 and 4.
      expect(lensed.ids).toEqual([2, 4])
      expect(lensed.hides).toBe(2)
      const ignoring = queueOf('list', [11, 12], true).result.current
      expect(ignoring.ids).toEqual([1, 2, 3, 4])
      expect(ignoring.hides).toBe(2)
    })
  })
})
