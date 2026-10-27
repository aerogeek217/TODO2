import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TopBar } from '../../../components/layout/TopBar'
import {
  FILTER_PANEL_GUTTER, FILTER_PANEL_MIN_WIDTH, filterPanelPlacement,
} from '../../../components/overlays/filter-panel-placement'
import { emptyPredicate } from '../../../models/filter-predicate'
import { useFilterStore } from '../../../stores/filter-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { DEFAULT_HOT_RULE } from '../../../utils/hot'
import { clearFilterStore, resetEntityStores } from '../../helpers'
import {
  ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, PRIYA, SAMPLE_LISTS, SAMPLE_OPEN_COUNT, SAMPLE_TASKS, STATUSES, TAGS,
} from '../../fixtures/dashboard-sample'

/**
 * The top bar's filtered-tasks panel: Show N tasks (and the palette's
 * command) open the screen filter's tasks under the tray, which edits that
 * filter live; the rows re-resolve per filter change and stay fixed
 * between; Esc, the toggle, Close, a press on the scrim or on the bar
 * outside the tray close it.
 */

describe('filterPanelPlacement', () => {
  const vw = 1280
  const vh = 800

  it('under the tray, left-aligned, as wide as the tray, its top sharing the tray’s bottom border', () => {
    const p = filterPanelPlacement({ left: 200, right: 1100, bottom: 36 }, 40, vw, vh)
    expect(p).toEqual({
      left: 200, top: 35, width: 900, maxHeight: vh - 35 - FILTER_PANEL_GUTTER, scrimTop: 40, joinedLeft: true, joinedRight: true,
    })
  })

  it('at least the rows’ width: wider than a narrow tray (its right corner free)', () => {
    const p = filterPanelPlacement({ left: 200, right: 500, bottom: 36 }, 40, vw, vh)
    expect(p).toMatchObject({ left: 200, width: FILTER_PANEL_MIN_WIDTH, joinedLeft: true, joinedRight: false })
  })

  it('moved left when it would cross the right gutter; never wider than the window less its gutters', () => {
    expect(filterPanelPlacement({ left: 700, right: 900, bottom: 36 }, 40, vw, vh))
      .toMatchObject({ left: vw - FILTER_PANEL_GUTTER - FILTER_PANEL_MIN_WIDTH, joinedLeft: false, joinedRight: false })
    expect(filterPanelPlacement({ left: 100, right: 400, bottom: 36 }, 40, 500, vh))
      .toMatchObject({ left: FILTER_PANEL_GUTTER, width: 500 - 2 * FILTER_PANEL_GUTTER })
  })
})

describe('FilteredTasksPanel', () => {
  const PRIYA_OPEN = ['Draft homepage copy', 'Vendor contract redlines', 'Q4 roadmap deck', 'Q4 forecast']
  const panel = () => document.querySelector<HTMLElement>('[data-filter-panel]')
  const rowTitles = () => Array.from(panel()!.querySelectorAll<HTMLElement>('[data-todo-id]'))
    .map((r) => SAMPLE_TASKS.find((t) => t.id === Number(r.dataset.todoId))?.title)
  const tray = () => document.querySelector<HTMLElement>('header [data-filter-row]')!
  const showButton = () => within(tray()).getByRole('button', { name: /tasks shown\. Show them$/ })

  function renderBar() {
    return render(
      <MemoryRouter initialEntries={['/']}>
        <TopBar />
      </MemoryRouter>,
    )
  }

  function openPanel() {
    renderBar()
    fireEvent.click(showButton())
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 10, 10))
    resetEntityStores()
    clearFilterStore()
    useSettingsStore.setState({ urgentDueWithinDays: 3, hotRule: DEFAULT_HOT_RULE, weekStartsOn: 0 })
    useTodoStore.setState({ todos: SAMPLE_TASKS })
    usePersonStore.setState({ people: PEOPLE, assignedPeopleMap: new Map(SAMPLE_TASKS.map((t) => [t.id, ASSIGNED_PEOPLE.get(t.id) ?? []])) })
    useTagStore.setState({ tags: TAGS, assignedTagsMap: ASSIGNED_TAGS })
    useStatusStore.setState({ statuses: STATUSES })
    useListDefinitionStore.setState({ listDefinitions: SAMPLE_LISTS })
    useListDraftStore.setState({ drafts: {} })
    useUIStore.setState(useUIStore.getInitialState(), true)
    useFilterStore.getState().setPersonIds(new Set([PRIYA]))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('Show N tasks opens the screen filter’s tasks under the tray, focused; the tray hangs it (no task dialog)', () => {
    openPanel()
    expect(panel()).not.toBeNull()
    expect(within(panel()!).getByRole('heading').textContent).toBe('Filtered tasks')
    expect(within(panel()!).getByTestId('task-dialog-count').textContent).toBe('4')
    expect(rowTitles()).toEqual(PRIYA_OPEN)
    expect(panel()!.textContent).toContain('Open tasks matching the screen filter.')
    expect(panel()).toHaveAttribute('role', 'dialog')
    expect(panel()).not.toHaveAttribute('aria-modal')
    expect(document.activeElement).toBe(panel())
    expect(showButton()).toHaveAttribute('aria-expanded', 'true')
    expect(tray().className).toMatch(/trayPanelOpen/)
    expect(document.querySelector('[data-filter-panel-scrim]')).not.toBeNull()
    expect(useUIStore.getState().taskDialog).toBeNull()
    // The tray keeps every filter button (the layout tabs fold instead).
    expect(within(tray()).queryByRole('button', { name: /^Filters/ })).toBeNull()
    // Footer: Copy tasks and Close.
    expect(within(panel()!).getByRole('button', { name: /Copy tasks/ })).toBeTruthy()
    expect(within(panel()!).queryByRole('button', { name: 'Open as tab' })).toBeNull()
  })

  it('a filter change in the tray re-resolves the rows; between changes they stay fixed (a completed one struck through)', () => {
    openPanel()
    const draft = SAMPLE_TASKS.find((t) => t.title === 'Draft homepage copy')!
    act(() => useTodoStore.setState({ todos: SAMPLE_TASKS.map((t) => (t.id === draft.id ? { ...t, isCompleted: true } : t)) }))
    expect(rowTitles()).toEqual(PRIYA_OPEN)
    fireEvent.click(within(tray()).getByRole('button', { name: 'Show completed' }))
    expect(rowTitles()).toEqual(expect.arrayContaining([...PRIYA_OPEN, 'Team lunch booking']))
    expect(panel()!.textContent).toContain('Tasks matching the screen filter, completed ones included.')
    fireEvent.click(within(tray()).getByRole('button', { name: 'Show completed' }))
    expect(rowTitles()).toEqual(PRIYA_OPEN.filter((t) => t !== 'Draft homepage copy'))
  })

  it('typing in the tray’s search narrows the rows; no search dropdown while it is open', async () => {
    openPanel()
    const search = within(tray()).getByRole('textbox', { name: 'Search tasks' })
    fireEvent.focus(search)
    fireEvent.change(search, { target: { value: 'q4 forecast' } })
    await vi.waitFor(() => expect(rowTitles()).toEqual(['Q4 forecast']))
    expect(document.getElementById('search-results')).toBeNull()
    expect(search).toHaveAttribute('aria-expanded', 'false')
  })

  it('Clear all keeps it open on every open task, with Show N tasks still its toggle', () => {
    openPanel()
    fireEvent.click(within(tray()).getByRole('button', { name: 'Clear all filters' }))
    expect(panel()).not.toBeNull()
    expect(within(panel()!).getByTestId('task-dialog-count').textContent).toBe(String(SAMPLE_OPEN_COUNT))
    expect(panel()!.textContent).toContain('Every open task: no screen filter is on.')
    expect(showButton()).toHaveTextContent(`${SAMPLE_OPEN_COUNT}of ${SAMPLE_OPEN_COUNT}`)
    fireEvent.click(showButton())
    expect(panel()).toBeNull()
    expect(within(tray()).queryByRole('button', { name: /tasks shown\. Show them$/ })).toBeNull()
  })

  it('Esc closes it from the panel and gives the focus back to Show N tasks — not while the editor is open', () => {
    openPanel()
    act(() => useUIStore.setState({ editPopupMode: 'edit', selectedTodoId: 1 }))
    fireEvent.keyDown(panel()!, { key: 'Escape' })
    expect(panel()).not.toBeNull()
    act(() => useUIStore.setState({ editPopupMode: null, selectedTodoId: null }))
    // Focus came back to the panel when the editor closed.
    expect(document.activeElement).toBe(panel())
    fireEvent.keyDown(panel()!, { key: 'Escape' })
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(showButton())
  })

  it('Esc in the tray’s search: the text first, then the panel', async () => {
    openPanel()
    const search = within(tray()).getByRole('textbox', { name: 'Search tasks' })
    fireEvent.change(search, { target: { value: 'q4' } })
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(panel()).not.toBeNull()
    expect(search).toHaveValue('')
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(panel()).toBeNull()
  })

  it('Esc in a layer of its own (a dialog above) is not the panel’s', () => {
    openPanel()
    const modal = document.createElement('div')
    modal.setAttribute('aria-modal', 'true')
    document.body.append(modal)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(panel()).not.toBeNull()
    modal.remove()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(panel()).toBeNull()
  })

  it('a press on the scrim closes it; so does Close', () => {
    openPanel()
    const scrim = document.querySelector<HTMLElement>('[data-filter-panel-scrim]')!
    fireEvent.mouseDown(scrim)
    fireEvent.click(scrim)
    expect(panel()).toBeNull()
    fireEvent.click(showButton())
    fireEvent.click(within(panel()!).getByRole('button', { name: /^Close\s*Esc$/ }))
    expect(panel()).toBeNull()
  })

  it('a press on the bar outside the tray closes it first, then does its own thing; one in the tray doesn’t', () => {
    openPanel()
    fireEvent.mouseDown(within(tray()).getByRole('textbox', { name: 'Search tasks' }))
    expect(panel()).not.toBeNull()
    const gear = document.querySelector<HTMLElement>('header button[aria-label="Settings"]')!
    fireEvent.mouseDown(gear)
    expect(panel()).toBeNull()
    fireEvent.click(gear)
    expect(useUIStore.getState().settingsOpen).toBe(true)
  })

  it('the lens control is outside the tray: a press on it closes the panel, then its picker opens and picks', () => {
    useSettingsStore.setState({ lenses: [{ id: 'lens-a', name: 'Mine', predicate: emptyPredicate() }] })
    openPanel()
    const name = within(screen.getByTestId('lens-control')).getByRole('button', { name: 'Lens: none' })
    fireEvent.mouseDown(name)
    expect(panel()).toBeNull()
    fireEvent.click(name)
    fireEvent.click(within(screen.getByRole('menu', { name: 'Lens' })).getByRole('menuitemradio', { name: /^Mine/ }))
    expect(useSettingsStore.getState().activeLensId).toBe('lens-a')
  })

  it('the palette’s command focuses it again while it is open', () => {
    openPanel()
    const copy = within(panel()!).getByRole('button', { name: /Copy tasks/ })
    copy.focus()
    act(() => useUIStore.getState().openFilterPanel())
    expect(document.activeElement).toBe(panel())
  })

  it('Tab runs on from the tray’s end into the panel, and Shift+Tab back', () => {
    openPanel()
    showButton().focus()
    fireEvent.keyDown(showButton(), { key: 'Tab' })
    const first = panel()!.querySelector<HTMLElement>('button, input')!
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(showButton())
  })
})
