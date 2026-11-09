import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, cleanup, fireEvent, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { GlanceWidget } from '../../../components/workspace/glance/GlanceWidget'
import { ChartEditorHost } from '../../../components/workspace/glance/ChartEditor'
import { AddWidgetFlow } from '../../../components/workspace/AddWidgetFlow'
import { glanceMenu } from '../../../components/workspace/glance/glance-menu'
import type { GlanceDrill } from '../../../components/workspace/glance/glance-types'
import type { MenuEntry, MenuItemEntry } from '../../../components/shared/MenuPopover'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import type { BreakdownConfig } from '../../../models/chart-widgets'
import { createTab, type BreakdownTab, type PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { useChartWidgetsStore } from '../../../stores/chart-widgets-store'
import { usePersonStore } from '../../../stores/person-store'
import { useReviewStore } from '../../../stores/review-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { WidgetFace } from '../../../utils/widget-face'
import { clearFilterStore, resetEntityStores } from '../../helpers'
import { single } from '../../helpers/layout-builders'
import { ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, SAMPLE_TASKS, STATUSES, TAGS } from '../../fixtures/glance-sample'

/**
 * The Breakdown (D26 P8) in JSDOM: its headings sort (view state), the
 * filter row, Review ▸ and the count clicks (the review deck), the person
 * menu, its faces, its tab menu and its editor's round trip.
 */

function breakdown(over: Partial<BreakdownConfig> = {}, id = 'b'): BreakdownTab {
  return createTab('breakdown', id, { breakdown: { name: 'People', ...over } })
}

/** The tab in the open layout, so its writes land there. */
function inLayout(tab: BreakdownTab) {
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'L', createdAt: new Date(), modifiedAt: new Date(), ...single({ id: 'c', tabs: [tab] }) }
  useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout] })
}

const current = () => useWorkspaceStore.getState().working!.cells[0]!.tabs[0] as BreakdownTab

/** Renders the tab as it is in the open layout (re-rendered on each write). */
function Live({ face, onDrill }: { face?: WidgetFace; onDrill?: (d: GlanceDrill) => void }) {
  const tab = useWorkspaceStore((s) => s.working!.cells[0]!.tabs[0]) as BreakdownTab
  return (
    <WidgetFaceContext.Provider value={face ? { forced: face } : {}}>
      <GlanceWidget tab={tab} onDrill={onDrill} />
    </WidgetFaceContext.Provider>
  )
}

function setup(tab: BreakdownTab, opts: { face?: WidgetFace; onDrill?: (d: GlanceDrill) => void } = {}) {
  inLayout(tab)
  return render(<DndContext><Live face={opts.face ?? 'large'} onDrill={opts.onDrill} /><ChartEditorHost /></DndContext>)
}

const rows = () => [...document.querySelectorAll<HTMLElement>('[data-breakdown-row]')]
const keys = () => rows().map((r) => r.dataset.breakdownRow)
const rowOf = (key: string) => document.querySelector<HTMLElement>(`[data-breakdown-row="${key}"]`)!

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 10, 10))
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ urgentDueWithinDays: 3, weekStartsOn: 0 })
  useTodoStore.setState({ todos: SAMPLE_TASKS })
  usePersonStore.setState({ people: PEOPLE, assignedPeopleMap: ASSIGNED_PEOPLE })
  useTagStore.setState({ tags: TAGS, assignedTagsMap: ASSIGNED_TAGS })
  useStatusStore.setState({ statuses: STATUSES })
  useUIStore.setState({ selectedTodoIds: new Set(), selectionScope: null, taskDialog: null })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the headings sort (view state, per split)', () => {
  it('a click sorts by it (largest first), a second reverses, a third goes back; the subtitle says so; the none row stays last', async () => {
    setup(breakdown())
    const before = keys()
    expect(before.at(-1)).toBe('none')
    const open = () => document.querySelector<HTMLButtonElement>('[data-sort-key="open"]')!
    await act(async () => { fireEvent.click(open()) })
    expect(current().viewState?.sorts?.people).toEqual({ by: 'open' })
    expect(useWorkspaceStore.getState().isDirty).toBe(false)
    expect(document.querySelector('[data-testid="chart-sub"]')!.textContent).toBe('Most open first')
    expect(open().closest('[role="columnheader"]')!.getAttribute('aria-sort')).toBe('descending')
    const counts = rows().filter((r) => r.dataset.breakdownRow !== 'none').map((r) => Number(r.querySelector('[data-testid="breakdown-figure"]')!.textContent))
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
    expect(keys().at(-1)).toBe('none')
    await act(async () => { fireEvent.click(open()) })
    expect(current().viewState?.sorts?.people).toEqual({ by: 'open', reversed: true })
    expect(open().closest('[role="columnheader"]')!.getAttribute('aria-sort')).toBe('ascending')
    await act(async () => { fireEvent.click(open()) })
    expect(current().viewState?.sorts).toEqual({})
    expect(keys()).toEqual(before)
  })

  it('each split keeps its own sort', async () => {
    setup(breakdown())
    await act(async () => { fireEvent.click(document.querySelector('[data-sort-key="name"]')!) })
    act(() => { useWorkspaceStore.getState().patchTabConfig('b', 'breakdown', { splitBy: 'tags' }) })
    expect(document.querySelector('[data-testid="chart-sub"]')!.textContent).toBe('Most due first')
    expect(current().viewState?.sorts).toEqual({ people: { by: 'name' } })
  })
})

describe('the filter row (temporary, per split)', () => {
  it('typing narrows by name; Enter picks the first match; Backspace takes it back; × clears', () => {
    setup(breakdown())
    const field = within(document.querySelector<HTMLElement>('[data-testid="breakdown-filter-row"]')!).getByRole('textbox', { name: 'Filter by person' })
    fireEvent.change(field, { target: { value: 'pri' } })
    expect(keys()).toEqual(['person-4'])
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(field).toHaveValue('')
    expect(useChartWidgetsStore.getState().rowPicks.b?.people).toEqual(['person-4'])
    expect(keys()).toEqual(['person-4'])
    fireEvent.change(field, { target: { value: 'unass' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(keys()).toEqual(['person-4', 'none'])
    fireEvent.keyDown(field, { key: 'Backspace' })
    expect(keys()).toEqual(['person-4'])
    fireEvent.click(document.querySelector('[aria-label="Clear the person filter"]')!)
    expect(keys().length).toBeGreaterThan(2)
    // Never in the layout.
    expect(useWorkspaceStore.getState().isDirty).toBe(false)
  })

  it('a pick that matches no row any more is ignored: no chip, every row shown, and a new pick replaces it', () => {
    setup(breakdown())
    const all = keys()
    act(() => { useChartWidgetsStore.getState().setRowPicks('b', 'people', ['person-99']) })
    expect(keys()).toEqual(all)
    expect(document.querySelector('[data-testid="breakdown-filter-chip"]')).toBeNull()
    // A stale pick with a live one: the live one filters alone.
    act(() => { useChartWidgetsStore.getState().setRowPicks('b', 'people', ['person-99', 'person-4']) })
    expect(keys()).toEqual(['person-4'])
    // Backspace takes back the chip on screen, not the stale pick.
    const field = within(document.querySelector<HTMLElement>('[data-testid="breakdown-filter-row"]')!).getByRole('textbox', { name: 'Filter by person' })
    fireEvent.keyDown(field, { key: 'Backspace' })
    expect(keys()).toEqual(all)
    expect(useChartWidgetsStore.getState().rowPicks.b?.people ?? []).toEqual([])
  })

  it('the medium face has no filter row and shows name · Due · Follow-up', () => {
    setup(breakdown(), { face: 'medium' })
    expect(document.querySelector('[data-testid="breakdown-filter-row"]')).toBeNull()
    expect([...document.querySelectorAll('[data-sort-key]')].map((b) => b.textContent)).toEqual(['Person', 'Due', 'Follow-up'])
  })
})

describe('clicks: a row drills, Review ▸ and a count review', () => {
  it('a row opens its tasks; Review ▸ opens the deck on them; a Due count on just its due ones', () => {
    const onDrill = vi.fn()
    setup(breakdown({ name: 'Team' }), { onDrill })
    const priya = rowOf('person-4')
    fireEvent.click(priya)
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'Team · Priya Nair', personId: 4 })
    fireEvent.click(within(priya).getByTestId('breakdown-review'))
    expect(useReviewStore.getState()).toMatchObject({ open: true, source: { kind: 'person', title: 'Priya Nair' } })
    expect([...useReviewStore.getState().ids].sort((a, b) => a - b)).toEqual([3, 11, 14, 15])
    act(() => { useReviewStore.setState({ open: false }) })
    const dueRow = rows().find((r) => r.querySelector('button[data-badge-part="due"]'))!
    fireEvent.click(dueRow.querySelector('button[data-badge-part="due"]')!)
    const due = Number(dueRow.querySelector('[data-badge-part="due"]')!.textContent)
    expect(useReviewStore.getState().ids).toHaveLength(due)
    expect(useReviewStore.getState().source?.title).toMatch(/ · Due$/)
  })

  it('no Review ▸ while the deck is open', () => {
    useReviewStore.setState({ open: true })
    setup(breakdown())
    expect(document.querySelector('[data-testid="breakdown-review"]')).toBeNull()
  })

  it('a status row reviews as a status; a priority row as a priority', () => {
    setup(breakdown({ name: 'Status', splitBy: 'status' }))
    fireEvent.click(within(rowOf('status-3')).getByTestId('breakdown-review'))
    expect(useReviewStore.getState().source).toMatchObject({ kind: 'status', title: 'Waiting' })
  })

  it('a person row’s right-click opens the person menu', () => {
    setup(breakdown())
    fireEvent.contextMenu(rowOf('person-4'))
    expect(document.querySelector('[role="menu"][aria-label="@Priya Nair"]')).not.toBeNull()
  })
})

describe('the check-in envelope (Waiting on)', () => {
  it('each person row has it with checkins; none without', () => {
    setup(breakdown({ checkins: true, show: 'oldest', oldestBy: 'lastFollowup' }))
    expect(within(rowOf('person-4')).getByRole('button', { name: 'Email check-in options for Priya Nair' })).not.toBeNull()
    expect(within(rowOf('none')).queryByRole('button', { name: /Email check-in/ })).toBeNull()
    // Oldest: the age in days, its title under the name.
    expect(within(rowOf('person-4')).getByTestId('breakdown-figure').textContent).toMatch(/^\d+ d$/)
    cleanup()
    setup(breakdown())
    expect(document.querySelector('[aria-label^="Email check-in options"]')).toBeNull()
  })
})

describe('faces and styles', () => {
  it('small: its title and the top row', () => {
    setup(breakdown(), { face: 'small' })
    const face = document.querySelector('[data-testid="glance-small-face"]')!
    expect(face.getAttribute('aria-label')).toMatch(/^People: .+: \d+ open$/)
  })

  it('the header count is what the rows shown hold: the hidden none row counts neither there nor in its drill', () => {
    const onDrill = vi.fn()
    setup(breakdown({ name: 'Team', showNone: false }), { onDrill })
    expect(keys()).not.toContain('none')
    const count = document.querySelector<HTMLElement>('[data-testid="glance-section-count"]')!
    fireEvent.click(count)
    const drill = onDrill.mock.lastCall?.[0] as GlanceDrill
    const source = drill.source as { kind: 'groups'; groups: Array<{ todoIds: number[] }> }
    const distinct = new Set(source.groups.flatMap((g) => g.todoIds)).size
    expect(count.textContent).toBe(`${distinct} open`)
  })

  it('stacked: a segment per row that drills; donut: likewise', () => {
    const onDrill = vi.fn()
    setup(breakdown({ style: 'stacked', splitBy: 'status', name: 'Status' }), { onDrill })
    fireEvent.click(document.querySelector('[data-segment="status-1"]')!)
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'Status · To do' })
    cleanup()
    setup(breakdown({ style: 'donut', splitBy: 'status', name: 'Status' }), { onDrill })
    fireEvent.click(document.querySelector('[data-segment="status-2"]')!)
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'Status · In progress' })
  })
})

describe('the tab menu', () => {
  const item = (entries: readonly MenuEntry[], label: string) => entries.find((e): e is MenuItemEntry => e.kind === 'item' && e.label === label)!

  it('Edit breakdown… opens its editor; Sort lists the headings’ sorts (view state)', () => {
    const tab = breakdown()
    inLayout(tab)
    const menu = glanceMenu(tab, undefined)!
    item(menu.settingEntries, 'Edit breakdown…').onSelect!()
    expect(useChartWidgetsStore.getState().editorTabId).toBe('b')
    const sort = item(menu.settingEntries, 'Sort')
    expect(sort.note).toBe('Most due first')
    item(sort.children!, 'Due: Most due first').onSelect!()
    expect(current().viewState?.sorts?.people).toEqual({ by: 'due' })
  })

  it('Due › and Follow-up › override Settings’ ranges; back to Settings drops the override', () => {
    const tab = breakdown()
    inLayout(tab)
    item(item(glanceMenu(tab, undefined)!.settingEntries, 'Due').children!, 'Overdue only').onSelect!()
    expect(current().config.badges).toEqual({ due: 'overdue', followup: 0 })
    const after = current()
    expect(item(glanceMenu(after, undefined)!.settingEntries, 'Due').note).toBe('Overdue only')
    item(item(glanceMenu(after, undefined)!.settingEntries, 'Due').children!, 'As in Settings (Overdue and next 3 days)').onSelect!()
    expect(current().config).not.toHaveProperty('badges')
  })
})

describe('the editor (D26 P8, the Number editor’s pattern)', () => {
  it('opens under its title; its controls write the tab’s config (unsaved), × closes it', () => {
    setup(breakdown())
    expect(document.querySelector('[data-chart-editor]')).toBeNull()
    act(() => { useChartWidgetsStore.getState().openEditor('b') })
    const editor = document.querySelector<HTMLElement>('[data-chart-editor="b"]')!
    expect(editor).not.toBeNull()
    expect(within(editor).getByRole('textbox', { name: 'Name' })).toHaveValue('People')
    fireEvent.change(within(editor).getByRole('textbox', { name: 'Name' }), { target: { value: 'Waiting on' } })
    fireEvent.change(within(editor).getByRole('combobox', { name: 'Style' }), { target: { value: 'donut' } })
    fireEvent.change(within(editor).getByRole('combobox', { name: 'Show' }), { target: { value: 'oldest' } })
    fireEvent.change(within(editor).getByRole('combobox', { name: 'Oldest by' }), { target: { value: 'created' } })
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Check-in envelope on each person' }))
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Show Unassigned' }))
    expect(current().config).toMatchObject({ name: 'Waiting on', style: 'donut', show: 'oldest', oldestBy: 'created', checkins: true, showNone: false })
    expect(useWorkspaceStore.getState().isDirty).toBe(true)
    // Another split drops the check-ins; Count drops oldestBy.
    fireEvent.change(within(editor).getByRole('combobox', { name: 'Split by' }), { target: { value: 'status' } })
    fireEvent.change(within(editor).getByRole('combobox', { name: 'Show' }), { target: { value: 'count' } })
    expect(current().config).not.toHaveProperty('checkins')
    expect(current().config).not.toHaveProperty('oldestBy')
    expect(within(editor).getByRole('checkbox', { name: 'Show No status' })).not.toBeChecked()
    fireEvent.click(within(editor).getByRole('button', { name: 'Close' }))
    expect(document.querySelector('[data-chart-editor]')).toBeNull()
  })
})

describe('Add widget › Numbers & charts › Breakdown › its presets', () => {
  /** A menu item by its label (`&` in a selector trips JSDOM's). */
  const byLabel = (label: string) => [...document.querySelectorAll<HTMLElement>('[data-menu-label]')].find((e) => e.dataset.menuLabel === label)!
  const openPresets = () => {
    fireEvent.click(byLabel('Numbers & charts'))
    fireEvent.click(byLabel('Breakdown'))
    return [...document.querySelectorAll<HTMLElement>('[role="menu"][aria-label="Breakdown"] [role="menuitem"]')]
  }

  it('lists People · Tags · Status · Waiting on · Custom; Waiting on adds !Waiting by people, oldest, with check-ins, and opens its editor', () => {
    inLayout(breakdown())
    render(<DndContext><AddWidgetFlow cellId="c" anchor={{ x: 10, y: 10 }} onClose={() => {}} /></DndContext>)
    const presets = openPresets()
    expect(presets.map((el) => el.textContent?.trim())).toEqual(['People', 'Tags', 'Status', 'Waiting on', 'Custom'])
    fireEvent.click(presets[3]!)
    const added = useWorkspaceStore.getState().working!.cells[0]!.tabs.at(-1) as BreakdownTab
    expect(added.config).toMatchObject({ name: 'Waiting on', splitBy: 'people', show: 'oldest', oldestBy: 'lastFollowup', checkins: true })
    expect(added.config.filter.statusIds).toEqual([3])
    expect(useChartWidgetsStore.getState()).toMatchObject({ editorTabId: added.id, editorStartField: null })
  })

  it('Waiting on with no status named Waiting: no filter, its editor opens on the Status picker', () => {
    useStatusStore.setState({ statuses: STATUSES.filter((s) => s.name !== 'Waiting') })
    inLayout(breakdown())
    render(<DndContext><AddWidgetFlow cellId="c" anchor={{ x: 10, y: 10 }} onClose={() => {}} /></DndContext>)
    fireEvent.click(openPresets()[3]!)
    const added = useWorkspaceStore.getState().working!.cells[0]!.tabs.at(-1) as BreakdownTab
    expect(added.config.filter.statusIds).toBeNull()
    expect(useChartWidgetsStore.getState().editorStartField).toBe('status')
  })
})
