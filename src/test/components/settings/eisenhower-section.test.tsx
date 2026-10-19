import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, within, screen, act } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { SettingsModal } from '../../../components/settings/SettingsModal'
import { EisenhowerWidget } from '../../../components/workspace/eisenhower/EisenhowerWidget'
import { openEisenhowerSettings } from '../../../components/workspace/eisenhower/eisenhower-settings-link'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import { useFilterStore } from '../../../stores/filter-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import type { PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import type { PersistedListDefinition } from '../../../models/list-definition'
import type { EisenhowerPanes } from '../../../models/eisenhower-settings'
import { emptyPredicate, type TodoPredicate } from '../../../models'
import { defaultPaneFilter } from '../../../utils/eisenhower-panes'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'

/**
 * Settings › Tasks › Eisenhower: Show (all tasks / a saved list, asking
 * first about a source list's unsaved edits), the four pane cards (name,
 * filter chips, count now, Reset pane), the open tasks in no pane and Reset
 * all panes — each change one undo step; the workspace's shortcuts open it.
 */

const TODAY = new Date(2026, 9, 10, 10)
const NOT_DELEGATED: TodoPredicate = { ...defaultPaneFilter('delegate'), statusIds: [3], negate: { statusIds: true } }
const AT = new Date(2026, 0, 1)

const list = (id: number, name: string, predicate: TodoPredicate = emptyPredicate()): PersistedListDefinition => ({
  id, name, sortOrder: id, sort: 'deadline', grouping: 'none', membership: { kind: 'custom', predicate },
})

/** The open layout: one Eisenhower tab. */
function showLayout(): void {
  const layout: PersistedWorkspaceLayout = {
    id: 1, name: 'Main', createdAt: AT, modifiedAt: AT,
    columns: [{ id: 'c1', weight: 1, cells: [{ id: 'x1', weight: 1, tabs: [{ id: 'eis', kind: 'eisenhower', config: {} }] }] }],
  }
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, isDirty: false, hydrated: true })
}

function Widget() {
  const tab = useWorkspaceStore((s) => s.working?.columns[0]?.cells[0]?.tabs[0])
  return tab?.kind === 'eisenhower' ? <EisenhowerWidget tab={tab} /> : null
}

/** Opens Settings › Tasks › Eisenhower (on `focusPane`'s name), the panes setting `panes`. */
function open(panes: EisenhowerPanes = {}, opts: { widget?: boolean; focus?: Parameters<typeof openEisenhowerSettings>[0] } = {}) {
  useSettingsStore.setState({ eisenhowerPanes: panes })
  showLayout()
  render(<DndContext>{opts.widget && <Widget />}<SettingsModal /></DndContext>)
  act(() => openEisenhowerSettings(opts.focus))
  const settings = screen.getByRole('dialog', { name: 'Settings' })
  const part = within(settings).getByRole('region', { name: 'Eisenhower' })
  return { settings, part }
}

const card = (part: HTMLElement, q: string) => part.querySelector<HTMLElement>(`[data-pane-card="${q}"]`)!
const storedPanes = () => useSettingsStore.getState().eisenhowerPanes
const undoNames = () => useUndoStore.getState().undoStack.map((e) => e.description)
const quadrant = (q: string) => document.querySelector<HTMLElement>(`[data-eis-quadrant="${q}"]`)!

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  resetEntityStores()
  clearFilterStore()
  useUIStore.setState(useUIStore.getInitialState(), true)
  useSettingsStore.setState({ urgentDueWithinDays: 3, eisenhowerListId: null })
  useListDraftStore.setState({ drafts: {} })
  useStatusStore.setState({ statuses: [{ id: 3, name: 'Delegated', color: '#000', icon: 'circle', sortOrder: 1 }] })
  useTodoStore.setState({
    todos: [
      makeTodo({ id: 1, title: 'Chase vendor', urgent: true, statusId: 3, sortOrder: 1 }),
      makeTodo({ id: 2, title: 'Analytics', urgent: true, sortOrder: 2 }),
      makeTodo({ id: 3, title: 'Draft OKRs', important: true, sortOrder: 3 }),
      makeTodo({ id: 4, title: 'Blog', sortOrder: 4 }),
    ],
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Settings › Tasks › Eisenhower', () => {
  it('sits in Tasks between Task defaults and Completed tasks; the tab menu’s shortcut opens it there', () => {
    const { settings } = open()
    expect(Array.from(settings.querySelectorAll('h3')).map((h) => h.textContent)).toEqual(['Task defaults', 'Eisenhower', 'Completed tasks'])
    expect(settings.querySelector('h2')?.textContent).toBe('Tasks')
    // Shown: the part and focus are forgotten, so reopening later doesn't jump again.
    expect(useUIStore.getState()).toMatchObject({ settingsPart: null, settingsFocus: null })
  })

  it('a pane header’s Edit pane… lands on that pane’s name', () => {
    const { part } = open({}, { focus: 'schedule' })
    expect(document.activeElement).toBe(within(card(part, 'schedule')).getByRole('textbox', { name: 'Name' }))
  })

  it('shows each pane’s name, filter chips and count now, and the open tasks in no pane', () => {
    const { part } = open({ delegate: { filter: NOT_DELEGATED } })
    expect(within(card(part, 'delegate')).getByTestId('customize-pane-count').textContent).toBe('1 now')
    expect(within(card(part, 'delegate')).getByRole('img', { name: '1 open task now' })).toBeTruthy()
    expect(within(card(part, 'do')).getByRole('img', { name: '0 open tasks now' })).toBeTruthy()
    expect(within(card(part, 'delegate')).getByTestId('customize-pane-filter').textContent).toContain('not Delegated')
    expect(within(part).getByTestId('customize-panes-no-pane').textContent).toContain('1 open task is in no pane')
    expect(within(card(part, 'do')).getByRole('button', { name: 'Reset pane' })).toHaveProperty('disabled', true)
  })

  it('a rename is written at once (trimmed; the default name or blank = none), one undo step however it is typed', async () => {
    const { part } = open({}, { focus: 'drop' })
    const name = within(card(part, 'drop')).getByRole('textbox', { name: 'Name' })
    fireEvent.change(name, { target: { value: 'S' } })
    fireEvent.change(name, { target: { value: 'Someday ' } })
    expect(storedPanes()).toEqual({ drop: { name: 'Someday' } })
    expect((name as HTMLInputElement).value).toBe('Someday ')
    await vi.waitFor(() => expect(undoNames()).toEqual(['Renamed pane “Drop”']))
    // A typed name shows no snackbar (the field's own undo covers typing).
    expect(useUndoStore.getState().snackbar).toBeNull()
    await act(() => useUndoStore.getState().undo())
    expect(storedPanes()).toEqual({})
    expect((name as HTMLInputElement).value).toBe('')
    await act(() => useUndoStore.getState().redo())
    expect(storedPanes()).toEqual({ drop: { name: 'Someday' } })
    fireEvent.change(name, { target: { value: 'Drop' } })
    expect(storedPanes()).toEqual({})
  })

  it('Reset pane and Reset all panes (asked first) put the defaults back (the name field too), one undo step each, with the snackbar', async () => {
    const { settings, part } = open({ delegate: { name: 'Hand off', filter: NOT_DELEGATED }, drop: { name: 'Someday' } })
    fireEvent.click(within(card(part, 'delegate')).getByRole('button', { name: 'Reset pane' }))
    expect(storedPanes()).toEqual({ drop: { name: 'Someday' } })
    expect((within(card(part, 'delegate')).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('')
    await vi.waitFor(() => expect(useUndoStore.getState().snackbar).toEqual({ description: 'Reset pane “Hand off”' }))

    // Reset all panes asks first; Esc (or Cancel) keeps the panes and Settings.
    const resetAll = within(part).getByRole('button', { name: 'Reset all panes…' })
    fireEvent.click(resetAll)
    const confirm = screen.getByRole('dialog', { name: 'Reset all panes?' })
    fireEvent.keyDown(confirm, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Reset all panes?' })).toBeNull()
    expect(settings.isConnected && useUIStore.getState().settingsOpen).toBe(true)
    expect(storedPanes()).toEqual({ drop: { name: 'Someday' } })

    fireEvent.click(resetAll)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Reset all panes?' })).getByRole('button', { name: 'Reset all panes' }))
    expect(storedPanes()).toEqual({})
    expect(within(part).getByRole('button', { name: 'Reset all panes…' })).toHaveProperty('disabled', true)
    await vi.waitFor(() => expect(undoNames()).toEqual(['Reset pane “Hand off”', 'Reset the Eisenhower panes']))
    expect(useUndoStore.getState().snackbar).toEqual({ description: 'Reset the Eisenhower panes' })
  })

  it('a chip’s × edits the pane’s filter, one undo step, with the snackbar', async () => {
    const { part } = open({ delegate: { filter: NOT_DELEGATED } })
    const chips = within(card(part, 'delegate')).getAllByRole('button', { name: 'Remove filter' })
    // Priority, then Status: remove the status clause.
    fireEvent.click(chips[1]!)
    expect(storedPanes()).toEqual({})
    await vi.waitFor(() => expect(undoNames()).toEqual(['Changed pane “Delegate”']))
    expect(useUndoStore.getState().snackbar).toEqual({ description: 'Changed pane “Delegate”' })
  })

  it('says the screen filter narrows the counts only while one is on', () => {
    const { part } = open()
    expect(within(part).queryByTestId('eisenhower-settings-filter-note')).toBeNull()
    act(() => useFilterStore.getState().setSearchText('a'))
    expect(within(part).getByTestId('eisenhower-settings-filter-note').textContent).toContain('(1 filter on)')
  })

  it('Esc in a pane’s filter picker closes the picker only, not Settings', () => {
    const { part } = open({ delegate: { filter: NOT_DELEGATED } })
    const statusChip = within(card(part, 'delegate')).getAllByTestId('list-filter-chip')[1]!
    fireEvent.click(statusChip)
    const picker = screen.getByTestId('list-filter-picker')
    fireEvent.keyDown(picker, { key: 'Escape' })
    expect(screen.queryByTestId('list-filter-picker')).toBeNull()
    expect(useUIStore.getState().settingsOpen).toBe(true)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(useUIStore.getState().settingsOpen).toBe(false)
  })

  it('its counts are the widget’s: on a saved list, under a screen filter', () => {
    useListDefinitionStore.setState({ listDefinitions: [list(7, 'Not delegated', { ...emptyPredicate(), statusIds: [3], negate: { statusIds: true } })] })
    // The screen filter leaves out Blog; the list leaves out Chase vendor (Delegated).
    useFilterStore.getState().setSearchText('a')
    useSettingsStore.setState({ eisenhowerListId: 7 })
    const { part } = open(
      { do: { filter: { ...emptyPredicate(), searchText: 'zzz' } }, schedule: { filter: { ...emptyPredicate(), statusIds: [3] } } },
      { widget: true },
    )
    const widgetCounts = ['do', 'schedule', 'delegate', 'drop'].map((q) => within(quadrant(q)).getByTestId('eisenhower-count').textContent)
    const partCounts = ['do', 'schedule', 'delegate', 'drop'].map((q) =>
      within(card(part, q)).getByTestId('customize-pane-count').textContent?.replace(' now', ''))
    expect(widgetCounts).toEqual(['0', '0', '1', '0'])
    expect(partCounts).toEqual(widgetCounts)
    // Draft OKRs (Important, no status) matches no pane, in both.
    expect(screen.getByTestId('eisenhower-no-pane').textContent).toBe('1 open task in no pane')
    expect(within(part).getByTestId('customize-panes-no-pane').textContent).toContain('1 open task is in no pane')
  })
})

describe('Settings › Tasks › Eisenhower › Show', () => {
  beforeEach(() => {
    useListDefinitionStore.setState({ listDefinitions: [list(8, 'Team'), list(7, 'Other')] })
  })

  const show = (part: HTMLElement) => within(part).getByTestId('eisenhower-source')

  it('picks all tasks or a saved list (the Change list choices), at once, one undo step each; the widget follows', async () => {
    const { part } = open({}, { widget: true })
    expect(show(part)).toHaveAccessibleName('Eisenhower shows All tasks')
    fireEvent.click(show(part))
    const menu = screen.getByRole('menu', { name: 'Eisenhower shows' })
    const choices = Array.from(menu.querySelectorAll('[role="menuitemradio"]'))
    expect(choices.map((el) => el.textContent)).toEqual(['All tasks', 'Other', 'Team'])
    expect(choices.map((el) => el.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Team' }))
    expect(screen.queryByRole('menu', { name: 'Eisenhower shows' })).toBeNull()
    expect(useSettingsStore.getState().eisenhowerListId).toBe(8)
    expect(show(part)).toHaveTextContent('Team')
    expect(screen.getByTestId('list-filter-row')).toBeTruthy()

    fireEvent.click(show(part))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'All tasks' }))
    expect(useSettingsStore.getState().eisenhowerListId).toBeNull()
    await vi.waitFor(() => expect(undoNames()).toEqual(['Eisenhower shows “Team”', 'Eisenhower shows all tasks']))
    await act(() => useUndoStore.getState().undo())
    expect(useSettingsStore.getState().eisenhowerListId).toBe(8)
  })

  it('a deleted source list reads (Deleted list)', () => {
    useSettingsStore.setState({ eisenhowerListId: 99 })
    const { part } = open()
    expect(show(part)).toHaveTextContent('(Deleted list)')
  })

  it('asks first when the source list’s unsaved edits would be left with no widget; Cancel keeps it, Discard goes on', () => {
    useSettingsStore.setState({ eisenhowerListId: 8 })
    useListDraftStore.setState({ drafts: { 8: { ...list(8, 'Team'), name: 'Team edited' } } })
    const { part } = open()
    fireEvent.click(show(part))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Other' }))
    const prompt = screen.getByRole('dialog', { name: 'Save changes to list “Team”?' })
    // Esc is the prompt's: Settings stays open.
    fireEvent.keyDown(prompt, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Save changes to list “Team”?' })).toBeNull()
    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useSettingsStore.getState().eisenhowerListId).toBe(8)

    fireEvent.click(show(part))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Other' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Save changes to list “Team”?' })).getByRole('button', { name: 'Discard' }))
    expect(useSettingsStore.getState().eisenhowerListId).toBe(7)
    expect(useListDraftStore.getState().drafts[8]).toBeUndefined()
  })
})
