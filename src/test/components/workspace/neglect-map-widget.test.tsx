import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, act, within } from '@testing-library/react'
import { NeglectMapWidget, SLIPPING_LISTED } from '../../../components/workspace/neglect/NeglectMapWidget'
import { useTodoStore } from '../../../stores/todo-store'
import { useTagStore } from '../../../stores/tag-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useFilterStore } from '../../../stores/filter-store'
import { useUIStore } from '../../../stores/ui-store'
import type { NeglectTab } from '../../../models/workspace-layout'
import type { PersistedTodoItem } from '../../../models'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'

const TODAY = new Date(2026, 10, 10, 10) // Tue 10 Nov 2026
const day = (offset: number, hour = 0) => new Date(2026, 10, 10 + offset, hour)

/** A task untouched `untouched` days, due in `due` days (none when absent). */
function task(id: number, title: string, untouched: number, due?: number, extra: Partial<PersistedTodoItem> = {}): PersistedTodoItem {
  return makeTodo({ id, title, modifiedAt: day(-untouched, 9), ...(due != null ? { dueDate: day(due) } : {}), sortOrder: id, ...extra })
}

function neglectTab(config: Partial<NeglectTab['config']> = {}): NeglectTab {
  return { id: 'map', kind: 'neglect', config: { colourBy: { kind: 'tags', tagIds: [7] }, untouchedDays: 14, ...config } }
}

const dots = (zone?: string) => [...document.querySelectorAll<HTMLElement>(zone ? `[data-neglect-dot="${zone}"]` : '[data-neglect-dot]')]
const dotOf = (title: string) => dots().find((d) => d.getAttribute('aria-label')?.startsWith(`${title}:`))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ urgentDueWithinDays: 3 })
  useUIStore.setState({ selectedTodoId: null, editPopupMode: null })
  useTodoStore.setState({
    todos: [
      task(1, 'Late and old', 26, -4, { urgent: true }),
      task(2, 'Soon and old', 30, 2, { nextFollowupAt: day(-2) }),
      task(3, 'Late but fresh', 2, -1),
      task(4, 'Later and fresh', 1, 12),
      task(5, 'Later and old', 40, 20),
      task(6, 'No date, old', 50),
      task(7, 'No date, fresh', 3),
      task(8, 'Done', 40, -3, { isCompleted: true }),
    ],
  })
  const project = { id: 7, name: 'Project: Alpha', color: '#123456' }
  useTagStore.setState({ tags: [project], assignedTagsMap: new Map([[1, [project]]]) })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('NeglectMapWidget', () => {
  it('places every open task in its zone; completed tasks are left out', () => {
    render(<NeglectMapWidget tab={neglectTab()} />)
    expect(dots()).toHaveLength(7)
    expect(dots('slipping').map((d) => d.getAttribute('aria-label'))).toEqual([
      'Late and old: Slipping · 4d late · 26d untouched',
      'Soon and old: Slipping · due in 2d · 30d untouched · follow-up late',
    ])
    expect(dots('inHand')).toHaveLength(1)
    expect(dots('planned')).toHaveLength(1)
    expect(dots('drifting')).toHaveLength(1)
    expect(dots('forgotten')).toHaveLength(1)
    expect(dots('noDue')).toHaveLength(1)
    expect(screen.getByText('No due date · 2')).toBeInTheDocument()
    expect(screen.getByTestId('neglect-forgotten').textContent).toBe('Forgotten · 1')
  })

  it('lists Slipping latest first, numbered, the same number by each dot', () => {
    render(<NeglectMapWidget tab={neglectTab()} />)
    const list = screen.getByRole('region', { name: 'Slipping' })
    const rows = within(list).getAllByRole('button')
    expect(rows.map((r) => r.textContent)).toEqual(['1Late and old4d late · 26d untouched', '2Soon and olddue in 2d · 30d untouched'])
    expect(dotOf('Late and old')?.textContent).toBe('1')
    expect(dotOf('Soon and old')?.textContent).toBe('2')
    expect(dotOf('Later and old')?.textContent).toBe('')
    expect(screen.getByTestId('neglect-slipping-count').textContent).toBe('2')
  })

  it('colours a dot by its picked tag, sizes it up for a priority flag, rings a late follow-up', () => {
    render(<NeglectMapWidget tab={neglectTab()} />)
    const late = dotOf('Late and old')!
    expect(late.style.getPropertyValue('--dot-colour')).toBe('#123456')
    expect(late.dataset.marked).toBe('true')
    expect(late.dataset.followupLate).toBeUndefined()
    const soon = dotOf('Soon and old')!
    expect(soon.style.getPropertyValue('--dot-colour')).toBe('')
    expect(soon.dataset.marked).toBeUndefined()
    expect(soon.dataset.followupLate).toBe('true')
  })

  it('a dot or a Slipping row opens the task; Ctrl+click selects it in the widget instead', () => {
    render(<NeglectMapWidget tab={neglectTab()} />)
    fireEvent.click(dotOf('Later and old')!)
    expect(useUIStore.getState()).toMatchObject({ selectedTodoId: 5, editPopupMode: 'edit' })
    act(() => useUIStore.setState({ selectedTodoId: null, editPopupMode: null }))
    fireEvent.click(within(screen.getByRole('region', { name: 'Slipping' })).getByText('Soon and old'))
    expect(useUIStore.getState()).toMatchObject({ selectedTodoId: 2, editPopupMode: 'edit' })
    act(() => useUIStore.setState({ selectedTodoId: null, editPopupMode: null }))
    fireEvent.click(dotOf('Later and old')!, { ctrlKey: true })
    fireEvent.click(dotOf('No date, old')!, { ctrlKey: true })
    expect(useUIStore.getState().editPopupMode).toBeNull()
    expect(useUIStore.getState().selectionScope).toBe('map')
    expect([...useUIStore.getState().selectedTodoIds].sort()).toEqual([5, 6])
    expect(dotOf('Later and old')?.dataset.selected).toBe('true')
    // Two selected: the bulk bar.
    expect(screen.getByText('2 selected')).toBeInTheDocument()
  })

  it('the screen filter narrows the dots; hiding them all says so', () => {
    render(<NeglectMapWidget tab={neglectTab()} />)
    act(() => useFilterStore.getState().setSearchText('old'))
    expect(dots().map((d) => d.getAttribute('aria-label')?.split(':')[0])).toEqual(['Late and old', 'Soon and old', 'Later and old', 'No date, old'])
    act(() => useFilterStore.getState().setSearchText('nothing like this'))
    expect(dots()).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toContain('All 7 open tasks are hidden by the screen filter.')
  })

  it('the threshold moves the line between touched and untouched', () => {
    render(<NeglectMapWidget tab={neglectTab({ untouchedDays: 30 })} />)
    expect(dots('slipping').map((d) => d.getAttribute('aria-label')?.split(':')[0])).toEqual(['Soon and old'])
    expect(dots('inHand')).toHaveLength(2)
  })

  it(`numbers the first ${SLIPPING_LISTED} Slipping tasks; the rest open in the task dialog`, () => {
    useTodoStore.setState({ todos: Array.from({ length: 12 }, (_, i) => task(i + 1, `Slip ${i + 1}`, 20, -(i + 1))) })
    render(<NeglectMapWidget tab={neglectTab()} />)
    const list = screen.getByRole('region', { name: 'Slipping' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(SLIPPING_LISTED)
    fireEvent.click(within(list).getByRole('button', { name: '3 more' }))
    const dialog = useUIStore.getState().taskDialog
    expect(dialog).toMatchObject({ title: 'Slipping', source: { kind: 'todos', todoIds: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1] } })
  })

  it('colours by person, or not at all', () => {
    const { rerender } = render(<NeglectMapWidget tab={neglectTab({ colourBy: { kind: 'none' } })} />)
    expect(dotOf('Late and old')!.style.getPropertyValue('--dot-colour')).toBe('')
    rerender(<NeglectMapWidget tab={neglectTab({ colourBy: { kind: 'people' } })} />)
    expect(dotOf('Late and old')!.style.getPropertyValue('--dot-colour')).toBe('')
  })
})
