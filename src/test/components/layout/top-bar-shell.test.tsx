import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TopBar } from '../../../components/layout/TopBar'
import { useFilterStore } from '../../../stores/filter-store'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useFileStorageStore } from '../../../services/file-storage-store'
import { makeTodo } from '../../helpers'

function renderBar() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <TopBar />
    </MemoryRouter>,
  )
}

describe('TopBar — app shell', () => {
  beforeEach(() => {
    useFilterStore.setState(useFilterStore.getInitialState(), true)
    useUIStore.setState(useUIStore.getInitialState(), true)
    useTodoStore.setState(useTodoStore.getInitialState(), true)
    usePersonStore.setState(usePersonStore.getInitialState(), true)
    useStatusStore.setState(useStatusStore.getInitialState(), true)
    useTagStore.setState(useTagStore.getInitialState(), true)
    useFileStorageStore.setState(useFileStorageStore.getInitialState(), true)
  })

  afterEach(cleanup)

  it('New task opens quick add', () => {
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'New task' }))
    expect(useUIStore.getState().quickAddOpen).toBe(true)
  })

  it('the gear opens Settings, without leaving the route', () => {
    renderBar()
    const gear = screen.getByRole('button', { name: 'Settings' })
    expect(gear).toHaveAttribute('data-tooltip', 'Settings')
    expect(gear).toHaveAttribute('data-tooltip-shortcut', 'G then S')
    fireEvent.click(gear)
    expect(useUIStore.getState().settingsOpen).toBe(true)
  })

  it('has no theme toggle', () => {
    renderBar()
    expect(screen.queryByRole('button', { name: /theme/i })).toBeNull()
  })

  it('the filter tray is marked filtered while any screen filter is on', () => {
    renderBar()
    const tray = screen.getByRole('group', { name: 'Screen filters — apply to every widget' })
    expect(tray).not.toHaveAttribute('data-filtered')
    act(() => useFilterStore.getState().setShowCompleted(true))
    expect(tray).toHaveAttribute('data-filtered', 'true')
    // Show completed's pill (`done`): its × hides them again.
    fireEvent.click(within(tray).getByRole('button', { name: 'Remove done' }))
    expect(tray).not.toHaveAttribute('data-filtered')
  })

  it('the search is a plain text box: no aria-expanded, and it controls the results only while they show (cr31 UI F9)', () => {
    renderBar()
    const search = within(screen.getByRole('group', { name: 'Screen filters — apply to every widget' })).getByRole('textbox', { name: 'Filter tasks' })
    expect(search).not.toHaveAttribute('aria-expanded')
    expect(search).not.toHaveAttribute('aria-controls')
  })

  it('the funnel leads the tray and pauses the filter: dim and inert with none, a click pauses, another resumes; the Filter button follows the field', () => {
    useTodoStore.setState({ todos: [makeTodo({ id: 1, title: 'Alpha' }), makeTodo({ id: 2, title: 'Beta' })] })
    renderBar()
    const tray = screen.getByRole('group', { name: 'Screen filters — apply to every widget' })
    const funnel = within(tray).getByRole('button', { name: 'Pause the filter' })
    const search = within(tray).getByRole('textbox', { name: 'Filter tasks' })
    const filter = within(tray).getByRole('button', { name: 'Filter' })
    expect(tray.firstElementChild).toBe(funnel)
    expect(search.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(funnel).toBeDisabled()
    expect(funnel).not.toHaveAttribute('aria-pressed')
    act(() => useFilterStore.getState().setSearchText('alpha'))
    expect(funnel).toBeEnabled()
    expect(funnel).toHaveAttribute('aria-pressed', 'false')
    expect(tray).toHaveAttribute('data-filtered', 'true')
    expect(within(tray).getByRole('button', { name: /^1 of 2 open tasks shown/ })).toBeInTheDocument()

    // Paused: the filter stays, nothing applies it — the tray isn't red, the counter says so.
    fireEvent.click(funnel)
    expect(useFilterStore.getState().paused).toBe(true)
    expect(useFilterStore.getState().filters.searchText).toBe('alpha')
    expect(funnel).toHaveAttribute('aria-pressed', 'true')
    expect(funnel).toHaveAttribute('data-paused', 'true')
    expect(tray).not.toHaveAttribute('data-filtered')
    expect(tray).toHaveAttribute('data-filter-paused', 'true')
    const counter = within(tray).getByRole('button', { name: /^2 open tasks shown, the filter paused\. Show them$/ })
    expect(counter).toHaveTextContent('2open · paused')

    // Again: resumed.
    fireEvent.click(funnel)
    expect(useFilterStore.getState().paused).toBe(false)
    expect(tray).toHaveAttribute('data-filtered', 'true')
    expect(within(tray).getByRole('button', { name: /^1 of 2 open tasks shown/ })).toBeInTheDocument()
  })

  it('the field’s × clears every filter at once — a paused one too —, shown only while a filter is on; the Filter menu keeps its Clear all filters', () => {
    renderBar()
    const tray = screen.getByRole('group', { name: 'Screen filters — apply to every widget' })
    expect(within(tray).queryByRole('button', { name: 'Clear all filters' })).toBeNull()
    act(() => {
      useFilterStore.getState().setPersonIds(new Set([1]))
      useFilterStore.getState().setShowCompleted(true)
      useFilterStore.getState().applyExpression({ kind: 'or', items: [{ kind: 'tag', id: 1 }, { kind: 'tag', id: 2 }] }, true)
      useFilterStore.getState().setPaused(true)
    })
    fireEvent.click(within(tray).getByRole('button', { name: 'Clear all filters' }))
    expect(useFilterStore.getState().isActive).toBe(false)
    expect(useFilterStore.getState().paused).toBe(false)
    expect(useFilterStore.getState().filters.expression).toBeUndefined()
    expect(within(tray).queryByRole('button', { name: 'Clear all filters' })).toBeNull()
    expect(within(tray).getByRole('button', { name: 'Pause the filter' })).toBeDisabled()
    // The Filter menu keeps its own Clear all filters.
    act(() => useFilterStore.getState().setPersonIds(new Set([1])))
    fireEvent.click(within(tray).getByRole('button', { name: /^Filter/ }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Screen filters' })).getByRole('button', { name: 'Clear all filters' }))
    expect(useFilterStore.getState().filters.personIds).toBeNull()
    expect(screen.queryByRole('group', { name: 'Screen filters' })).toBeNull()
  })

  it('paused, the field’s pills are dimmed and struck through; an × on one resumes the filter with the change', () => {
    renderBar()
    act(() => {
      useFilterStore.getState().applyExpression({ kind: 'and', items: [{ kind: 'text', text: 'alpha' }, { kind: 'text', text: 'beta' }] }, false)
      useFilterStore.getState().setPaused(true)
    })
    const pills = screen.getByTestId('top-bar-pills')
    expect(pills).toHaveAttribute('data-paused', 'true')
    fireEvent.click(within(pills).getByRole('button', { name: 'Remove "beta"' }))
    expect(useFilterStore.getState().paused).toBe(false)
    expect(screen.getByTestId('top-bar-pills')).not.toHaveAttribute('data-paused')
  })

  it('the counter ends the tray while a filter is on: what it keeps of every task; a click opens the filtered-tasks panel', () => {
    useTodoStore.setState({ todos: [
      makeTodo({ id: 1, title: 'Alpha' }),
      makeTodo({ id: 2, title: 'Alpha done', isCompleted: true }),
      makeTodo({ id: 3, title: 'Beta' }),
    ] })
    renderBar()
    const tray = screen.getByRole('group', { name: 'Screen filters — apply to every widget' })
    expect(within(tray).queryByRole('button', { name: /tasks shown\. Show them$/ })).toBeNull()
    act(() => useFilterStore.getState().setSearchText('alpha'))
    // Open ones only…
    expect(within(tray).getByRole('button', { name: '1 of 2 open tasks shown. Show them' })).toBeTruthy()
    // …completed too under Show completed; a task write updates it.
    act(() => useFilterStore.getState().setShowCompleted(true))
    expect(within(tray).getByRole('button', { name: '2 of 3 tasks shown. Show them' })).toBeTruthy()
    act(() => useTodoStore.setState({ todos: [...useTodoStore.getState().todos, makeTodo({ id: 4, title: 'Alpha two' })] }))
    const button = within(tray).getByRole('button', { name: '3 of 4 tasks shown. Show them' })
    expect(tray.lastElementChild).toBe(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(useUIStore.getState().filterPanelOpen).toBe(true)
    expect(useUIStore.getState().taskDialog).toBeNull()
    expect(button).toHaveAttribute('aria-expanded', 'true')
    // Cleared with the panel open: the button stays (the panel's toggle), now every open task.
    act(() => useFilterStore.getState().clearAll())
    expect(within(tray).getByRole('button', { name: '3 of 3 open tasks shown. Show them' })).toBe(button)
    fireEvent.click(button)
    expect(useUIStore.getState().filterPanelOpen).toBe(false)
    // Closed with no filter: it goes.
    expect(within(tray).queryByRole('button', { name: /tasks shown\. Show them$/ })).toBeNull()
  })

  it('the counter carries a list tab’s badge: the open tasks it shows due / due for a follow-up in the tab badge ranges', () => {
    const day = (offset: number) => {
      const d = new Date()
      d.setHours(12, 0, 0, 0)
      d.setDate(d.getDate() + offset)
      return d
    }
    useTodoStore.setState({ todos: [
      makeTodo({ id: 1, title: 'Alpha late', dueDate: day(-1) }),
      makeTodo({ id: 2, title: 'Alpha soon', dueDate: day(2) }),
      makeTodo({ id: 3, title: 'Alpha chase', nextFollowupAt: day(0) }),
      makeTodo({ id: 4, title: 'Alpha done', dueDate: day(-1), isCompleted: true }),
      makeTodo({ id: 5, title: 'Beta late', dueDate: day(-1) }),
    ] })
    // The defaults: due overdue and within 3 days; follow-ups overdue and today.
    renderBar()
    const tray = screen.getByRole('group', { name: 'Screen filters — apply to every widget' })
    act(() => useFilterStore.getState().setSearchText('alpha'))
    const button = within(tray).getByRole('button', {
      name: '3 of 4 open tasks shown, 2 due: 1 overdue, 1 within 3 days, 1 follow-up: today. Show them',
    })
    const capsule = button.querySelector('[data-counter-badge]')
    expect(capsule).toHaveAttribute('aria-hidden', 'true')
    expect(capsule?.querySelector('[data-badge-part="due"]')).toHaveTextContent('2')
    expect(capsule?.querySelector('[data-badge-part="followup"]')).toHaveTextContent('1')
    // Ranges off (Settings › Tasks): no badge.
    act(() => useSettingsStore.setState({ tabBadges: { due: 'off', followup: 'off' } }))
    expect(within(tray).getByRole('button', { name: '3 of 4 open tasks shown. Show them' }).querySelector('[data-counter-badge]')).toBeNull()
  })
})
