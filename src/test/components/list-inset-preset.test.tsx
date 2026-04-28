import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { ReactFlowProvider } from '@xyflow/react'
import type { ReactNode } from 'react'
import { ListInsetNode, type ListInsetNodeData } from '../../components/canvas/ListInsetNode'
import type { ListInset, PersistedTodoItem } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { emptyPredicate } from '../../stores/list-definition-store'
import { useTodoStore } from '../../stores/todo-store'
import { makeTodo, resetEntityStores, clearFilterStore } from '../helpers'

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
    quickAssignOrg: vi.fn(),
    quickUnassignOrg: vi.fn(),
    quickAssignTag: vi.fn(),
    quickUnassignTag: vi.fn(),
  }),
}))

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <ReactFlowProvider>
      <DndContext>{children}</DndContext>
    </ReactFlowProvider>
  )
}

/**
 * Build a custom-predicate ListDefinition mirroring the pre-v23 `due-this-week`
 * preset: effectiveDate <= today + 7 days, including overdue. The migration
 * freezes the upper bound at migration time; tests fix today at 2026-04-16 and
 * pick an end date of 2026-04-23 to match.
 */
function dueThisWeekDef(): PersistedListDefinition {
  const predicate = emptyPredicate()
  predicate.dateField = 'date'
  predicate.dateRangeEnd = { kind: 'fixed', iso: new Date(2026, 3, 23).toISOString() }
  return {
    id: 1,
    name: 'Due this week',
    sortOrder: 0,
    pinnedToDashboard: false,
    favorited: false,
    membership: { kind: 'custom', predicate },
    sort: 'date',
    grouping: { kind: 'none' },
  }
}

function resetStores(def: PersistedListDefinition = dueThisWeekDef()) {
  resetEntityStores()
  useListDefinitionStore.setState({ listDefinitions: [def] })
  clearFilterStore()
}

function makeInset(overrides: Partial<ListInset> = {}): ListInset {
  return {
    id: 1,
    listDefinitionId: 1,
    canvasId: 1,
    x: 0,
    y: 0,
    width: 280,
    height: 400,
    isCollapsed: false,
    ...overrides,
  }
}

function renderInset(data: Partial<ListInsetNodeData>) {
  const merged: ListInsetNodeData = {
    inset: data.inset ?? makeInset(),
    allTodos: data.allTodos ?? [],
    assignedPeopleMap: data.assignedPeopleMap ?? new Map(),
    assignedOrgsMap: data.assignedOrgsMap ?? new Map(),
    personOrgMap: data.personOrgMap ?? new Map(),
    onDelete: vi.fn(),
    onToggleCollapse: vi.fn(),
  }
  // ListDefinitionBody reads todos from the store; seed it from the fixture.
  useTodoStore.setState({ todos: merged.allTodos })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const NodeComp = ListInsetNode as any
  return render(
    <Wrapper>
      <NodeComp id="inset-1" type="listInset" data={merged} dragging={false} selectable={false} deletable zIndex={0} isConnectable={false} xPos={0} yPos={0} selected={false} />
    </Wrapper>,
  )
}

describe('ListInsetNode (v23 — backed by a ListDefinition)', () => {
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

  describe('legacy due-this-week parity (custom predicate, dateRangeEnd=today+7d)', () => {
    function renderedTitles(container: HTMLElement): string[] {
      return Array.from(container.querySelectorAll('[data-task-drag-id]')).map((el) => {
        return (el.textContent ?? '').trim()
      })
    }

    it('includes a task whose scheduledDate is within the next 7 days', () => {
      const todos: PersistedTodoItem[] = [
        makeTodo({ id: 1, title: 'Scheduled soon', scheduledDate: { kind: 'date', value: new Date(2026, 3, 18) } }),
      ]
      const { container } = renderInset({ allTodos: todos })
      expect(renderedTitles(container).some((t) => t.includes('Scheduled soon'))).toBe(true)
    })

    it('includes a deadline-only task within the next 7 days', () => {
      const todos: PersistedTodoItem[] = [
        makeTodo({ id: 2, title: 'Deadline-only', dueDate: new Date(2026, 3, 19) }),
      ]
      const { container } = renderInset({ allTodos: todos })
      expect(renderedTitles(container).some((t) => t.includes('Deadline-only'))).toBe(true)
    })

    it('includes an overdue task (effectiveDate in the past)', () => {
      const todos: PersistedTodoItem[] = [
        makeTodo({ id: 4, title: 'Overdue', dueDate: new Date(2026, 3, 10) }),
      ]
      const { container } = renderInset({ allTodos: todos })
      expect(renderedTitles(container).some((t) => t.includes('Overdue'))).toBe(true)
    })

    it('excludes a task whose effectiveDate is beyond the 7-day window', () => {
      const todos: PersistedTodoItem[] = [
        makeTodo({ id: 5, title: 'Far out', dueDate: new Date(2026, 4, 15) }),
      ]
      const { container } = renderInset({ allTodos: todos })
      expect(renderedTitles(container).some((t) => t.includes('Far out'))).toBe(false)
    })

    it('excludes a task with no scheduled and no deadline', () => {
      const todos: PersistedTodoItem[] = [
        makeTodo({ id: 6, title: 'Dateless' }),
      ]
      const { container } = renderInset({ allTodos: todos })
      expect(renderedTitles(container).some((t) => t.includes('Dateless'))).toBe(false)
    })

    it('sorts matching tasks by effectiveDate ascending (interpreter sort kind)', () => {
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

  describe('dangling listDefinitionId', () => {
    it('renders a placeholder header + empty body when the referenced def was deleted', () => {
      useListDefinitionStore.setState({ listDefinitions: [] })
      const { container } = renderInset({
        allTodos: [makeTodo({ id: 1, title: 'Any', dueDate: new Date(2026, 3, 18) })],
      })
      expect(container.textContent).toContain('(Deleted list)')
      // Body renders zero task rows because the interpreter short-circuits.
      expect(container.querySelectorAll('[data-task-drag-id]')).toHaveLength(0)
    })
  })
})
