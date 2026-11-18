import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ListWallWidget } from '../../../components/workspace/listwall/ListWallWidget'
import { emptyPredicate } from '../../../models/filter-predicate'
import { createTab, type ListWallTab } from '../../../models/workspace-layout'
import type { ListDefinition } from '../../../models/list-definition'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { buildWallList, wallGridShape, wallListWords, wallRowsFit, wallSquaresShown } from '../../../utils/list-wall'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'
import { cell, grid } from '../../helpers/layout-builders'

const TODAY = new Date(2026, 10, 18, 10)
const day = (offset: number) => new Date(2026, 10, 18 + offset, 9)
const WALL: ListWallTab = { id: 'wall', kind: 'listwall', config: {} }

let width = 1200
let height = 700

function list(id: number, name: string, predicate = emptyPredicate()): ListDefinition & { id: number } {
  return { id, name, sortOrder: id, membership: { kind: 'custom', predicate }, sort: 'manual', grouping: 'none', owner: { layoutId: 1 } } as ListDefinition & { id: number }
}

beforeEach(() => {
  width = 1200
  height = 700
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ urgentDueWithinDays: 3, staleAfterDays: 30 })
  useTodoStore.setState({
    todos: [
      makeTodo({ id: 1, title: 'On track', dueDate: day(10), modifiedAt: day(-1), sortOrder: 1 }),
      makeTodo({ id: 2, title: 'Late', dueDate: day(-2), modifiedAt: day(-1), sortOrder: 2, focus: true, statusId: 5 }),
      makeTodo({ id: 3, title: 'Chase', nextFollowupAt: day(-1), modifiedAt: day(-1), sortOrder: 3 }),
      makeTodo({ id: 4, title: 'Dusty', modifiedAt: day(-40), sortOrder: 4 }),
      makeTodo({ id: 5, title: 'Soon', dueDate: day(2), modifiedAt: day(-1), sortOrder: 5 }),
      makeTodo({ id: 6, title: 'Done', dueDate: day(-5), isCompleted: true, sortOrder: 6 }),
    ],
  })
  useListDefinitionStore.setState({
    listDefinitions: [list(1, 'Everything'), list(2, 'Late ones', { ...emptyPredicate(), statusIds: [5] })],
  })
  const lens = (id: string, listDefinitionId: number) => ({ ...createTab('lens', id), config: { listDefinitionId } })
  const body = grid([[cell('a', [lens('t-all', 1), lens('t-late', 2)], { activeTabId: 't-late' }), cell('b', [WALL])]])
  const layout = { id: 1, name: 'Lists', sortOrder: 0, createdAt: new Date(0), modifiedAt: new Date(0), ...body }
  useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout], activeLayoutId: 1 })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the List wall', () => {
  it('draws a block per list tab, a square per open task it shows, the trouble first', () => {
    render(<ListWallWidget tab={WALL} />)
    const all = document.querySelector('[data-wall-list="t-all"]')!
    expect([...all.querySelectorAll('button[data-tone]')].map((b) => b.getAttribute('data-tone')))
      .toEqual(['late', 'soon', 'followup', 'ontrack', 'stale'])
    expect(all).toHaveTextContent('1 overdue · 1 follow-up late')
    // The cell shows Late ones: its dot is lit.
    expect(screen.getByRole('button', { name: /^Late ones: .*Show it in its cell/ })).toHaveAttribute('data-showing', 'true')
    expect(screen.getByRole('button', { name: /^Everything: .*Show it in its cell/ })).not.toHaveAttribute('data-showing')
  })

  it('a list’s name brings its tab to the front; a square opens its task', () => {
    const setActive = vi.spyOn(useWorkspaceStore.getState(), 'setActiveTab').mockResolvedValue(undefined as never)
    const open = vi.spyOn(useUIStore.getState(), 'openEditPopup')
    render(<ListWallWidget tab={WALL} />)
    fireEvent.click(screen.getByRole('button', { name: /^Everything: .*Show it in its cell/ }))
    expect(setActive).toHaveBeenCalledWith('t-all')
    fireEvent.click(screen.getByRole('button', { name: 'Chase: Follow-up late' }))
    expect(open).toHaveBeenCalledWith(3)
  })

  it('a narrow cell draws a bar per list; a small one how many are overdue', () => {
    width = 400
    const { unmount } = render(<ListWallWidget tab={WALL} />)
    expect(document.querySelector('[data-list-wall-face="medium"]')).not.toBeNull()
    expect(document.querySelectorAll('[data-list-wall-face="medium"] [data-wall-list]')).toHaveLength(2)
    unmount()
    width = 150
    render(<ListWallWidget tab={WALL} />)
    // One task, overdue in both lists.
    expect(screen.getByTestId('list-wall-face-count')).toHaveTextContent('2')
  })
})

describe('list-wall', () => {
  it('orders the squares by state, keeping the list’s order within one; counts each state', () => {
    const tones = { a: 'stale', b: 'late', c: 'ontrack', d: 'late' } as const
    const l = buildWallList({ tabId: 't', name: 'L', showing: false, waiting: false }, ['a', 'b', 'c', 'd'], (k) => tones[k as keyof typeof tones])
    expect(l.squares.map((s) => s.task)).toEqual(['b', 'd', 'c', 'a'])
    expect(l.counts).toEqual({ late: 2, soon: 0, followup: 0, ontrack: 1, stale: 1 })
    expect(wallListWords(l.counts)).toEqual({ late: '2 overdue', followup: '', calm: '' })
    expect(wallListWords({ late: 0, soon: 2, followup: 0, ontrack: 0, stale: 0 }).calm).toBe('2 due soon')
  })

  it('a big list stops at six rows, its last three squares giving way to +N', () => {
    const l = buildWallList({ tabId: 't', name: 'L', showing: false, waiting: false }, Array.from({ length: 100 }, (_, i) => i), () => 'ontrack')
    const { squares, more } = wallSquaresShown(l)
    expect(squares).toHaveLength(14 * 6 - 3)
    expect(more).toBe(100 - squares.length)
  })

  it('a short wall trades rows for columns, two rows and 28 columns at most', () => {
    expect(wallGridShape(30, 6)).toEqual({ columns: 14, rows: 6 })
    // Three rows: 84 squares want 28 columns; 30 fit in 14.
    expect(wallGridShape(100, 3)).toEqual({ columns: 28, rows: 3 })
    expect(wallGridShape(30, 3)).toEqual({ columns: 14, rows: 3 })
    expect(wallGridShape(50, 2)).toEqual({ columns: 25, rows: 2 })
    expect(wallGridShape(50, 0)).toEqual({ columns: 25, rows: 2 })
    expect(wallGridShape(100, Number.POSITIVE_INFINITY)).toEqual({ columns: 14, rows: 6 })
    const l = buildWallList({ tabId: 't', name: 'L', showing: false, waiting: false }, Array.from({ length: 100 }, (_, i) => i), () => 'ontrack')
    expect(wallSquaresShown(l, 3)).toMatchObject({ columns: 28, more: 100 - 81 })
    // 130px of wall: five rows under a block's name and words.
    expect(wallRowsFit(130)).toBe(5)
  })

  it('a wide, short cell keeps its blocks, their grids widened', () => {
    height = 110
    render(<ListWallWidget tab={WALL} />)
    expect(document.querySelector('[data-list-wall-face="large"]')).not.toBeNull()
    expect((document.querySelector('[data-wall-list="t-all"]') as HTMLElement).style.getPropertyValue('--wall-columns')).toBe('14')
  })
})
