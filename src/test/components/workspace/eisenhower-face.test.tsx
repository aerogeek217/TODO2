import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { EisenhowerWidget, type EisenhowerResult } from '../../../components/workspace/eisenhower/EisenhowerWidget'
import { EISENHOWER_FACE_TITLES } from '../../../components/workspace/eisenhower/EisenhowerFace'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import { emptyPredicate } from '../../../models/filter-predicate'
import type { EisenhowerTab } from '../../../models/workspace-layout'
import { useFilterStore } from '../../../stores/filter-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import type { WidgetFace } from '../../../utils/widget-face'
import { clearFilterStore, resetEntityStores } from '../../helpers'
import {
  ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, Q4, SAMPLE_LISTS, SAMPLE_TASKS, STATUSES, TAGS,
} from '../../fixtures/glance-sample'

/**
 * The Eisenhower's faces (D26 P4): small is the old Eisenhower summary's
 * 2×2 of counts, medium adds each pane's first titles, large is the whole
 * widget. Over the design sample (the old summary's numbers).
 */

const TAB: EisenhowerTab = { id: 'eis', kind: 'eisenhower', config: {} }
let lastResult: EisenhowerResult | null = null

function setup(face: WidgetFace) {
  return render(
    <DndContext>
      <WidgetFaceContext.Provider value={{ forced: face }}>
        <EisenhowerWidget tab={TAB} onResult={(r) => { lastResult = r }} />
      </WidgetFaceContext.Provider>
    </DndContext>,
  )
}

const faceEl = () => document.querySelector<HTMLElement>('[data-eis-face]')
const pane = (q: string) => faceEl()!.querySelector<HTMLElement>(`[data-eis-cell="${q}"]`)!
const count = (q: string) => within(pane(q)).getByTestId('eis-face-count').textContent
const counts = () => ['do', 'schedule', 'delegate', 'drop'].map(count)
const titlesOf = (q: string) => Array.from(pane(q).querySelectorAll<HTMLElement>('[data-todo-id]')).map((b) => Number(b.dataset.todoId))

const Q4_LIST = {
  id: 90, name: 'Q4 work', sortOrder: 9, sort: 'manual' as const, grouping: 'none' as const,
  membership: { kind: 'custom' as const, predicate: { ...emptyPredicate(), tags: [Q4] } },
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 10, 10))
  lastResult = null
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ urgentDueWithinDays: 3, weekStartsOn: 0 })
  useTodoStore.setState({ todos: SAMPLE_TASKS })
  usePersonStore.setState({ people: PEOPLE, assignedPeopleMap: ASSIGNED_PEOPLE })
  useTagStore.setState({ tags: TAGS, assignedTagsMap: ASSIGNED_TAGS })
  useStatusStore.setState({ statuses: STATUSES })
  useListDefinitionStore.setState({ listDefinitions: SAMPLE_LISTS })
  useListDraftStore.setState({ drafts: {} })
  useUIStore.setState({ selectedTodoIds: new Set(), selectionScope: null, taskDialog: null })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the Eisenhower picks its face (useWidgetFace)', () => {
  it('large is the whole widget; small and medium are the counts', () => {
    setup('large')
    expect(document.querySelector('[data-eisenhower="eis"]')).not.toBeNull()
    expect(faceEl()).toBeNull()
    cleanup()
    setup('medium')
    expect(faceEl()?.dataset.eisFace).toBe('medium')
    expect(document.querySelector('[data-eisenhower]')).toBeNull()
    cleanup()
    setup('small')
    expect(faceEl()?.dataset.eisFace).toBe('small')
    expect(faceEl()?.dataset.eisFaceTab).toBe('eis')
  })
})

describe('the small face: the 2×2 of counts (the old Eisenhower summary)', () => {
  it('each pane’s name and open count, in position order; the tab hears the open count', () => {
    setup('small')
    expect(Array.from(faceEl()!.querySelectorAll<HTMLElement>('[data-eis-cell]')).map((el) => el.dataset.eisCell))
      .toEqual(['do', 'schedule', 'delegate', 'drop'])
    expect(counts()).toEqual(['3', '1', '5', '10'])
    expect(pane('do').textContent).toContain('Do')
    expect(faceEl()!.getAttribute('aria-label')).toBe('Eisenhower: Do 3, Schedule 1, Delegate 5, Drop 10')
    expect(lastResult?.countLabel).toBe('19')
  })

  it('is not interactive: a click goes to the cell, which opens the whole widget', () => {
    setup('small')
    expect(faceEl()!.querySelector('button')).toBeNull()
  })

  it('under the top-bar filter: what it keeps, the tab’s count `n of N`', () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, tags: new Set([Q4]) } }))
    setup('small')
    expect(counts()).toEqual(['0', '1', '1', '3'])
    expect(pane('do').querySelector('[data-zero="true"]')).not.toBeNull()
    expect(faceEl()!.getAttribute('aria-label')).toBe('Eisenhower: Do 0 of 3, Schedule 1, Delegate 1 of 5, Drop 3 of 10')
    expect(lastResult?.countLabel).toBe('5 of 19')
  })
})

describe('the medium face: the counts and each pane’s first titles', () => {
  it('a pane’s count reads `n of N` under the top-bar filter', () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, tags: new Set([Q4]) } }))
    setup('medium')
    expect(counts()).toEqual(['0of 3', '1', '1of 5', '3of 10'])
  })

  it(`lists at most ${EISENHOWER_FACE_TITLES} titles per pane, in the widget’s order (overdue first, by due date)`, () => {
    setup('medium')
    expect(titlesOf('do')).toHaveLength(2)
    expect(titlesOf('schedule')).toHaveLength(1)
    expect(titlesOf('delegate')).toEqual([5, 6])
    expect(titlesOf('drop')).toHaveLength(2)
  })

  it('a title opens the task; a count opens the pane’s tasks in the task dialog', () => {
    const openEditPopup = vi.fn()
    useUIStore.setState({ openEditPopup })
    setup('medium')
    fireEvent.click(pane('delegate').querySelector<HTMLElement>('[data-todo-id="5"]')!)
    expect(openEditPopup).toHaveBeenCalledWith(5)
    fireEvent.click(within(pane('delegate')).getByRole('button', { name: 'Delegate: 5. Show tasks' }))
    expect(useUIStore.getState().taskDialog).toMatchObject({
      title: 'Delegate', glyph: 'matrix',
      description: 'Open tasks that are urgent, not important. Urgent includes tasks due within 3 days.',
      source: { kind: 'todos', todoIds: [5, 6, 7, 12, 13] },
    })
  })

  it('an empty pane’s count is not a button; under the top-bar filter the dialog says so', () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, tags: new Set([Q4]) } }))
    setup('medium')
    expect(within(pane('do')).queryByRole('button')).toBeNull()
    fireEvent.click(within(pane('drop')).getByRole('button', { name: /^Drop: 3 of 10/ }))
    expect(useUIStore.getState().taskDialog?.description).toContain('Only tasks the top-bar filter shows.')
  })
})

describe('the faces follow the app-wide panes and the Eisenhower’s list', () => {
  const waiting = STATUSES.find((s) => s.name === 'Waiting')!

  it('its list with a filter and a custom pane: counts, names and drills', () => {
    useListDefinitionStore.setState({ listDefinitions: [...SAMPLE_LISTS, Q4_LIST] })
    useSettingsStore.setState({
      eisenhowerListId: 90,
      eisenhowerPanes: { delegate: { name: 'Hand off', filter: { ...emptyPredicate(), markers: [{ values: ['urgent'] }, { values: ['important'], not: true }], statusIds: [waiting.id!], negate: { statusIds: true } } } },
    })
    setup('medium')
    // The list's five open tasks (the q4 tag).
    expect(counts()).toEqual(['0', '1', '1', '3'])
    expect(lastResult?.countLabel).toBe('5')
    expect(pane('delegate').textContent).toContain('Hand off')
    fireEvent.click(within(pane('delegate')).getByRole('button', { name: /^Hand off: 1/ }))
    expect(useUIStore.getState().taskDialog).toMatchObject({ title: 'Hand off', source: { kind: 'todos', todoIds: [7] } })
    expect(useUIStore.getState().taskDialog?.description).toContain('Open tasks of “Q4 work” in “Hand off”')
  })

  it('the list’s unsaved draft counts, as in the widget', () => {
    useListDefinitionStore.setState({ listDefinitions: [...SAMPLE_LISTS, Q4_LIST] })
    useListDraftStore.setState({ drafts: { 90: { ...Q4_LIST, membership: { kind: 'custom', predicate: { ...emptyPredicate() } } } } })
    useSettingsStore.setState({ eisenhowerListId: 90 })
    setup('small')
    expect(counts()).toEqual(['3', '1', '5', '10'])
  })

  it('its list not loaded yet: every task is counted', () => {
    useSettingsStore.setState({ eisenhowerListId: 99 })
    setup('small')
    expect(lastResult?.countLabel).toBe('19')
  })
})
