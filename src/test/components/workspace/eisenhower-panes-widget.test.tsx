import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, within, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { EisenhowerWidget, type EisenhowerResult } from '../../../components/workspace/eisenhower/EisenhowerWidget'
import { CustomizePanesDialog } from '../../../components/workspace/eisenhower/CustomizePanesDialog'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useUIStore } from '../../../stores/ui-store'
import { useFilterStore } from '../../../stores/filter-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import type { EisenhowerQuadrant, EisenhowerTab, EisenhowerTabConfig, PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { emptyPredicate, type TodoPredicate } from '../../../models'
import { defaultPaneFilter } from '../../../utils/eisenhower-panes'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'

const TODAY = new Date(2026, 9, 10, 10)

const NOT_DELEGATED: TodoPredicate = { ...defaultPaneFilter('delegate'), statusIds: [3], negate: { statusIds: true } }

function layoutWith(tab: EisenhowerTab): PersistedWorkspaceLayout {
  const now = new Date(2026, 0, 1)
  return { id: 1, name: 'Main', createdAt: now, modifiedAt: now, columns: [{ id: 'c1', weight: 1, cells: [{ id: 'x1', weight: 1, tabs: [tab] }] }] }
}

let lastResult: EisenhowerResult | null = null
const customizeCalls: Array<EisenhowerQuadrant | undefined> = []

function Host({ customize }: { customize: boolean }) {
  const tab = useWorkspaceStore((s) => s.working?.columns[0]?.cells[0]?.tabs[0])
  if (tab?.kind !== 'eisenhower') return null
  return (
    <EisenhowerWidget
      tab={tab}
      onResult={(r) => { lastResult = r }}
      onCustomizePanes={customize ? (pane) => { customizeCalls.push(pane) } : undefined}
    />
  )
}

function setup(config: EisenhowerTabConfig, opts: { customize?: boolean } = {}) {
  const layout = layoutWith({ id: 'eis', kind: 'eisenhower', config })
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, isDirty: false, hydrated: true })
  render(<DndContext><Host customize={opts.customize ?? true} /></DndContext>)
}

const quadrant = (q: string) => document.querySelector<HTMLElement>(`[data-eis-quadrant="${q}"]`)!
const rowTitles = (q: string) => Array.from(quadrant(q).querySelectorAll('[data-row-todo]')).map((r) => r.querySelector('[data-row-title]')?.textContent ?? r.textContent ?? '')
const has = (q: string, title: string) => rowTitles(q).some((t) => t.includes(title))
const tabConfig = () => {
  const tab = useWorkspaceStore.getState().working?.columns[0]?.cells[0]?.tabs[0]
  return tab?.kind === 'eisenhower' ? tab.config : undefined
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  lastResult = null
  customizeCalls.length = 0
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ urgentDueWithinDays: 3 })
  useStatusStore.setState({ statuses: [{ id: 3, name: 'Delegated', color: '#000', icon: 'circle', sortOrder: 1 }] })
  useUIStore.setState({ quickAddOpen: false, quickAddDraft: null, taskDialog: null })
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
    setup({ panes: { delegate: { filter: NOT_DELEGATED } } })
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

  it('a custom pane shows its name, its filter in words and the custom dot; a default one neither', () => {
    setup({ panes: { delegate: { name: 'Hand off', filter: NOT_DELEGATED }, drop: { name: 'Someday' } } })
    expect(within(quadrant('delegate')).getByTestId('eisenhower-pane-subtitle').textContent).toBe('Urgent · not Important · not Delegated')
    expect(within(quadrant('delegate')).queryByTestId('eisenhower-pane-custom')).not.toBeNull()
    expect(quadrant('delegate').getAttribute('aria-label')).toBe('Hand off: Urgent · not Important · not Delegated')
    // Renamed only: its default subtitle, no dot.
    expect(within(quadrant('drop')).getByTestId('eisenhower-pane-subtitle').textContent).toBe('Neither')
    expect(within(quadrant('drop')).queryByTestId('eisenhower-pane-custom')).toBeNull()
    expect(within(quadrant('drop')).getByRole('button', { name: 'Add task to Someday' })).toBeTruthy()
  })

  it('a pane’s "+" seeds what its filter writes, from "<pane>"', () => {
    setup({ panes: { drop: { name: 'Delegated', filter: { ...emptyPredicate(), statusIds: [3], markers: { focus: true } } } } })
    fireEvent.click(within(quadrant('drop')).getByRole('button', { name: 'Add task to Delegated' }))
    expect(useUIStore.getState().quickAddDraft).toEqual({
      rawTitle: '',
      defaults: { personIds: [], tagIds: [], statusId: 3, markers: { focus: true } },
      source: 'Delegated',
    })
  })

  it('a pane’s "+" never seeds a status that no longer exists', () => {
    setup({ panes: { drop: { name: 'Waiting', filter: { ...emptyPredicate(), statusIds: [99], markers: { focus: true } } } } })
    fireEvent.click(within(quadrant('drop')).getByRole('button', { name: 'Add task to Waiting' }))
    expect(useUIStore.getState().quickAddDraft?.defaults).toEqual({ personIds: [], tagIds: [], statusId: undefined, markers: { focus: true } })
  })

  it('the corner gear comes before the panes in the Tab order (it sits at the top-right corner)', () => {
    setup({})
    const gear = screen.getByRole('button', { name: 'Customize panes' })
    expect(gear.compareDocumentPosition(quadrant('do')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the corner gear and a pane header’s menu open Customize panes; Reset pane puts the default back', () => {
    setup({ panes: { delegate: { filter: NOT_DELEGATED } } })
    fireEvent.click(screen.getByRole('button', { name: 'Customize panes' }))
    expect(customizeCalls).toEqual([undefined])

    fireEvent.contextMenu(within(quadrant('delegate')).getByTestId('eisenhower-pane-subtitle'))
    const menu = screen.getByRole('menu', { name: 'Delegate pane' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit pane…' }))
    expect(customizeCalls).toEqual([undefined, 'delegate'])

    fireEvent.contextMenu(within(quadrant('delegate')).getByTestId('eisenhower-pane-subtitle'))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Delegate pane' })).getByRole('menuitem', { name: 'Reset pane' }))
    expect(tabConfig()).toEqual({})
    expect(has('delegate', 'Chase vendor')).toBe(true)
    // The saved layout had the custom pane: the reset is an unsaved change.
    expect(useWorkspaceStore.getState().isDirty).toBe(true)
  })

  it('Shift+F10 on a pane header opens its menu; a default pane has no Reset pane', () => {
    setup({})
    fireEvent.keyDown(within(quadrant('do')).getByRole('button', { name: 'Add task to Do' }), { key: 'F10', shiftKey: true })
    const menu = screen.getByRole('menu', { name: 'Do pane' })
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Edit pane…'])
  })

  it('without Customize (phones) there is no gear and no header menu', () => {
    setup({ panes: { do: { name: 'Now' } } }, { customize: false })
    expect(quadrant('do').textContent).toContain('Now')
    expect(screen.queryByRole('button', { name: 'Customize panes' })).toBeNull()
    fireEvent.contextMenu(within(quadrant('do')).getByTestId('eisenhower-pane-subtitle'))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('CustomizePanesDialog', () => {
  function open(config: EisenhowerTabConfig, focusPane?: EisenhowerQuadrant) {
    const layout = layoutWith({ id: 'eis', kind: 'eisenhower', config })
    useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, isDirty: false, hydrated: true })
    const onClose = vi.fn()
    render(<CustomizePanesDialog tabId="eis" focusPane={focusPane} onClose={onClose} />)
    return { dialog: screen.getByRole('dialog', { name: 'Customize panes' }), onClose }
  }
  const card = (dialog: HTMLElement, q: string) => dialog.querySelector<HTMLElement>(`[data-pane-card="${q}"]`)!

  it('shows each pane’s name, filter chips and count now, and the open tasks in no pane', () => {
    const { dialog } = open({ panes: { delegate: { filter: NOT_DELEGATED } } })
    expect(within(card(dialog, 'delegate')).getByTestId('customize-pane-count').textContent).toBe('1 now')
    expect(within(card(dialog, 'delegate')).getByRole('img', { name: '1 open task now' })).toBeTruthy()
    expect(within(card(dialog, 'do')).getByRole('img', { name: '0 open tasks now' })).toBeTruthy()
    expect(within(card(dialog, 'delegate')).getByTestId('customize-pane-filter').textContent).toContain('not Delegated')
    expect(within(dialog).getByTestId('customize-panes-no-pane').textContent).toContain('1 open task is in no pane')
    expect(within(card(dialog, 'do')).getByRole('button', { name: 'Reset pane' })).toHaveProperty('disabled', true)
  })

  it('a rename is written at once (trimmed; the default name or blank = none), making the layout unsaved', () => {
    const { dialog } = open({}, 'drop')
    const name = within(card(dialog, 'drop')).getByRole('textbox', { name: 'Name' })
    expect(document.activeElement).toBe(name)
    fireEvent.change(name, { target: { value: 'Someday ' } })
    expect(tabConfig()).toEqual({ panes: { drop: { name: 'Someday' } } })
    expect((name as HTMLInputElement).value).toBe('Someday ')
    expect(useWorkspaceStore.getState().isDirty).toBe(true)
    fireEvent.change(name, { target: { value: 'Drop' } })
    expect(tabConfig()).toEqual({})
  })

  it('Reset pane and Reset all put the defaults back (the name field too)', () => {
    const { dialog } = open({ panes: { delegate: { name: 'Hand off', filter: NOT_DELEGATED }, drop: { name: 'Someday' } } })
    fireEvent.click(within(card(dialog, 'delegate')).getByRole('button', { name: 'Reset pane' }))
    expect(tabConfig()).toEqual({ panes: { drop: { name: 'Someday' } } })
    expect((within(card(dialog, 'delegate')).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset all' }))
    expect(tabConfig()).toEqual({})
    expect(within(dialog).getByRole('button', { name: 'Reset all' })).toHaveProperty('disabled', true)
  })

  it('its counts are the widget’s: on a saved list, under a screen filter', () => {
    useListDefinitionStore.setState({
      listDefinitions: [{
        id: 7, name: 'Not delegated', sortOrder: 0, sort: 'deadline', grouping: 'none',
        membership: { kind: 'custom', predicate: { ...emptyPredicate(), statusIds: [3], negate: { statusIds: true } } },
      }],
    })
    // The screen filter leaves out Blog; the list leaves out Chase vendor (Delegated).
    useFilterStore.getState().setSearchText('a')
    const config: EisenhowerTabConfig = {
      listDefinitionId: 7,
      panes: { do: { filter: { ...emptyPredicate(), searchText: 'zzz' } }, schedule: { filter: { ...emptyPredicate(), statusIds: [3] } } },
    }
    const layout = layoutWith({ id: 'eis', kind: 'eisenhower', config })
    useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, isDirty: false, hydrated: true })
    render(<DndContext><Host customize /><CustomizePanesDialog tabId="eis" onClose={() => {}} /></DndContext>)
    const dialog = screen.getByRole('dialog', { name: 'Customize panes' })
    const widgetCounts = ['do', 'schedule', 'delegate', 'drop'].map((q) => within(quadrant(q)).getByTestId('eisenhower-count').textContent)
    const dialogCounts = ['do', 'schedule', 'delegate', 'drop'].map((q) => {
      const c = dialog.querySelector<HTMLElement>(`[data-pane-card="${q}"]`)!
      return within(c).getByTestId('customize-pane-count').textContent?.replace(' now', '')
    })
    expect(widgetCounts).toEqual(['0', '0', '1', '0'])
    expect(dialogCounts).toEqual(widgetCounts)
    // Draft OKRs (Important, no status) matches no pane, in both.
    expect(screen.getByTestId('eisenhower-no-pane').textContent).toBe('1 open task in no pane')
    expect(within(dialog).getByTestId('customize-panes-no-pane').textContent).toContain('1 open task is in no pane')
  })

  it('a chip’s × edits the pane’s filter', () => {
    const { dialog } = open({ panes: { delegate: { filter: NOT_DELEGATED } } })
    const chips = within(card(dialog, 'delegate')).getAllByRole('button', { name: 'Remove filter' })
    // Priority, then Status: remove the status clause.
    fireEvent.click(chips[1]!)
    expect(tabConfig()).toEqual({})
  })
})
