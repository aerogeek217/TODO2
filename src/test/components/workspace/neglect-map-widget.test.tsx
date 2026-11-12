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
import { WidgetFaceContext } from '../../../hooks/use-widget-face'

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

/** The width every element measures (JSDOM lays nothing out): wide enough for the Slipping list beside the plot unless a test narrows it. */
let measuredWidth = 1200

beforeEach(() => {
  measuredWidth = 1200
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => measuredWidth)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => 600)
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
  vi.restoreAllMocks()
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

  it('each zone’s word carries its count and opens its tasks as a list; an empty zone’s word is no button', () => {
    render(<NeglectMapWidget tab={neglectTab()} />)
    const word = (zone: string) => document.querySelector<HTMLElement>(`[data-neglect-zone="${zone}"]`)
    expect(['slipping', 'inHand', 'planned', 'drifting', 'noDue', 'forgotten'].map((z) => word(z)?.textContent))
      .toEqual(['Slipping 2', 'In hand 1', 'Planned 1', 'Drifting 1', 'No due date · 2', 'Forgotten · 1'])
    fireEvent.click(screen.getByRole('button', { name: 'Slipping: show 2 tasks' }))
    expect(useUIStore.getState().taskDialog).toMatchObject({ title: 'Slipping', source: { kind: 'todos', todoIds: [1, 2] } })
    fireEvent.click(screen.getByRole('button', { name: 'In hand: show 1 task' }))
    expect(useUIStore.getState().taskDialog).toMatchObject({
      title: 'In hand',
      description: 'Open tasks due soon or late that changed in the last 14 days, latest first.',
      source: { kind: 'todos', todoIds: [3] },
    })
    // The strip's No due date: every task without one, the longest untouched first.
    fireEvent.click(screen.getByRole('button', { name: 'No due date: show 2 tasks' }))
    expect(useUIStore.getState().taskDialog).toMatchObject({ title: 'No due date', source: { kind: 'todos', todoIds: [6, 7] } })
    fireEvent.click(screen.getByRole('button', { name: 'Forgotten: show 1 task' }))
    expect(useUIStore.getState().taskDialog).toMatchObject({ title: 'Forgotten', source: { kind: 'todos', todoIds: [6] } })
    // Nothing drifting: the word stays, with its 0, and is not a button.
    act(() => useTodoStore.setState({ todos: useTodoStore.getState().todos.filter((t) => t.id !== 5) }))
    expect(word('drifting')).toBeNull()
    expect(screen.getByText('Drifting 0')).toBeInTheDocument()
  })

  it('a widget under 900px wide has no Slipping list and no numbers on its dots; its plot fills it', () => {
    measuredWidth = 700
    render(<NeglectMapWidget tab={neglectTab()} />)
    expect(screen.queryByRole('region', { name: 'Slipping' })).toBeNull()
    expect(document.querySelector('[data-neglect-map]')).toHaveAttribute('data-layout', 'beside')
    expect(document.querySelector('[data-neglect-map]')).not.toHaveAttribute('data-slipping-list')
    expect(dotOf('Late and old')?.textContent).toBe('')
    // Its Slipping tasks are a press away.
    fireEvent.click(screen.getByRole('button', { name: 'Slipping: show 2 tasks' }))
    expect(useUIStore.getState().taskDialog).toMatchObject({ title: 'Slipping' })
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

describe('NeglectMapWidget faces (D25 R)', () => {
  it('small: the Slipping count of the open tasks placed, no plot and no change (it can’t be rebuilt)', () => {
    render(<WidgetFaceContext.Provider value={{ forced: 'small' }}><NeglectMapWidget tab={neglectTab()} /></WidgetFaceContext.Provider>)
    expect(screen.getByTestId('neglect-face-count')).toHaveTextContent('2')
    expect(screen.getByTestId('neglect-face-count').dataset.lit).toBe('true')
    expect(screen.getByRole('group', { name: 'Slipping: 2 of 7 open' })).toBeInTheDocument()
    expect(dots()).toHaveLength(0)
  })

  it('medium: the numbered Slipping list without the plot; a row opens its task', () => {
    render(<WidgetFaceContext.Provider value={{ forced: 'medium' }}><NeglectMapWidget tab={neglectTab()} /></WidgetFaceContext.Provider>)
    expect(dots()).toHaveLength(0)
    const list = screen.getByRole('region', { name: 'Slipping' })
    expect(within(list).getByTestId('neglect-slipping-count')).toHaveTextContent('2')
    const rows = within(list).getAllByRole('button')
    expect(rows.map((r) => r.textContent?.slice(0, 1))).toEqual(['1', '2'])
    fireEvent.click(rows[0]!)
    expect(useUIStore.getState().selectedTodoId).not.toBeNull()
    expect(document.querySelector('[data-neglect-map]')).toBeNull()
  })
})
