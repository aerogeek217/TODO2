import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { GlanceWidget } from '../../../components/workspace/glance/GlanceWidget'
import { TrendEditorHost } from '../../../components/workspace/glance/TrendEditor'
import type { GlanceResult } from '../../../components/workspace/glance/glance-hooks'
import { glanceMenu } from '../../../components/workspace/glance/glance-menu'
import type { MenuEntry, MenuItemEntry } from '../../../components/shared/MenuPopover'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import type { PersistedTodoItem } from '../../../models'
import { createTab, type PersistedWorkspaceLayout, type TrendTab } from '../../../models/workspace-layout'
import { useChartWidgetsStore } from '../../../stores/chart-widgets-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { WidgetFace } from '../../../utils/widget-face'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'
import { single } from '../../helpers/layout-builders'
import { layoutSteps } from '../../helpers/layout-steps'

/**
 * Created vs completed's editor (widget feedback 2C) in JSDOM: Edit chart…
 * opens it under the title; Show as and the name edit a draft the widget
 * draws live; Save writes the changed keys as one undo step; Discard drops
 * them; the small face's headline follows Show as.
 */

const NOW = new Date(2026, 10, 11, 10)
const OLD = new Date(2026, 8, 1)

const TASKS: PersistedTodoItem[] = [
  makeTodo({ id: 1, title: 'Ship the beta', createdAt: OLD, modifiedAt: OLD }),
  makeTodo({ id: 2, title: 'Book the venue', createdAt: OLD, modifiedAt: OLD }),
]

let lastResult: GlanceResult | null = null

function Live({ face }: { face: WidgetFace }) {
  const tab = useWorkspaceStore((s) => s.working!.cells[0]!.tabs[0]) as TrendTab
  return (
    <WidgetFaceContext.Provider value={{ forced: face }}>
      <GlanceWidget tab={tab} onResult={(r) => { lastResult = r }} />
    </WidgetFaceContext.Provider>
  )
}

function setup(tab: TrendTab, face: WidgetFace = 'large') {
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'L', createdAt: new Date(), modifiedAt: new Date(), ...single({ id: 'c', tabs: [tab] }) }
  useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout], writeFailed: false })
  return render(<DndContext><Live face={face} /><TrendEditorHost /></DndContext>)
}

const current = () => useWorkspaceStore.getState().working!.cells[0]!.tabs[0] as TrendTab
const editor = () => document.querySelector<HTMLElement>('[data-trend-editor="t"]')!
const item = (entries: readonly MenuEntry[], label: string) => entries.find((e): e is MenuItemEntry => e.kind === 'item' && e.label === label)!
const shown = () => document.querySelector('[data-trend-show]')?.getAttribute('data-trend-show')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  lastResult = null
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ weekStartsOn: 0 })
  useTodoStore.setState({ todos: TASKS })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** A stored tab without name, filter or Show as (v79 wrote name and Show as on every stored one; a hand-made file may lack them). */
const BARE: TrendTab = { id: 't', kind: 'trend', config: { range: '14d' } }

describe('Created vs completed’s editor', () => {
  it('a new one is named and shows Bars', () => {
    expect(createTab('trend', 't').config).toEqual({ range: '14d', name: 'Created vs completed', show: 'bars' })
  })

  it('Edit chart… comes before Range and opens it; a stored tab without the new fields reads as Bars, every task', async () => {
    setup(BARE)
    await waitFor(() => expect(shown()).toBe('bars'))
    expect(document.querySelector('[data-trend-head="t"]')).toHaveTextContent('Created vs completed')
    const entries = glanceMenu(current(), undefined)!.settingEntries
    expect(entries.flatMap((e) => (e.kind === 'item' ? [e.label] : []))).toEqual(['Edit chart…', 'Range'])
    act(() => { item(entries, 'Edit chart…').onSelect!() })
    expect(useChartWidgetsStore.getState().trendEditorTabId).toBe('t')
    expect(within(editor()).getByRole('textbox', { name: 'Name' })).toHaveValue('Created vs completed')
    expect(within(editor()).getByRole('radio', { name: 'Bars' })).toHaveAttribute('aria-checked', 'true')
    expect(current().config).toEqual({ range: '14d' })
    expect(layoutSteps()).toEqual([])
  })

  it('Show as and the name draw live; Save writes only them, as one undo step', async () => {
    setup(BARE)
    await waitFor(() => expect(shown()).toBe('bars'))
    act(() => { useChartWidgetsStore.getState().openTrendEditor('t') })
    fireEvent.click(within(editor()).getByRole('radio', { name: 'Burndown' }))
    fireEvent.change(within(editor()).getByRole('textbox', { name: 'Name' }), { target: { value: 'Atlas' } })
    expect(shown()).toBe('burndown')
    expect(document.querySelector('[data-trend-head="t"]')).toHaveTextContent('Atlas')
    expect(current().config).toEqual({ range: '14d' })
    fireEvent.click(within(editor()).getByRole('button', { name: 'Save' }))
    expect(document.querySelector('[data-trend-editor]')).toBeNull()
    expect(current().config).toEqual({ range: '14d', show: 'burndown', name: 'Atlas' })
    expect(layoutSteps()).toEqual(['Edited chart “Atlas”'])
    await waitFor(() => expect(lastResult?.summary.plain.split('\n')[1]).toBe('Open at the start 2 · Open now 2 · Change 0'))
  })

  it('Discard drops the draft: the widget is as stored again', async () => {
    setup(BARE)
    await waitFor(() => expect(shown()).toBe('bars'))
    act(() => { useChartWidgetsStore.getState().openTrendEditor('t') })
    fireEvent.click(within(editor()).getByRole('radio', { name: 'Cumulative' }))
    expect(shown()).toBe('cumulative')
    fireEvent.click(within(editor()).getByRole('button', { name: 'Discard' }))
    expect(document.querySelector('[data-trend-editor]')).toBeNull()
    expect(shown()).toBe('bars')
    expect(current().config).toEqual({ range: '14d' })
    expect(layoutSteps()).toEqual([])
  })

  it('the small face’s headline follows Show as', async () => {
    const tab = createTab('trend', 't') as TrendTab
    setup({ ...tab, config: { ...tab.config, show: 'burndown', name: 'Atlas' } }, 'small')
    await waitFor(() => expect(document.querySelector('[data-testid="glance-small-value"]')).toHaveTextContent('2'))
    expect(document.querySelector('[data-testid="glance-small-face"]')).toHaveAttribute('aria-label', 'Atlas: 2 open · 0')
  })
})
