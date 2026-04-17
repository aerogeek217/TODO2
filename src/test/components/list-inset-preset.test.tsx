import { describe, it, expect, vi, beforeEach, afterEach, expectTypeOf } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { ReactFlowProvider } from '@xyflow/react'
import type { ReactNode } from 'react'
import { ListInsetNode, type ListInsetNodeData } from '../../components/canvas/ListInsetNode'
import type { ListInset, ListInsetPreset, ListInsetAttributeFilter, PersistedTodoItem } from '../../models'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { useProjectStore } from '../../stores/project-store'
import { useFilterStore } from '../../stores/filter-store'
import { makeTodo } from '../helpers'

vi.mock('../../hooks/use-bulk-actions', () => ({
  useBulkActions: () => ({
    toggleComplete: vi.fn(),
    remove: vi.fn(),
    setScheduled: vi.fn(),
    setDeadline: vi.fn(),
    setProject: vi.fn(),
    setStatus: vi.fn(),
    quickAssignPerson: vi.fn(),
    quickUnassignPerson: vi.fn(),
    quickAssignTag: vi.fn(),
    quickUnassignTag: vi.fn(),
    quickAssignOrg: vi.fn(),
    quickUnassignOrg: vi.fn(),
  }),
}))

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <ReactFlowProvider>
      <DndContext>{children}</DndContext>
    </ReactFlowProvider>
  )
}

function resetStores() {
  usePersonStore.setState({ people: [], assignedPeopleMap: new Map() })
  useTagStore.setState({ tags: [] })
  useOrgStore.setState({ orgs: [], assignedOrgsMap: new Map(), personOrgMap: new Map() })
  useStatusStore.setState({ statuses: [] })
  useProjectStore.setState({ projects: [] })
  // Reset the filter store to default (no filters active) via its setAllFilters action
  useFilterStore.getState().setAllFilters({
    showCompleted: false,
    showHiddenStatuses: false,
    personIds: null,
    personFilterMode: 'include-orgs',
    tagIds: null,
    orgIds: null,
    orgFilterMode: 'include-people',
    statusIds: null,
    searchText: '',
    dateField: 'date',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
  })
}

function makeInset(overrides: Partial<ListInset> = {}): ListInset {
  return {
    id: 1,
    name: 'Due',
    canvasId: 1,
    x: 0,
    y: 0,
    width: 280,
    height: 400,
    isCollapsed: false,
    preset: 'due-this-week',
    ...overrides,
  }
}

function renderInset(data: Partial<ListInsetNodeData>) {
  const merged: ListInsetNodeData = {
    inset: data.inset ?? makeInset(),
    allTodos: data.allTodos ?? [],
    assignedPeopleMap: data.assignedPeopleMap ?? new Map(),
    assignedTagsMap: data.assignedTagsMap ?? new Map(),
    assignedOrgsMap: data.assignedOrgsMap ?? new Map(),
    personOrgMap: data.personOrgMap ?? new Map(),
    onDelete: vi.fn(),
    onToggleCollapse: vi.fn(),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const NodeComp = ListInsetNode as any
  return render(
    <Wrapper>
      <NodeComp id="inset-1" type="listInset" data={merged} dragging={false} selectable={false} deletable zIndex={0} isConnectable={false} xPos={0} yPos={0} selected={false} />
    </Wrapper>,
  )
}

describe('ListInsetNode (unified scheduling)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Fixed "today" — April 16, 2026 (Thursday)
    vi.setSystemTime(new Date(2026, 3, 16))
    resetStores()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  describe('preset: due-this-week membership', () => {
    function renderedTitles(container: HTMLElement): string[] {
      return Array.from(container.querySelectorAll('[data-inset-todo-id]')).map((el) => {
        return (el.textContent ?? '').trim()
      })
    }

    it('includes a task whose scheduledDate is within the next 7 days', () => {
      const todos: PersistedTodoItem[] = [
        makeTodo({ id: 1, title: 'Scheduled soon', scheduledDate: { kind: 'date', value: new Date(2026, 3, 18) } }),
      ]
      const { container } = renderInset({ allTodos: todos })
      const titles = renderedTitles(container)
      expect(titles.some((t) => t.includes('Scheduled soon'))).toBe(true)
    })

    it('includes a deadline-only task within the next 7 days', () => {
      const todos: PersistedTodoItem[] = [
        makeTodo({ id: 2, title: 'Deadline-only', dueDate: new Date(2026, 3, 19) }),
      ]
      const { container } = renderInset({ allTodos: todos })
      const titles = renderedTitles(container)
      expect(titles.some((t) => t.includes('Deadline-only'))).toBe(true)
    })

    it('includes a task with both scheduled and deadline within 7 days', () => {
      const todos: PersistedTodoItem[] = [
        makeTodo({
          id: 3,
          title: 'Both dates',
          scheduledDate: { kind: 'fuzzy', token: 'tomorrow' },
          dueDate: new Date(2026, 3, 22),
        }),
      ]
      const { container } = renderInset({ allTodos: todos })
      const titles = renderedTitles(container)
      expect(titles.some((t) => t.includes('Both dates'))).toBe(true)
    })

    it('includes an overdue task (effectiveDate in the past)', () => {
      const todos: PersistedTodoItem[] = [
        makeTodo({ id: 4, title: 'Overdue', dueDate: new Date(2026, 3, 10) }),
      ]
      const { container } = renderInset({ allTodos: todos })
      const titles = renderedTitles(container)
      expect(titles.some((t) => t.includes('Overdue'))).toBe(true)
    })

    it('excludes a task whose effectiveDate is beyond 7 days out', () => {
      const todos: PersistedTodoItem[] = [
        makeTodo({ id: 5, title: 'Far out', dueDate: new Date(2026, 4, 15) }),
      ]
      const { container } = renderInset({ allTodos: todos })
      const titles = renderedTitles(container)
      expect(titles.some((t) => t.includes('Far out'))).toBe(false)
    })

    it('excludes a task with no scheduled and no deadline', () => {
      const todos: PersistedTodoItem[] = [
        makeTodo({ id: 6, title: 'Dateless' }),
      ]
      const { container } = renderInset({ allTodos: todos })
      const titles = renderedTitles(container)
      expect(titles.some((t) => t.includes('Dateless'))).toBe(false)
    })

    it('sorts matching tasks by effectiveDate ascending', () => {
      const todos: PersistedTodoItem[] = [
        makeTodo({ id: 10, title: 'Later task', dueDate: new Date(2026, 3, 20), sortOrder: 1 }),
        makeTodo({ id: 11, title: 'Earlier task', dueDate: new Date(2026, 3, 17), sortOrder: 2 }),
      ]
      const { container } = renderInset({ allTodos: todos })
      const titles = renderedTitles(container)
      const earlierIdx = titles.findIndex((t) => t.includes('Earlier task'))
      const laterIdx = titles.findIndex((t) => t.includes('Later task'))
      expect(earlierIdx).toBeGreaterThanOrEqual(0)
      expect(laterIdx).toBeGreaterThanOrEqual(0)
      expect(earlierIdx).toBeLessThan(laterIdx)
    })
  })

  describe('type-level guarantees', () => {
    it('ListInsetPreset is narrowed to due-this-week only', () => {
      expectTypeOf<ListInsetPreset>().toEqualTypeOf<'due-this-week'>()
    })

    it('ListInsetAttributeFilter does not include priority', () => {
      type FilterTypes = ListInsetAttributeFilter['type']
      expectTypeOf<FilterTypes>().toEqualTypeOf<'person' | 'tag' | 'org'>()
    })
  })
})
