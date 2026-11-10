import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, cleanup, fireEvent, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { GlanceWidget } from '../../../components/workspace/glance/GlanceWidget'
import { PulseEditorHost } from '../../../components/workspace/glance/PulseEditor'
import type { GlanceResult } from '../../../components/workspace/glance/glance-hooks'
import { glanceMenu } from '../../../components/workspace/glance/glance-menu'
import type { MenuEntry, MenuItemEntry } from '../../../components/shared/MenuPopover'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import type { PersistedTodoItem, Tag } from '../../../models'
import { emptyPredicate } from '../../../models/filter-predicate'
import { pulseLateDefaultFilter, pulseStaleFilterFor, type PulseTabConfig } from '../../../models/pulse-config'
import { createTab, type PersistedWorkspaceLayout, type PulseTab } from '../../../models/workspace-layout'
import { useChartWidgetsStore } from '../../../stores/chart-widgets-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { WidgetFace } from '../../../utils/widget-face'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'
import { single } from '../../helpers/layout-builders'

/**
 * Project pulse's rules (G5) in JSDOM: a layout without them reads the
 * defaults and stays saved; Edit project pulse… opens the editor under its
 * title, whose Save writes the rules (the layout unsaved until its Save) — names in the
 * counts and Copy, a filter of its own changing a count, back to the default.
 */

const NOW = new Date(2026, 10, 11, 10)
const day = (n: number) => new Date(2026, 10, 11 + n)
const OLD = new Date(2026, 8, 1)
const ATLAS: Tag = { id: 1, name: 'Project: Atlas', color: '#4f8cff' }

function task(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return makeTodo({ createdAt: OLD, modifiedAt: day(-1), ...overrides })
}

const TASKS: PersistedTodoItem[] = [
  task({ id: 1, title: 'Ship the beta', dueDate: day(-1) }),
  task({ id: 2, title: 'Book the venue', dueDate: day(3) }),
  task({ id: 3, title: 'Renew the domain', modifiedAt: OLD }),
  task({ id: 4, title: 'Plan the offsite', dueDate: day(10) }),
]

function pulse(config: Partial<PulseTabConfig> = {}): PulseTab {
  const tab = createTab('pulse', 'p', { tagIds: [1] })
  return { ...tab, config: { ...tab.config, ...config } }
}

let lastResult: GlanceResult | null = null

/** Renders the tab as it is in the open layout (re-rendered on each write). */
function Live({ face }: { face: WidgetFace }) {
  const tab = useWorkspaceStore((s) => s.working!.cells[0]!.tabs[0]) as PulseTab
  return (
    <WidgetFaceContext.Provider value={{ forced: face }}>
      <GlanceWidget tab={tab} onResult={(r) => { lastResult = r }} />
    </WidgetFaceContext.Provider>
  )
}

function setup(tab: PulseTab, face: WidgetFace = 'large') {
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'L', createdAt: new Date(), modifiedAt: new Date(), ...single({ id: 'c', tabs: [tab] }) }
  useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout], isDirty: false })
  return render(<DndContext><Live face={face} /><PulseEditorHost /></DndContext>)
}

const current = () => useWorkspaceStore.getState().working!.cells[0]!.tabs[0] as PulseTab
const card = () => document.querySelector<HTMLElement>('[data-pulse-card="1"]')!
const count = (rule: 'late' | 'stale') => card().querySelector<HTMLElement>(`[data-pulse-count="${rule}"]`)!.textContent
const editor = () => document.querySelector<HTMLElement>('[data-pulse-editor="p"]')!
const rule = (key: 'late' | 'stale') => editor().querySelector<HTMLElement>(`[data-pulse-rule="${key}"]`)!
const item = (entries: readonly MenuEntry[], label: string) => entries.find((e): e is MenuItemEntry => e.kind === 'item' && e.label === label)!
const open = () => act(() => { useChartWidgetsStore.getState().openPulseEditor('p') })
/** The editor's Save: writes its edits and closes. */
const save = () => {
  fireEvent.click(within(editor()).getByRole('button', { name: 'Save' }))
  expect(document.querySelector('[data-pulse-editor]')).toBeNull()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  lastResult = null
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ urgentDueWithinDays: 3, weekStartsOn: 0, staleAfterDays: 30 })
  useTodoStore.setState({ todos: TASKS })
  useTagStore.setState({ tags: [ATLAS], assignedTagsMap: new Map(TASKS.map((t) => [t.id, [ATLAS]])) })
  useStatusStore.setState({ statuses: [] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Project pulse’s rules', () => {
  it('a config without rules reads the defaults and leaves the layout saved', () => {
    setup(pulse())
    expect(count('late')).toBe('1 late (25%)')
    expect(count('stale')).toBe('1 stale')
    expect(current().config).toEqual({ tagIds: [1] })
    expect(useWorkspaceStore.getState().isDirty).toBe(false)
  })

  it('its names read in the counts, the small face and Copy; a filter of its own changes the count', () => {
    setup(pulse({ late: { name: 'behind' }, stale: { name: 'quiet', filter: { ...emptyPredicate(), dates: { deadline: { match: 'unset' } } } } }))
    expect(count('late')).toBe('1 behind (25%)')
    // No due date: tasks 3 (and none else).
    expect(count('stale')).toBe('1 quiet')
    expect(lastResult?.summary.plain).toBe('#Project: Atlas 4 open · 1 behind (25%) · 1 quiet · Steady: +0 net in 4 weeks')
    cleanup()
    setup(pulse({ late: { name: 'Soon', filter: { ...emptyPredicate(), dates: { deadline: { match: 'range', start: { kind: 'offset', days: 0 }, end: { kind: 'offset', days: 14 } } } } } }), 'small')
    // Due today … +14: tasks 2 and 4 — half the open tasks.
    expect(document.querySelector('[data-testid="pulse-worst"]')!.textContent).toBe('50% Soon')
  })
})

describe('the editor', () => {
  it('Edit project pulse… comes before Tags and opens it under the title; it shows the defaults', () => {
    setup(pulse())
    const entries = glanceMenu(current(), undefined)!.settingEntries
    expect(entries.flatMap((e) => (e.kind === 'item' ? [e.label] : []))).toEqual(['Edit project pulse…', 'Tags'])
    act(() => { item(entries, 'Edit project pulse…').onSelect!() })
    expect(useChartWidgetsStore.getState().pulseEditorTabId).toBe('p')
    expect(within(rule('late')).getByRole('textbox', { name: 'Late name' })).toHaveValue('late')
    expect(within(rule('late')).getAllByTestId('list-filter-chip')).toHaveLength(1)
    expect(within(rule('stale')).getByTestId('pulse-stale-default')).toHaveTextContent('Follows Settings: untouched 30 days')
    // Opening it writes nothing.
    expect(current().config).toEqual({ tagIds: [1] })
    expect(useWorkspaceStore.getState().isDirty).toBe(false)
  })

  it('a name edits the draft; Save writes its rule (unsaved); the default name and no filter write none again', () => {
    setup(pulse())
    open()
    fireEvent.change(within(rule('late')).getByRole('textbox', { name: 'Late name' }), { target: { value: 'behind' } })
    // The widget draws the edit live; nothing is written until Save.
    expect(count('late')).toBe('1 behind (25%)')
    expect(current().config).toEqual({ tagIds: [1] })
    expect(useWorkspaceStore.getState().isDirty).toBe(false)
    save()
    expect(current().config.late).toEqual({ name: 'behind' })
    expect(count('late')).toBe('1 behind (25%)')
    expect(useWorkspaceStore.getState().isDirty).toBe(true)
    open()
    fireEvent.change(within(rule('late')).getByRole('textbox', { name: 'Late name' }), { target: { value: 'late' } })
    save()
    expect(current().config).toEqual({ tagIds: [1] })
  })

  it('Late’s first filter edit writes the default as its own (same count); Use the default drops it', () => {
    setup(pulse())
    open()
    fireEvent.click(within(rule('late')).getByRole('radio', { name: 'Expression' }))
    save()
    expect(current().config.late?.name).toBe('late')
    expect(current().config.late?.filter?.expression).toEqual({ kind: 'date', field: 'deadline', match: pulseLateDefaultFilter().dates.deadline })
    expect(count('late')).toBe('1 late (25%)')
    open()
    fireEvent.click(within(rule('late')).getByRole('button', { name: 'Use the default (overdue)' }))
    save()
    expect(current().config).toEqual({ tagIds: [1] })
  })

  it('Stale: Use a filter starts from Settings’ threshold (same count); its own filter changes it; Use the default follows Settings again', () => {
    setup(pulse())
    open()
    fireEvent.click(within(rule('stale')).getByRole('button', { name: 'Use a filter' }))
    save()
    expect(current().config.stale).toEqual({ name: 'stale', filter: pulseStaleFilterFor(30) })
    expect(count('stale')).toBe('1 stale')
    act(() => { useWorkspaceStore.getState().patchTabConfig('p', 'pulse', { stale: { name: 'stale', filter: pulseStaleFilterFor(1) } }) })
    expect(count('stale')).toBe('4 stale')
    open()
    fireEvent.click(within(rule('stale')).getByRole('button', { name: 'Use the default (follow Settings)' }))
    save()
    expect(current().config).toEqual({ tagIds: [1] })
    expect(count('stale')).toBe('1 stale')
  })

  it('Save writes only the rules it changed: Tags picked from the ⋯ menu meanwhile stay', () => {
    setup(pulse())
    open()
    fireEvent.change(within(rule('stale')).getByRole('textbox', { name: 'Stale name' }), { target: { value: 'quiet' } })
    act(() => { useWorkspaceStore.getState().patchTabConfig('p', 'pulse', { tagIds: [1, 2] }) })
    save()
    expect(current().config).toEqual({ tagIds: [1, 2], stale: { name: 'quiet' } })
  })

  it('Stale with fading off says so; × closes', () => {
    useSettingsStore.setState({ staleAfterDays: 0 })
    setup(pulse())
    expect(count('stale')).toBe('0 stale')
    act(() => { useChartWidgetsStore.getState().openPulseEditor('p') })
    expect(within(rule('stale')).getByTestId('pulse-stale-default')).toHaveTextContent('Follows Settings: fading is off, so no task is stale')
    fireEvent.click(within(editor()).getByRole('button', { name: 'Close' }))
    expect(document.querySelector('[data-pulse-editor]')).toBeNull()
  })
})
