import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, within, screen, act } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { EisenhowerWidget, type EisenhowerResult } from '../../../components/workspace/eisenhower/EisenhowerWidget'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import type { EisenhowerTab, PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import type { EisenhowerPanes } from '../../../models/eisenhower-settings'
import { emptyPredicate, type TodoPredicate } from '../../../models'
import { defaultPaneFilter } from '../../../utils/eisenhower-panes'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'

const TODAY = new Date(2026, 9, 10, 10)

const NOT_DELEGATED: TodoPredicate = { ...defaultPaneFilter('delegate'), statusIds: [3], negate: { statusIds: true } }

function layoutWith(tab: EisenhowerTab): PersistedWorkspaceLayout {
  const now = new Date(2026, 0, 1)
  return { id: 1, sortOrder: 0, name: 'Main', createdAt: now, modifiedAt: now, columns: [{ id: 'c1', weight: 1, cells: [{ id: 'x1', weight: 1, tabs: [tab] }] }] }
}

let lastResult: EisenhowerResult | null = null

function Host() {
  const tab = useWorkspaceStore((s) => s.working?.columns[0]?.cells[0]?.tabs[0])
  if (tab?.kind !== 'eisenhower') return null
  return <EisenhowerWidget tab={tab} onResult={(r) => { lastResult = r }} />
}

/** The workspace with one Eisenhower tab, the app-wide panes setting `panes`. */
function showLayout(): void {
  const layout = layoutWith({ id: 'eis', kind: 'eisenhower', config: {} })
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, isDirty: false, hydrated: true })
}

function setup(panes: EisenhowerPanes) {
  useSettingsStore.setState({ eisenhowerPanes: panes })
  showLayout()
  render(<DndContext><Host /></DndContext>)
}

const quadrant = (q: string) => document.querySelector<HTMLElement>(`[data-eis-quadrant="${q}"]`)!
const rowTitles = (q: string) => Array.from(quadrant(q).querySelectorAll('[data-row-todo]')).map((r) => r.querySelector('[data-row-title]')?.textContent ?? r.textContent ?? '')
const has = (q: string, title: string) => rowTitles(q).some((t) => t.includes(title))
/** The app-wide panes setting as it is now. */
const storedPanes = () => useSettingsStore.getState().eisenhowerPanes
const undoNames = () => useUndoStore.getState().undoStack.map((e) => e.description)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  lastResult = null
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ urgentDueWithinDays: 3 })
  useStatusStore.setState({ statuses: [{ id: 3, name: 'Delegated', color: '#000', icon: 'circle', sortOrder: 1 }] })
  useUIStore.setState({ quickAddOpen: false, quickAddDraft: null, taskDialog: null, settingsOpen: false, settingsPart: null, settingsFocus: null })
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

describe('EisenhowerWidget with custom panes', () => {
  it('a task no pane matches is hidden and counted under the panes; the count opens it in the task dialog', () => {
    setup({ delegate: { filter: NOT_DELEGATED } })
    expect(has('delegate', 'Analytics')).toBe(true)
    expect(has('delegate', 'Chase vendor')).toBe(false)
    expect(lastResult?.countLabel).toBe('3 of 4')
    const line = screen.getByTestId('eisenhower-no-pane')
    expect(line.textContent).toBe('1 open task in no pane')
    fireEvent.click(line)
    expect(useUIStore.getState().taskDialog).toMatchObject({ title: 'In no pane', source: { kind: 'todos', todoIds: [1] } })
  })

  it('the default panes leave no task out: no line', () => {
    setup({})
    expect(screen.queryByTestId('eisenhower-no-pane')).toBeNull()
    expect(lastResult?.countLabel).toBe('4')
  })

  it('every Eisenhower follows the setting: a change shows at once', () => {
    setup({})
    expect(has('delegate', 'Chase vendor')).toBe(true)
    act(() => useSettingsStore.setState({ eisenhowerPanes: { delegate: { filter: NOT_DELEGATED } } }))
    expect(has('delegate', 'Chase vendor')).toBe(false)
    expect(screen.getByTestId('eisenhower-no-pane').textContent).toBe('1 open task in no pane')
  })

  it('a custom pane shows its name, its filter in words and the custom dot; a default one neither', () => {
    setup({ delegate: { name: 'Hand off', filter: NOT_DELEGATED }, drop: { name: 'Someday' } })
    expect(within(quadrant('delegate')).getByTestId('eisenhower-pane-subtitle').textContent).toBe('Urgent · not Important · not Delegated')
    expect(within(quadrant('delegate')).queryByTestId('eisenhower-pane-custom')).not.toBeNull()
    expect(quadrant('delegate').getAttribute('aria-label')).toBe('Hand off: Urgent · not Important · not Delegated')
    // Renamed only: its default subtitle, no dot.
    expect(within(quadrant('drop')).getByTestId('eisenhower-pane-subtitle').textContent).toBe('Neither')
    expect(within(quadrant('drop')).queryByTestId('eisenhower-pane-custom')).toBeNull()
    expect(within(quadrant('drop')).getByRole('button', { name: 'Add task to Someday' })).toBeTruthy()
  })

  it('a pane’s "+" seeds what its filter writes, from "<pane>"', () => {
    setup({ drop: { name: 'Delegated', filter: { ...emptyPredicate(), statusIds: [3], markers: { focus: true } } } })
    fireEvent.click(within(quadrant('drop')).getByRole('button', { name: 'Add task to Delegated' }))
    expect(useUIStore.getState().quickAddDraft).toEqual({
      rawTitle: '',
      defaults: { personIds: [], tagIds: [], statusId: 3, markers: { focus: true } },
      source: 'Delegated',
    })
  })

  it('a pane’s "+" never seeds a status that no longer exists', () => {
    setup({ drop: { name: 'Waiting', filter: { ...emptyPredicate(), statusIds: [99], markers: { focus: true } } } })
    fireEvent.click(within(quadrant('drop')).getByRole('button', { name: 'Add task to Waiting' }))
    expect(useUIStore.getState().quickAddDraft?.defaults).toEqual({ personIds: [], tagIds: [], statusId: undefined, markers: { focus: true } })
  })

  it('has no corner gear (the tab menu’s Customize panes… covers it)', () => {
    setup({})
    expect(screen.queryByRole('button', { name: 'Customize panes' })).toBeNull()
    expect(document.querySelector('[data-eisenhower-customize]')).toBeNull()
  })

  it('a pane header’s Edit pane… opens Settings › Tasks › Eisenhower on that pane; Reset pane puts the default back', async () => {
    setup({ delegate: { filter: NOT_DELEGATED } })
    fireEvent.contextMenu(within(quadrant('delegate')).getByTestId('eisenhower-pane-subtitle'))
    const menu = screen.getByRole('menu', { name: 'Delegate pane' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit pane…' }))
    expect(useUIStore.getState()).toMatchObject({
      settingsOpen: true, settingsSection: 'tasks', settingsPart: 'eisenhower', settingsFocus: 'eisenhower-pane-delegate',
    })

    fireEvent.contextMenu(within(quadrant('delegate')).getByTestId('eisenhower-pane-subtitle'))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Delegate pane' })).getByRole('menuitem', { name: 'Reset pane' }))
    expect(storedPanes()).toEqual({})
    expect(has('delegate', 'Chase vendor')).toBe(true)
    // A setting, written at once as one undo step: the layout isn't touched.
    await vi.waitFor(() => expect(undoNames()).toEqual(['Reset pane “Delegate”']))
    expect(useWorkspaceStore.getState().isDirty).toBe(false)
  })

  it('Shift+F10 on a pane header opens its menu; a default pane has no Reset pane', () => {
    setup({})
    fireEvent.keyDown(within(quadrant('do')).getByRole('button', { name: 'Add task to Do' }), { key: 'F10', shiftKey: true })
    const menu = screen.getByRole('menu', { name: 'Do pane' })
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Edit pane…'])
  })

  it('on a phone: the custom names, no header menu', () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({ ...original(query), matches: query.includes('max-width: 640px') })) as typeof window.matchMedia
    try {
      setup({ do: { name: 'Now' } })
      expect(quadrant('do').textContent).toContain('Now')
      fireEvent.contextMenu(within(quadrant('do')).getByTestId('eisenhower-pane-subtitle'))
      expect(screen.queryByRole('menu')).toBeNull()
    } finally {
      window.matchMedia = original
    }
  })
})
