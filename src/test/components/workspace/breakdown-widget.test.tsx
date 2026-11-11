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
import { createTab, type BreakdownTab, type LayoutTab, type PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { useChartWidgetsStore } from '../../../stores/chart-widgets-store'
import { usePersonStore } from '../../../stores/person-store'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { WidgetFace } from '../../../utils/widget-face'
import { clearFilterStore, resetEntityStores } from '../../helpers'
import { grid, single } from '../../helpers/layout-builders'
import { ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, SAMPLE_TASKS, STATUSES, TAGS } from '../../fixtures/glance-sample'
import { layoutSteps } from '../../helpers/layout-steps'

/**
 * The Breakdown (D26 P8) in JSDOM: its headings sort (view state), no
 * filter row, the row's Review button and the count columns' clicks (jumps
 * to a Review widget), the person menu, its faces, its tab menu and its editor's
 * round trip, its count columns among them (board BC).
 */

function breakdown(over: Partial<BreakdownConfig> = {}, id = 'b'): BreakdownTab {
  return createTab('breakdown', id, { breakdown: { name: 'People', ...over } })
}

/** The tab in the open layout, so its writes land there. */
function inLayout(tab: LayoutTab, { reviewWidget = true }: { reviewWidget?: boolean } = {}) {
  // Beside it (after it in reading order), a Review widget: where the Review buttons jump.
  const body = reviewWidget
    ? grid([[{ id: 'c', tabs: [tab] }, { id: 'r', tabs: [createTab('review', 'rv')] }]])
    : single({ id: 'c', tabs: [tab] })
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'L', createdAt: new Date(), modifiedAt: new Date(), ...body }
  useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout], activeLayoutId: 1 })
}

/** The Review widget's filter (the jump's). */
const reviewFilter = () => useListWidgetStore.getState().reviewFilters.rv

const current = () => useWorkspaceStore.getState().working!.cells[0]!.tabs[0] as BreakdownTab
/** A fresh Breakdown's config (its empty filter), before any is in the layout. */
const current0 = () => breakdown()

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
const item = (entries: readonly MenuEntry[], label: string) => entries.find((e): e is MenuItemEntry => e.kind === 'item' && e.label === label)!
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
  it('a click sorts by it (largest first), a second reverses, a third goes back; no sort words in the header; the none row stays last', async () => {
    setup(breakdown())
    const before = keys()
    expect(before.at(-1)).toBe('none')
    const open = () => document.querySelector<HTMLButtonElement>('[data-sort-key="open"]')!
    await act(async () => { fireEvent.click(open()) })
    expect(current().viewState?.sorts?.people).toEqual({ by: 'open' })
    expect(layoutSteps()).toEqual([])
    expect(document.querySelector('[data-testid="chart-sub"]')).toBeNull()
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

  it('a sort stored by the older derived columns (Overdue … Follow-up due) ranks by the Due / Follow-up column that holds them', async () => {
    setup(breakdown({}, 'b'))
    act(() => { useWorkspaceStore.getState().patchTabViewState('b', 'breakdown', { sorts: { people: { by: 'overdue' }, tags: { by: 'followup-due', reversed: true } } }) })
    const heading = (key: string) => document.querySelector(`[data-sort-key="${key}"]`)!.closest('[role="columnheader"]')!
    expect(heading('due').getAttribute('aria-sort')).toBe('descending')
    expect(heading('followup').getAttribute('aria-sort')).toBe('none')
    const due = rows().filter((r) => r.dataset.breakdownRow !== 'none')
      .map((r) => Number(r.querySelector('[data-column="due"]')?.textContent?.replace('–', '0') ?? 0))
    expect(due).toEqual([...due].sort((a, b) => b - a))
    expect(item(glanceMenu(current(), undefined)!.settingEntries, 'Sort').note).toBe('Most Due first')
    // A click on the Due heading goes on from there: reversed.
    await act(async () => { fireEvent.click(document.querySelector('[data-sort-key="due"]')!) })
    expect(current().viewState?.sorts?.people).toEqual({ by: 'due', reversed: true })
    act(() => { useWorkspaceStore.getState().patchTabConfig('b', 'breakdown', { splitBy: 'tags' }) })
    expect(heading('followup').getAttribute('aria-sort')).toBe('ascending')
  })

  it('a sort stored by the old Priority column reads as the default order', () => {
    setup(breakdown({}, 'b'))
    const before = keys()
    act(() => { useWorkspaceStore.getState().patchTabViewState('b', 'breakdown', { sorts: { people: { by: 'priority' } } }) })
    expect(keys()).toEqual(before)
    expect(document.querySelector('[data-sort-key="priority"]')).toBeNull()
    expect(document.querySelector('[role="columnheader"][aria-sort="descending"], [role="columnheader"][aria-sort="ascending"]')).toBeNull()
    expect(item(glanceMenu(current(), undefined)!.settingEntries, 'Sort').note).toBe('Most counted first')
  })

  it('each split keeps its own sort', async () => {
    setup(breakdown())
    await act(async () => { fireEvent.click(document.querySelector('[data-sort-key="name"]')!) })
    act(() => { useWorkspaceStore.getState().patchTabConfig('b', 'breakdown', { splitBy: 'tags' }) })
    expect(document.querySelector('[data-sort-key="name"]')!.getAttribute('aria-pressed')).toBe('false')
    expect(current().viewState?.sorts).toEqual({ people: { by: 'name' } })
  })
})

describe('no filter row', () => {
  it('the large face has no text field: every row shows', () => {
    setup(breakdown())
    expect(document.querySelectorAll('input[type="text"]')).toHaveLength(0)
    expect(keys().length).toBeGreaterThan(2)
  })

  it('the medium face shows name · the count columns', () => {
    setup(breakdown(), { face: 'medium' })
    expect([...document.querySelectorAll('[data-sort-key]')].map((b) => b.textContent)).toEqual(['Person', 'Due', 'Follow-up'])
  })
})

describe('clicks: a row drills, its Review button and a count jump', () => {
  it('a row opens its tasks; Review jumps to the Review widget with the row as its filter', async () => {
    const onDrill = vi.fn()
    setup(breakdown({ name: 'Team', filter: { ...current0().config.filter, tags: [1] } }), { onDrill })
    const priya = rowOf('person-4')
    fireEvent.click(priya)
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'Team · Priya Nair', personId: 4 })
    fireEvent.click(within(priya).getByTestId('breakdown-review'))
    // The Breakdown's own filter AND the row.
    await vi.waitFor(() => expect(reviewFilter()).toEqual({
      expression: { kind: 'and', items: [{ kind: 'tag', id: 1 }, { kind: 'person', id: 4 }] },
      showCompleted: false,
    }))
  })

  it('a count column’s count jumps with the row AND the column’s filter', async () => {
    setup(breakdown({
      columns: [{ id: 'doing', name: 'Doing', color: '#7ec4bc', filter: { ...current0().config.filter, statusIds: [2] }, litWhen: 'never' }],
    }))
    const count = rowOf('person-4').querySelector<HTMLElement>('button[data-column="doing"]')
    if (!count) throw new Error('Priya has no Doing task in the sample')
    fireEvent.click(count)
    await vi.waitFor(() => expect(reviewFilter()?.expression).toEqual({ kind: 'and', items: [{ kind: 'person', id: 4 }, { kind: 'status', id: 2 }] }))
  })

  it('every row has its Review button right after its name, in the name cell (no actions column, no pill)', () => {
    setup(breakdown())
    for (const row of rows()) {
      const review = within(row).getByTestId('breakdown-review')
      expect(review.tagName).toBe('BUTTON')
      const nameCell = row.querySelector('[role="cell"]')!
      expect(nameCell.contains(review)).toBe(true)
      expect(review.parentElement!.previousElementSibling).toBe(nameCell.querySelector('button'))
    }
    expect(document.querySelectorAll('[role="columnheader"]')).toHaveLength(document.querySelectorAll('[data-sort-key]').length)
    expect(document.body.textContent).not.toContain('Review ▸')
  })

  it('the medium face keeps Review after the name', () => {
    setup(breakdown({ checkins: true }), { face: 'medium' })
    const priya = rowOf('person-4')
    expect(priya.querySelector('[role="cell"]')!.contains(within(priya).getByTestId('breakdown-review'))).toBe(true)
    expect(within(priya).queryByRole('button', { name: /Email check-in/ })).toBeNull()
  })

  it('a count is solid while it meets its column’s Light up when rule, outlined otherwise; 0 is a dim –', () => {
    setup(breakdown({
      columns: [
        { id: 'all', name: 'All', color: '#7ec4bc', filter: { ...current0().config.filter }, litWhen: 'above', litAt: 1 },
        { id: 'quiet', name: 'Quiet', color: '#a78bfa', filter: { ...current0().config.filter }, litWhen: 'never' },
        { id: 'nobody', name: 'Nobody', color: '#5b8def', filter: { ...current0().config.filter, searchText: 'no task says this' }, litWhen: 'above', litAt: 0 },
      ],
    }))
    const priya = rowOf('person-4')
    const all = priya.querySelector<HTMLElement>('[data-column="all"]')!
    expect(all.textContent).toBe('4')
    expect(all.hasAttribute('data-solid')).toBe(true)
    // The teal preset: its text token outlined, its hex as the solid fill (J21).
    expect(all.style.getPropertyValue('--col-color')).toBe('var(--hue-teal-text)')
    expect(all.style.getPropertyValue('--col-fill')).toBe('#7ec4bc')
    expect(priya.querySelector('[data-column="quiet"]')!.hasAttribute('data-solid')).toBe(false)
    expect(priya.querySelector('[data-column="nobody"]')).toBeNull()
    expect(within(priya).getByLabelText('No tasks in Nobody').textContent).toBe('–')
    // A row of one task: 1 is not above 1, so outlined.
    const one = rows().find((r) => r.querySelector('[data-column="all"]')?.textContent === '1')
    if (one) expect(one.querySelector('[data-column="all"]')!.hasAttribute('data-solid')).toBe(false)
  })

  it('the derived Due and Follow-up columns are ordinary columns: lit above 0, in their colours', () => {
    setup(breakdown())
    const counts = [...document.querySelectorAll<HTMLElement>('[data-column="due"], [data-column="followup"]')]
    expect(counts.length).toBeGreaterThan(0)
    for (const el of counts) expect(el.hasAttribute('data-solid')).toBe(true)
    expect(document.querySelector<HTMLElement>('[data-column="due"]')!.style.getPropertyValue('--col-color')).toBe('var(--color-overdue)')
    expect(document.querySelector<HTMLElement>('[data-column="followup"]')!.style.getPropertyValue('--col-color')).toBe('var(--color-followup)')
  })

  it('no layout has a Review widget: no Review buttons, and a count opens its tasks in the task dialog', () => {
    const onDrill = vi.fn()
    inLayout(breakdown({ name: 'Team' }), { reviewWidget: false })
    render(<DndContext><Live face="large" onDrill={onDrill} /></DndContext>)
    expect(document.querySelector('[data-testid="breakdown-review"]')).toBeNull()
    const count = rows().map((r) => r.querySelector<HTMLElement>('button[data-column]')).find((b) => b != null)!
    fireEvent.click(count)
    expect(onDrill.mock.lastCall?.[0]?.title).toMatch(/^Team · .+ · /)
    expect(reviewFilter()).toBeUndefined()
  })

  it('a status row jumps with its status; a priority row with its group', async () => {
    setup(breakdown({ name: 'Status', splitBy: 'status' }))
    fireEvent.click(within(rowOf('status-3')).getByTestId('breakdown-review'))
    await vi.waitFor(() => expect(reviewFilter()?.expression).toEqual({ kind: 'status', id: 3 }))
    cleanup()
    setup(breakdown({ name: 'Priority', splitBy: 'priority' }))
    fireEvent.click(within(rowOf('priority-focus')).getByTestId('breakdown-review'))
    await vi.waitFor(() => expect(reviewFilter()?.expression).toEqual({ kind: 'priority', value: 'focus' }))
  })

  it('a person row’s right-click opens the person menu', () => {
    setup(breakdown())
    fireEvent.contextMenu(rowOf('person-4'))
    expect(document.querySelector('[role="menu"][aria-label="@Priya Nair"]')).not.toBeNull()
  })
})

describe('no check-in envelope (widget feedback 2B)', () => {
  it('a person row has no envelope, even with a stored `checkins` (read and ignored); Oldest shows the age', () => {
    setup(breakdown({ checkins: true, show: 'oldest', oldestBy: 'lastFollowup' }))
    expect(document.querySelector('[aria-label^="Email check-in options"]')).toBeNull()
    expect(document.querySelector('[data-testid="breakdown-envelope"]')).toBeNull()
    // Oldest: the age in days, its title under the name.
    expect(within(rowOf('person-4')).getByTestId('breakdown-figure').textContent).toMatch(/^\d+ d$/)
  })
})
describe('the table’s columns', () => {
  it('large: name · bar · Open · each count column — no Priority column; a count column is its number’s room, the name takes the rest', () => {
    setup(breakdown())
    expect([...document.querySelectorAll('[data-sort-key]')].map((b) => b.textContent)).toEqual(['Person', 'Open', 'Due', 'Follow-up'])
    expect(document.querySelector('[data-col="priority"]')).toBeNull()
    expect(document.querySelector('[data-testid="glance-priority-badges"]')).toBeNull()
    expect(document.querySelector('[data-priority]')).toBeNull()
    const table = document.querySelector<HTMLElement>('[role="table"]')!
    expect(table.style.getPropertyValue('--bd-cols')).toBe('minmax(0, 1fr) 84px 44px 40px 40px')
    expect(table.style.getPropertyValue('--bd-cols-narrow')).toBe('minmax(0, 1fr) 44px 30px 30px')
  })

  it('a long column name keeps the same width, its heading cut short with its name in the tooltip', () => {
    setup(breakdown({ columns: [{ id: 'col-a', name: 'Waiting on someone else', color: '#7ec4bc', filter: { ...current0().config.filter }, litWhen: 'never' }] }))
    const table = document.querySelector<HTMLElement>('[role="table"]')!
    expect(table.style.getPropertyValue('--bd-cols')).toBe('minmax(0, 1fr) 84px 44px 40px')
    expect(document.querySelector<HTMLElement>('[data-sort-key="col-a"]')!.title).toBe('Waiting on someone else')
  })

  it('a priority split keeps its rings on the row names', () => {
    setup(breakdown({ name: 'Priority', splitBy: 'priority' }))
    expect(keys()).toContain('priority-focus')
    expect(rowOf('priority-focus').querySelector('svg')).not.toBeNull()
    expect(document.querySelector('[data-sort-key="priority"]')).toBeNull()
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
    const source = drill.source
    if (source?.kind !== 'groups') throw new Error('expected a groups drill')
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

  it('Edit breakdown… opens its editor; Sort lists the headings’ sorts (view state)', () => {
    const tab = breakdown()
    inLayout(tab)
    const menu = glanceMenu(tab, undefined)!
    item(menu.settingEntries, 'Edit breakdown…').onSelect!()
    expect(useChartWidgetsStore.getState().editorTabId).toBe('b')
    const sort = item(menu.settingEntries, 'Sort')
    expect(sort.note).toBe('Most counted first')
    // Name, Open and each count column — no Priority.
    expect(sort.children!.flatMap((e) => (e.kind === 'item' ? [e.label] : []))).toEqual([
      'Default: Most counted first',
      'Person: A–Z', 'Person: Z–A',
      'Open: Most open first', 'Open: Fewest open first',
      'Due: Most Due first', 'Due: Fewest Due first',
      'Follow-up: Most Follow-up first', 'Follow-up: Fewest Follow-up first',
    ])
    item(sort.children!, 'Follow-up: Most Follow-up first').onSelect!()
    expect(current().viewState?.sorts?.people).toEqual({ by: 'followup' })
  })

  it('has no Due › or Follow-up › range submenus (count columns are the editor’s)', () => {
    const tab = breakdown()
    inLayout(tab)
    const labels = glanceMenu(tab, undefined)!.settingEntries.flatMap((e) => (e.kind === 'item' ? [e.label] : []))
    expect(labels).not.toContain('Due')
    expect(labels).not.toContain('Follow-up')
  })
})

/** The open chart editor. */
const chartEditor = () => document.querySelector<HTMLElement>('[data-chart-editor="b"]')!
/** The editor's Save (it writes its copy and closes), then the editor opened again. */
function saveAndReopen(): HTMLElement {
  fireEvent.click(within(chartEditor()).getByRole('button', { name: 'Save' }))
  expect(document.querySelector('[data-chart-editor]')).toBeNull()
  act(() => { useChartWidgetsStore.getState().openEditor('b') })
  return chartEditor()
}

describe('the editor (D26 P8, the Number editor’s pattern)', () => {
  it('opens under its title; its controls edit a copy, Save writes the tab’s config (unsaved), × closes it', () => {
    setup(breakdown())
    expect(document.querySelector('[data-chart-editor]')).toBeNull()
    act(() => { useChartWidgetsStore.getState().openEditor('b') })
    let editor = chartEditor()
    expect(editor).not.toBeNull()
    expect(within(editor).getByRole('textbox', { name: 'Name' })).toHaveValue('People')
    fireEvent.change(within(editor).getByRole('textbox', { name: 'Name' }), { target: { value: 'Waiting on' } })
    fireEvent.change(within(editor).getByRole('combobox', { name: 'Style' }), { target: { value: 'donut' } })
    fireEvent.change(within(editor).getByRole('combobox', { name: 'Show' }), { target: { value: 'oldest' } })
    fireEvent.change(within(editor).getByRole('combobox', { name: 'Oldest by' }), { target: { value: 'created' } })
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Show Unassigned' }))
    // Nothing written until Save.
    expect(current().config.name).toBe('People')
    expect(layoutSteps()).toEqual([])
    editor = saveAndReopen()
    expect(current().config).toMatchObject({ name: 'Waiting on', style: 'donut', show: 'oldest', oldestBy: 'created', showNone: false })
    expect(within(editor).queryByRole('checkbox', { name: /Check-in/ })).toBeNull()
    expect(layoutSteps()).not.toEqual([])
    // Count drops oldestBy.
    fireEvent.change(within(editor).getByRole('combobox', { name: 'Split by' }), { target: { value: 'status' } })
    fireEvent.change(within(editor).getByRole('combobox', { name: 'Show' }), { target: { value: 'count' } })
    expect(within(editor).getByRole('checkbox', { name: 'Show No status' })).not.toBeChecked()
    editor = saveAndReopen()
    expect(current().config).not.toHaveProperty('oldestBy')
    fireEvent.click(within(editor).getByRole('button', { name: 'Close' }))
    expect(document.querySelector('[data-chart-editor]')).toBeNull()
  })
})

describe('the editor’s Count columns (board BC)', () => {
  const columnsBox = () => document.querySelector<HTMLElement>('[data-testid="chart-editor-columns"]')!

  it('shows the derived columns until edited; the first edit writes them all as columns and drops the old ranges', () => {
    setup(breakdown({ badges: { followup: 'overdue' } }))
    act(() => { useChartWidgetsStore.getState().openEditor('b') })
    expect([...columnsBox().querySelectorAll<HTMLInputElement>('input[aria-label$="name"]')].map((i) => i.value)).toEqual(['Due', 'Follow-up'])
    expect(current().config).not.toHaveProperty('columns')
    fireEvent.change(within(columnsBox()).getByRole('textbox', { name: 'Column 1 name' }), { target: { value: 'Late' } })
    fireEvent.click(within(chartEditor()).getByRole('button', { name: 'Save' }))
    expect(current().config.columns?.map((c) => [c.id, c.name, c.litWhen, c.litAt])).toEqual([['due', 'Late', 'above', 0], ['followup', 'Follow-up', 'above', 0]])
    // The follow-up range was `overdue`: its column counts the late ones only (up to yesterday), as written.
    expect(current().config.columns?.[1]?.filter.dates?.followup).toEqual({ match: 'range', start: null, end: { kind: 'offset', days: -1 } })
    expect(current().config).not.toHaveProperty('badges')
    expect(layoutSteps()).not.toEqual([])
    // The table follows: its headings are the columns' names.
    expect([...document.querySelectorAll('[data-sort-key]')].map((b) => b.textContent)).toContain('Late')
  })

  it('+ Add column adds one (lit above 0, an empty filter) up to four; × removes one; Light up when writes its rule', () => {
    setup(breakdown())
    act(() => { useChartWidgetsStore.getState().openEditor('b') })
    // Two derived: room for two more.
    fireEvent.click(within(columnsBox()).getByRole('button', { name: 'Add column' }))
    saveAndReopen()
    expect(current().config.columns?.map((c) => c.name)).toEqual(['Due', 'Follow-up', 'Count 3'])
    fireEvent.click(within(columnsBox()).getByRole('button', { name: 'Add column' }))
    // Four: the cap — no Add column.
    expect(within(columnsBox()).queryByRole('button', { name: 'Add column' })).toBeNull()
    fireEvent.click(within(columnsBox()).getByRole('button', { name: 'Remove Follow-up' }))
    expect(within(columnsBox()).getByRole('button', { name: 'Add column' })).toBeTruthy()
    saveAndReopen()
    expect(current().config.columns?.map((c) => c.name)).toEqual(['Due', 'Count 3', 'Count 4'])
    const added = current().config.columns?.at(-1)
    expect(added).toMatchObject({ name: 'Count 4', litWhen: 'above', litAt: 0 })
    expect(added?.filter.statusIds).toBeNull()
    fireEvent.change(within(columnsBox()).getByRole('combobox', { name: 'Count 4: light up when' }), { target: { value: 'never' } })
    saveAndReopen()
    expect(current().config.columns?.at(-1)).not.toHaveProperty('litAt')
    expect(current().config.columns?.at(-1)?.litWhen).toBe('never')
    fireEvent.change(within(columnsBox()).getByRole('combobox', { name: 'Count 4: light up when' }), { target: { value: 'below' } })
    fireEvent.change(within(columnsBox()).getByRole('spinbutton', { name: 'Count 4: light up when below' }), { target: { value: '3' } })
    saveAndReopen()
    expect(current().config.columns?.at(-1)).toMatchObject({ litWhen: 'below', litAt: 3 })
    // Its colour: the app's picker.
    fireEvent.click(within(columnsBox().querySelector<HTMLElement>(`[data-column-editor="${added!.id}"]`)!).getByRole('radio', { name: 'Rose' }))
    fireEvent.click(within(chartEditor()).getByRole('button', { name: 'Save' }))
    expect(current().config.columns?.at(-1)?.color).toBe('#e07a9a')
  })
})

describe('Add widget › Insights › Breakdown › its presets', () => {
  /** A menu item by its label (`&` in a selector trips JSDOM's). */
  const byLabel = (label: string) => [...document.querySelectorAll<HTMLElement>('[data-menu-label]')].find((e) => e.dataset.menuLabel === label)!
  const openPresets = () => {
    fireEvent.click(byLabel('Insights'))
    fireEvent.click(byLabel('Breakdown'))
    return [...document.querySelectorAll<HTMLElement>('[role="menu"][aria-label="Breakdown"] [role="menuitem"]')]
  }

  it('lists People · Tags · Status · Custom (no Waiting on); a preset adds its Breakdown and opens no editor', () => {
    inLayout(breakdown())
    render(<DndContext><AddWidgetFlow cellId="c" anchor={{ x: 10, y: 10 }} onClose={() => {}} /></DndContext>)
    const presets = openPresets()
    expect(presets.map((el) => el.textContent?.trim())).toEqual(['People', 'Tags', 'Status', 'Custom'])
    fireEvent.click(presets[2]!)
    const added = useWorkspaceStore.getState().working!.cells[0]!.tabs.at(-1) as BreakdownTab
    expect(added.config).toMatchObject({ name: 'Status', splitBy: 'status' })
    expect(useChartWidgetsStore.getState().editorTabId).toBeNull()
  })

  it('every preset writes the Due and Follow-up columns in Settings’ ranges of the moment; later Settings changes leave them', () => {
    useSettingsStore.setState({ tabBadges: { due: 5, followup: 'overdue' } })
    inLayout(breakdown())
    render(<DndContext><AddWidgetFlow cellId="c" anchor={{ x: 10, y: 10 }} onClose={() => {}} /></DndContext>)
    fireEvent.click(openPresets()[3]!)
    const added = () => useWorkspaceStore.getState().working!.cells[0]!.tabs.at(-1) as BreakdownTab
    expect(added().config.columns?.map((c) => [c.id, c.name, c.color, c.litWhen, c.litAt, c.filter.dates])).toEqual([
      ['due', 'Due', '#e86bf0', 'above', 0, { deadline: { match: 'range', start: null, end: { kind: 'offset', days: 5 } } }],
      ['followup', 'Follow-up', '#f5c842', 'above', 0, { followup: { match: 'range', start: null, end: { kind: 'offset', days: -1 } } }],
    ])
    expect(added().config).not.toHaveProperty('badges')
    const written = added().config.columns
    act(() => { useSettingsStore.setState({ tabBadges: { due: 'off', followup: 0 } }) })
    expect(added().config.columns).toBe(written)
  })

  it('Change widget to a Breakdown writes them too', () => {
    inLayout(createTab('notes', 'b'))
    act(() => { useWorkspaceStore.getState().changeTabKind('b', 'breakdown') })
    expect(current().config.columns?.map((c) => c.id)).toEqual(['due', 'followup'])
  })
})
