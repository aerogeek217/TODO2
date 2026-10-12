import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act, within, fireEvent } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { DashboardWidget, type DashboardResult } from '../../../components/workspace/dashboard/DashboardWidget'
import type { DashboardDrill } from '../../../components/workspace/dashboard/types'
import { defaultDashboardConfig, type DashboardTabConfig } from '../../../models/dashboard-config'
import { createTab, type DashboardTab } from '../../../models/workspace-layout'
import { useFilterStore } from '../../../stores/filter-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { trendEventsKey, useTrendEventsStore } from '../../../stores/trend-events-store'
import { useUIStore } from '../../../stores/ui-store'
import { DEFAULT_HOT_RULE } from '../../../utils/hot'
import { clearFilterStore, resetEntityStores } from '../../helpers'
import {
  ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, Q4, SAMPLE_EVENTS, SAMPLE_LISTS, SAMPLE_TASKS, SAMPLE_TODAY, STATUSES, TAGS,
} from '../../fixtures/dashboard-sample'

let lastResult: DashboardResult | null = null

function tabWith(config: Partial<DashboardTabConfig> = {}): DashboardTab {
  return { id: 'dash', kind: 'dashboard', config: { ...defaultDashboardConfig(), ...config } }
}

function setup(tab: DashboardTab = tabWith(), onDrill?: (d: DashboardDrill) => void) {
  return render(
    <DndContext>
      <DashboardWidget tab={tab} onResult={(r) => { lastResult = r }} onDrill={onDrill} />
    </DndContext>,
  )
}

const widget = () => document.querySelector<HTMLElement>('[data-dashboard]')!
const tile = (id: string) => document.querySelector<HTMLElement>(`[data-dash-tile="${id}"]`)!
const tileCount = (id: string) => within(tile(id)).getByTestId('dash-tile-count').textContent
const section = (id: string) => document.querySelector<HTMLElement>(`[data-dash-section="${id}"]`)
const sectionCount = (id: string) => within(section(id)!).getByTestId('dash-section-count').textContent
const rowTitles = (el: HTMLElement) => Array.from(el.querySelectorAll('[data-row-todo]'))
  .map((r) => SAMPLE_TASKS.find((t) => t.id === Number((r as HTMLElement).dataset.rowTodo))?.title)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 10, 10))
  lastResult = null
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ urgentDueWithinDays: 3, hotRule: DEFAULT_HOT_RULE, weekStartsOn: 0 })
  useTodoStore.setState({ todos: SAMPLE_TASKS })
  usePersonStore.setState({ people: PEOPLE, assignedPeopleMap: ASSIGNED_PEOPLE })
  useTagStore.setState({ tags: TAGS, assignedTagsMap: ASSIGNED_TAGS })
  useStatusStore.setState({ statuses: STATUSES })
  useListDefinitionStore.setState({ listDefinitions: SAMPLE_LISTS })
  useListDraftStore.setState({ drafts: {} })
  useUIStore.setState({ selectedTodoIds: new Set(), selectionScope: null, taskDialog: null })
  // The trend's history, as the cache holds it after its read.
  useTrendEventsStore.setState({
    entries: new Map([[trendEventsKey('14d', SAMPLE_TODAY, 0), { events: SAMPLE_EVENTS, stale: false, loading: false }]]),
    generation: 0,
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('DashboardWidget — the design sample', () => {
  it('a new dashboard tab gets the default config', () => {
    expect(createTab('dashboard', 'd')).toEqual({ id: 'd', kind: 'dashboard', config: defaultDashboardConfig() })
  })

  it('renders the default tiles with the design numbers and sub-lines', () => {
    setup()
    expect(Array.from(document.querySelectorAll('[data-dash-tile]')).map((el) => (el as HTMLElement).dataset.dashTile))
      .toEqual(['open', 'hot', 'urgent', 'overdue', 'followupDue', 'focus'])
    expect(['open', 'hot', 'urgent', 'overdue', 'followupDue', 'focus'].map(tileCount)).toEqual(['19', '4', '8', '2', '2', '3'])
    expect(tile('open').textContent).toContain('+3 in the last 14 days')
    expect(tile('hot').textContent).toContain('3 urgent + important · 1 Focus')
    expect(tile('urgent').textContent).toContain('3 flagged · 5 by due date')
    expect(tile('overdue').textContent).toContain('Oldest Wed 7 · 3d late')
    expect(tile('followupDue').textContent).toContain('1 late · 3 more in 7 days')
    expect(tile('focus').textContent).toContain('2 due today')
    expect(tile('open').querySelector('polyline')).not.toBeNull()
  })

  it('reports the open count for the tab and its counts for Copy summary', () => {
    setup(tabWith({ listTiles: [1] }))
    expect(lastResult?.countLabel).toBe('19')
    expect(lastResult?.summary.plain).toBe('Open 19 · Hot 4 · Urgent 8 · Overdue 2 · Follow-up due 2 · Focus 3\nWaiting on 2')
  })

  it('“+ Add list tile” shows when the host can open Customize', () => {
    const onAdd = vi.fn()
    render(<DndContext><DashboardWidget tab={tabWith()} onAddListTile={onAdd} /></DndContext>)
    fireEvent.click(document.querySelector<HTMLElement>('[aria-label="List tiles"] button')!)
    expect(onAdd).toHaveBeenCalled()
  })

  it('renders every section in the default order and spans', () => {
    setup()
    const ids = Array.from(document.querySelectorAll('[data-dash-section]')).map((el) => (el as HTMLElement).dataset.dashSection)
    expect(ids).toEqual(['hot', 'followup', 'next7', 'trend', 'status', 'people'])
    expect(['hot', 'followup', 'next7', 'trend', 'status', 'people'].map((id) => section(id)!.style.gridColumn))
      .toEqual(['span 5', 'span 4', 'span 3', 'span 5', 'span 3', 'span 4'])
    // No list tiles configured: no strip.
    expect(document.querySelector('[aria-label="List tiles"]')).toBeNull()
  })

  it('Hot: the hot tasks as task rows, overdue first then by due date, with the rule in words', () => {
    setup()
    const hot = section('hot')!
    expect(sectionCount('hot')).toBe('4')
    expect(hot.textContent).toContain('Urgent and important, or in Focus')
    expect(rowTitles(hot)).toEqual(['Fix checkout outage', 'Headcount request', 'Draft homepage copy', 'Book venue for offsite'])
    // Real task rows: draggable list-widget rows of this tab.
    expect(hot.querySelector('[data-drag-id^="lw|dash|hot|"]')).not.toBeNull()
  })

  it('Needs follow-up: Late / Today / Next 7 days groups', () => {
    setup()
    const fu = section('followup')!
    expect(sectionCount('followup')).toBe('5')
    const groups = within(fu).getAllByRole('group').map((g) => [g.getAttribute('aria-label'), rowTitles(g)])
    expect(groups).toEqual([
      ['Late', ['Vendor contract']],
      ['Today', ['Chase venue deposit invoice']],
      ['Next 7 days', ['Vendor contract redlines', 'Sign off on new logo', 'Book venue for offsite']],
    ])
  })

  it('Next 7 days: a Late column, today and six days, with due / follow-up counts', () => {
    setup()
    const days = within(section('next7')!).getAllByTestId('dash-day')
    expect(days).toHaveLength(8)
    expect(days.map((d) => d.querySelector('[class*="dayName"]')?.textContent))
      .toEqual(['Late', 'Today', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
    expect(days[0]!.dataset.late).toBe('true')
    expect(days[1]!.dataset.today).toBe('true')
  })

  it('Created vs completed: the window totals', () => {
    setup()
    expect(within(section('trend')!).getByTestId('dash-trend-completed').textContent).toBe('14completed')
    expect(within(section('trend')!).getByTestId('dash-trend-created').textContent).toBe('17created')
    expect(section('trend')!.textContent).toContain('+3open since Sun 27 Sep')
  })

  it('Status: open counts per status with percentages', () => {
    setup()
    const status = section('status')!
    expect(sectionCount('status')).toBe('19 open')
    const rows = Array.from(status.querySelectorAll('[data-status-key]')).map((r) => r.textContent)
    expect(rows).toEqual(['To do1158%', 'In progress526%', 'Waiting211%', 'Blocked15%'])
  })

  it('People: by open count, ties by name, Unassigned last', () => {
    setup()
    const rows = Array.from(section('people')!.querySelectorAll<HTMLElement>('[data-person-row]'))
    expect(rows.map((r) => r.querySelector('[class*="personName"] > span')?.textContent)).toEqual(['Priya Nair', 'Alice Chen', 'Ben Ortiz', 'Dana Kim', 'Sam Lee', 'Unassigned'])
  })

  it('People: Unassigned can be hidden', () => {
    setup(tabWith({ sections: [{ id: 'people', options: { showUnassigned: false } }] }))
    const rows = Array.from(section('people')!.querySelectorAll<HTMLElement>('[data-person-row]'))
    expect(rows.map((r) => r.dataset.personRow)).not.toContain('none')
  })
})

describe('DashboardWidget — config', () => {
  it('shows only the configured tiles and sections, in config order, re-flowing spans', () => {
    setup(tabWith({ tiles: ['focus', 'noFollowup'], sections: [{ id: 'hot' }, { id: 'trend' }, { id: 'people' }] }))
    expect(Array.from(document.querySelectorAll('[data-dash-tile]')).map((el) => (el as HTMLElement).dataset.dashTile)).toEqual(['focus', 'noFollowup'])
    expect(Array.from(document.querySelectorAll('[data-dash-section]')).map((el) => (el as HTMLElement).dataset.dashSection)).toEqual(['hot', 'trend', 'people'])
    // 5 + 5 fit a row and the row's last stretches to 7; People (4) starts a row alone.
    expect(['hot', 'trend', 'people'].map((id) => section(id)!.style.gridColumn)).toEqual(['span 5', 'span 7', 'span 12'])
    expect(widget().style.gridTemplateRows).toBe('auto minmax(0, 1fr) 272px')
  })

  it('list tiles: count shown of total; prompted and deleted lists are skipped', () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, tags: new Set([Q4]) } }))
    setup(tabWith({ listTiles: [1, 2, 3, 4, 5, 99] }))
    const tiles = Array.from(document.querySelectorAll<HTMLElement>('[data-dash-list-tile]'))
    expect(tiles.map((t) => Number(t.dataset.dashListTile))).toEqual([1, 2, 3, 4])
    expect(tiles.map((t) => within(t).getByTestId('dash-list-count').textContent)).toEqual(['0of 2', '2of 4', '5', '0of 2'])
    expect(tiles.map((t) => t.querySelector('[class*="listHint"]')?.textContent)).toEqual(['Status: Waiting', '@Priya Nair', '#q4', '#errands'])
  })

  it('list tiles follow unsaved list edits', () => {
    const waiting = SAMPLE_LISTS[0]!
    useListDraftStore.setState({ drafts: { 1: { ...waiting, membership: { kind: 'custom', predicate: { ...waiting.membership.predicate, statusIds: [1] } } } } })
    setup(tabWith({ listTiles: [1] }))
    expect(within(document.querySelector<HTMLElement>('[data-dash-list-tile="1"]')!).getByTestId('dash-list-count').textContent).toBe('11')
  })

  it('an empty section shows its empty lines', () => {
    useSettingsStore.setState({ hotRule: [{ urgent: true, important: true, focus: true }] })
    useTodoStore.setState({ todos: SAMPLE_TASKS.filter((t) => t.focus !== true) })
    setup()
    expect(section('hot')!.textContent).toContain('Nothing hot')
    expect(section('hot')!.textContent).toContain('Tasks matching the Hot setting show here.')
  })
})

describe('DashboardWidget — screen filter', () => {
  it('every count reads shown of total under the top-bar filter', () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, tags: new Set([Q4]) } }))
    setup()
    expect(['open', 'hot', 'urgent', 'overdue', 'followupDue', 'focus'].map(tileCount))
      .toEqual(['5of 19', '1of 4', '1of 8', '0of 2', '0of 2', '1of 3'])
    expect(tile('hot').textContent).toContain('1 in Focus')
    expect(tile('overdue').textContent).toContain('Nothing overdue')
    expect(tile('focus').textContent).toContain('None due today')
    expect(lastResult?.countLabel).toBe('5 of 19')
    expect(lastResult?.summary.plain).toBe('Open 5 of 19 · Hot 1 of 4 · Urgent 1 of 8 · Overdue 0 of 2 · Follow-up due 0 of 2 · Focus 1 of 3')
    expect(sectionCount('hot')).toBe('1 of 4')
    expect(sectionCount('status')).toBe('5 of 19 open')
  })

  it('Show completed adds nothing to the counts', () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, showCompleted: true } }))
    setup()
    expect(tileCount('open')).toBe('19')
  })

  it('counts follow store changes', () => {
    setup()
    act(() => {
      useTodoStore.setState({ todos: SAMPLE_TASKS.map((t) => (t.id === 1 ? { ...t, isCompleted: true } : t)) })
    })
    expect(tileCount('open')).toBe('18')
    expect(tileCount('hot')).toBe('3')
  })
})

describe('DashboardWidget — drill hook', () => {
  const HOT_WORDS = 'Hot = urgent and important, or in Focus (Settings › Task Defaults).'
  type Group = { label: string; todoIds: number[] }

  it('without a drill handler numbers are not buttons', () => {
    setup()
    expect(tile('hot').tagName).toBe('DIV')
    expect(section('hot')!.querySelector('button[data-testid="dash-section-count"]')).toBeNull()
    expect(section('people')!.querySelector('button[data-person-row]')).toBeNull()
  })

  it('a tile opens its tasks in dialog order, saying what it counts', () => {
    const onDrill = vi.fn()
    setup(tabWith({ tiles: ['hot', 'urgent', 'dueNext7'] }), onDrill)
    fireEvent.click(tile('hot'))
    expect(onDrill).toHaveBeenLastCalledWith({
      title: 'Hot tasks', glyph: 'hot', description: HOT_WORDS, source: { kind: 'todos', todoIds: [1, 2, 3, 4] },
    })
    fireEvent.click(tile('urgent'))
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({
      description: 'Urgent = flagged urgent, or due within 3 days (Settings › Task Defaults).',
      // Overdue first, then by due date, ties by sortOrder.
      source: { kind: 'todos', todoIds: [5, 6, 1, 2, 3, 7, 12, 13] },
    })
    fireEvent.click(tile('dueNext7'))
    expect(onDrill.mock.lastCall?.[0].description).toBe('Open tasks due today through Fri 16.')
  })

  it('a list tile opens its list', () => {
    const onDrill = vi.fn()
    setup(tabWith({ listTiles: [3] }), onDrill)
    fireEvent.click(document.querySelector('[data-dash-list-tile="3"]')!)
    expect(onDrill).toHaveBeenLastCalledWith({
      title: '#q4 planning', glyph: 'list', description: 'Saved list · #q4', source: { kind: 'list', listDefinitionId: 3 },
    })
  })

  it('panel counts open their tasks: Hot as its tile, Needs follow-up and Status under headings', () => {
    const onDrill = vi.fn()
    setup(tabWith(), onDrill)
    fireEvent.click(within(section('hot')!).getByTestId('dash-section-count'))
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'Hot tasks', source: { kind: 'todos', todoIds: [1, 2, 3, 4] } })

    fireEvent.click(within(section('followup')!).getByTestId('dash-section-count'))
    const fu = onDrill.mock.lastCall?.[0]
    expect(fu.title).toBe('Needs follow-up')
    expect(fu.source.groups.map((g: Group) => [g.label, g.todoIds])).toEqual([['Late', [10]], ['Today', [9]], ['Next 7 days', [11, 8, 4]]])

    fireEvent.click(within(section('status')!).getByTestId('dash-section-count'))
    const st = onDrill.mock.lastCall?.[0]
    expect(st.title).toBe('Open tasks')
    expect(st.source.groups.map((g: Group) => [g.label, g.todoIds.length])).toEqual([['To do', 11], ['In progress', 5], ['Waiting', 2], ['Blocked', 1]])
  })

  it('a status row opens its tasks', () => {
    const onDrill = vi.fn()
    setup(tabWith(), onDrill)
    const waiting = Array.from(section('status')!.querySelectorAll<HTMLElement>('[data-status-key]')).find((r) => r.textContent?.startsWith('Waiting'))!
    fireEvent.click(waiting)
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'Waiting', description: 'Status: Waiting.', source: { kind: 'todos', todoIds: [9, 10] } })
  })

  it('a Next 7 days column opens its due and follow-up tasks under headings', () => {
    const onDrill = vi.fn()
    setup(tabWith(), onDrill)
    const days = within(section('next7')!).getAllByTestId('dash-day')
    fireEvent.click(days[1]!)
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({
      title: 'Today',
      description: 'Open tasks due, or to follow up, today.',
      source: { kind: 'groups', groups: [{ key: 'due', label: 'Due', todoIds: [1, 2, 3] }, { key: 'followup', label: 'Follow-up', todoIds: [9] }] },
    })
    fireEvent.click(days[6]!)
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'Thu 15', description: 'Open tasks due, or to follow up, on Thu 15.' })
  })

  it('a trend day opens what was completed and created then; the totals open theirs', () => {
    const onDrill = vi.fn()
    setup(tabWith(), onDrill)
    const today = Array.from(section('trend')!.querySelectorAll<HTMLElement>('button[class*="trendGroup"]')).at(-1)!
    fireEvent.click(today)
    const day = onDrill.mock.lastCall?.[0]
    expect(day.title).toBe('Sat 10')
    expect(day.source.groups.map((g: Group) => [g.label, g.todoIds])).toEqual([['Completed', [114]], ['Created', [1]]])

    fireEvent.click(within(section('trend')!).getByTestId('dash-trend-completed'))
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'Completed', description: 'Tasks completed in the last 14 days.' })
    expect(onDrill.mock.lastCall?.[0].source.todoIds).toHaveLength(14)
    fireEvent.click(within(section('trend')!).getByTestId('dash-trend-created'))
    expect(onDrill.mock.lastCall?.[0].source.todoIds).toHaveLength(17)
  })

  it('a person row opens that person’s tasks in their own order; Unassigned too', () => {
    const onDrill = vi.fn()
    setup(tabWith(), onDrill)
    const rows = Array.from(section('people')!.querySelectorAll<HTMLElement>('[data-person-row]'))
    fireEvent.click(rows[0]!)
    expect(onDrill.mock.lastCall?.[0]).toEqual({
      title: 'Priya Nair', glyph: 'people', description: 'Open tasks assigned to Priya Nair.',
      source: { kind: 'todos', todoIds: [3, 11, 14, 15] },
      personId: PEOPLE.find((p) => p.name === 'Priya Nair')?.id,
    })
    fireEvent.click(rows.at(-1)!)
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'Unassigned', description: 'Open tasks with nobody assigned.' })
    expect(onDrill.mock.lastCall?.[0]).not.toHaveProperty('personId')
  })

  it('under the top-bar filter a dialog says so and holds what the number counts', () => {
    const onDrill = vi.fn()
    useFilterStore.setState((s) => ({ filters: { ...s.filters, tags: new Set([Q4]) } }))
    setup(tabWith(), onDrill)
    fireEvent.click(tile('open'))
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({
      description: 'Every open task. Only tasks the top-bar filter shows.',
      source: { kind: 'todos', todoIds: [7, 14, 15, 4, 17] },
    })
  })
})
