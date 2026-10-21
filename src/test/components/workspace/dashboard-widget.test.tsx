import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DASH_GLYPH } from '../../../utils/dash-glyphs'
import { render, cleanup, act, within, fireEvent, screen } from '@testing-library/react'
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
import { emptyPredicate } from '../../../models/filter-predicate'
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
      .toEqual(['open', 'hot', 'focus', 'urgent', 'overdue', 'followupDue'])
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
    expect(lastResult?.summary.plain).toBe('Open 19 · Hot 4 · Focus 3 · Urgent 8 · Overdue 2 · Follow-up due 2\nWaiting on 2')
  })

  it('“+ Add list tile” shows when the host can open Customize', () => {
    const onAdd = vi.fn()
    render(<DndContext><DashboardWidget tab={tabWith()} onAddListTile={onAdd} /></DndContext>)
    fireEvent.click(document.querySelector<HTMLElement>('[aria-label="List tiles"] button')!)
    expect(onAdd).toHaveBeenCalled()
  })

  it('the corner gear opens Customize when the host can; none without', () => {
    const onCustomize = vi.fn()
    const { unmount } = render(<DndContext><DashboardWidget tab={tabWith()} onCustomize={onCustomize} /></DndContext>)
    fireEvent.click(screen.getByRole('button', { name: 'Customize dashboard' }))
    expect(onCustomize).toHaveBeenCalled()
    unmount()
    render(<DndContext><DashboardWidget tab={tabWith()} /></DndContext>)
    expect(screen.queryByRole('button', { name: 'Customize dashboard' })).toBeNull()
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

  it('Next 7 days: due and follow-up read apart without colour — a glyph on each count and in the key', () => {
    setup()
    const panel = section('next7')!
    const glyphOf = (el: Element | null) => el?.querySelector('svg path')?.getAttribute('d')
    const today = within(panel).getAllByTestId('dash-day')[1]!
    const due = today.querySelector('[data-count="due"]')
    const followup = today.querySelector('[data-count="followup"]')
    expect(due?.textContent).toBe('3')
    expect(followup?.textContent).toBe('1')
    expect(glyphOf(due)).toBe(DASH_GLYPH.calendar)
    expect(glyphOf(followup)).toBe(DASH_GLYPH.followup)
    // The key shows the same glyphs beside its words.
    const key = (label: string) => within(panel).getByText(label)
    expect(glyphOf(key('Due'))).toBe(DASH_GLYPH.calendar)
    expect(glyphOf(key('Follow-up'))).toBe(DASH_GLYPH.followup)
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
    expect(lastResult?.summary.plain).toBe('Open 5 of 19 · Hot 1 of 4 · Focus 1 of 3 · Urgent 1 of 8 · Overdue 0 of 2 · Follow-up due 0 of 2')
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
  const HOT_WORDS = 'Hot = urgent and important, or in Focus (Settings › Tasks).'
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
      description: 'Urgent = flagged urgent, or due within 3 days (Settings › Tasks).',
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
      title: '#q4 planning', glyph: 'list', description: 'List · #q4', source: { kind: 'list', listDefinitionId: 3 },
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

describe('DashboardWidget — Tags, Stale tasks, Recently completed, Eisenhower', () => {
  const NEW_SECTIONS = [{ id: 'tags' }, { id: 'stale' }, { id: 'recent' }, { id: 'eisenhower' }] as const
  const tagRows = () => Array.from(section('tags')!.querySelectorAll<HTMLElement>('[data-tag-row]'))
  const eisCount = (q: string) => within(section('eisenhower')!.querySelector<HTMLElement>(`[data-eis-cell="${q}"]`)!).getByTestId('dash-eis-count').textContent

  it('a new dashboard doesn’t show them; a config that lists them does, with their spans', () => {
    setup()
    for (const { id } of NEW_SECTIONS) expect(section(id)).toBeNull()
    cleanup()
    setup(tabWith({ sections: [...NEW_SECTIONS] }))
    // Tags 4 + Stale 5 share a row (Stale stretches to 8); Recently completed 4 + Eisenhower 3 the next.
    expect(NEW_SECTIONS.map(({ id }) => section(id)!.style.gridColumn)).toEqual(['span 4', 'span 8', 'span 4', 'span 8'])
  })

  it('Tags: open tasks per tag by count then name, No tag last (can be hidden), the tagged count', () => {
    setup(tabWith({ sections: [{ id: 'tags' }] }))
    expect(sectionCount('tags')).toBe('9 tagged')
    expect(tagRows().map((r) => [r.dataset.tagRow, r.querySelector('[class*="tagName"]')?.textContent, r.querySelector('[data-testid="dash-tag-open"]')?.textContent]))
      .toEqual([['1', '#q4', '5'], ['4', '#errands', '2'], ['3', '#home', '1'], ['2', '#planning', '1'], ['none', 'No tag', '10']])
    cleanup()
    setup(tabWith({ sections: [{ id: 'tags', options: { showUntagged: false } }] }))
    expect(tagRows().map((r) => r.dataset.tagRow)).toEqual(['1', '4', '3', '2'])
  })

  it('Stale tasks: open tasks not changed in N days, oldest first, as task rows', () => {
    setup(tabWith({ sections: [{ id: 'stale' }] }))
    expect(sectionCount('stale')).toBe('2')
    expect(section('stale')!.textContent).toContain('Not changed in 14 days or more')
    expect(rowTitles(section('stale')!)).toEqual(['Offsite agenda', 'Clean up shared drive'])
    expect(section('stale')!.querySelector('[data-drag-id^="lw|dash|stale|"]')).not.toBeNull()
    cleanup()
    setup(tabWith({ sections: [{ id: 'stale', options: { staleDays: 60 } }] }))
    expect(section('stale')!.textContent).toContain('Nothing stale')
    expect(section('stale')!.textContent).toContain('Every open task changed in the last 60 days.')
  })

  it('Recently completed: completed in the last N days, newest first, as task rows', () => {
    setup(tabWith({ sections: [{ id: 'recent' }] }))
    expect(sectionCount('recent')).toBe('7')
    expect(section('recent')!.textContent).toContain('Last 7 days')
    expect(rowTitles(section('recent')!)).toEqual([
      'Ship release notes', 'Order team swag', 'Interview debrief', 'Q4 OKR draft', 'Car service', 'Fix login bug', 'Team lunch booking',
    ])
    cleanup()
    setup(tabWith({ sections: [{ id: 'recent', options: { recentDays: 14 } }] }))
    expect(sectionCount('recent')).toBe('14')
  })

  it('Eisenhower: open tasks by urgent × important', () => {
    setup(tabWith({ sections: [{ id: 'eisenhower' }] }))
    expect(sectionCount('eisenhower')).toBe('19 open')
    expect(['do', 'schedule', 'delegate', 'drop'].map(eisCount)).toEqual(['3', '1', '5', '10'])
    expect(section('eisenhower')!.querySelector('[data-eis-cell="delegate"]')!.textContent).toContain('4 by due date')
  })

  it('under the top-bar filter their counts read shown of total; Copy summary lists them', () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, tags: new Set([Q4]) } }))
    setup(tabWith({ tiles: ['open'], sections: [...NEW_SECTIONS] }))
    expect(sectionCount('tags')).toBe('5 of 9 tagged')
    expect(tagRows().map((r) => r.dataset.tagRow)).toEqual(['1'])
    expect(sectionCount('stale')).toBe('1 of 2')
    expect(sectionCount('recent')).toBe('1 of 7')
    expect(sectionCount('eisenhower')).toBe('5 of 19 open')
    expect(['do', 'schedule', 'delegate', 'drop'].map(eisCount)).toEqual(['0of 3', '1', '1of 5', '3of 10'])
    expect(lastResult?.summary.plain).toBe([
      'Open 5 of 19',
      '#q4 5',
      'Stale tasks 1 of 2',
      'Recently completed 1 of 7',
      'Do 0 of 3 · Schedule 1 · Delegate 1 of 5 · Drop 3 of 10',
    ].join('\n'))
  })

  it('their numbers open the tasks behind them', () => {
    const onDrill = vi.fn()
    setup(tabWith({ sections: [...NEW_SECTIONS] }), onDrill)
    fireEvent.click(tagRows()[0]!)
    expect(onDrill.mock.lastCall?.[0]).toEqual({ title: '#q4', glyph: 'tag', description: 'Open tasks tagged #q4.', source: { kind: 'todos', todoIds: [4, 7, 14, 15, 17] } })
    fireEvent.click(tagRows().at(-1)!)
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'No tag', source: { kind: 'todos', todoIds: [1, 2, 5, 8, 9, 10, 11, 12, 16, 19] } })
    fireEvent.click(within(section('tags')!).getByTestId('dash-section-count'))
    const tags = onDrill.mock.lastCall?.[0]
    expect(tags.title).toBe('Tagged tasks')
    expect(tags.source.groups.map((g: { label: string; todoIds: number[] }) => [g.label, g.todoIds.length])).toEqual([['#q4', 5], ['#errands', 2], ['#home', 1], ['#planning', 1]])

    fireEvent.click(within(section('stale')!).getByTestId('dash-section-count'))
    expect(onDrill.mock.lastCall?.[0]).toEqual({
      title: 'Stale tasks', glyph: 'stale', description: 'Open tasks not changed in 14 days or more, oldest first.', source: { kind: 'todos', todoIds: [17, 19] },
    })
    fireEvent.click(within(section('recent')!).getByTestId('dash-section-count'))
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'Recently completed', source: { kind: 'todos', todoIds: [114, 113, 112, 103, 111, 110, 109] } })

    fireEvent.click(section('eisenhower')!.querySelector<HTMLElement>('[data-eis-cell="delegate"]')!)
    expect(onDrill.mock.lastCall?.[0]).toEqual({
      title: 'Delegate', glyph: 'matrix',
      description: 'Open tasks that are urgent, not important. Urgent includes tasks due within 3 days.',
      source: { kind: 'todos', todoIds: [5, 6, 7, 12, 13] },
    })
    fireEvent.click(within(section('eisenhower')!).getByTestId('dash-section-count'))
    expect(onDrill.mock.lastCall?.[0].source.groups.map((g: { label: string; todoIds: number[] }) => [g.label, g.todoIds.length]))
      .toEqual([['Do', 3], ['Schedule', 1], ['Delegate', 5], ['Drop', 10]])
  })
})

describe('DashboardWidget — the Eisenhower section follows the app-wide panes and the Eisenhower’s list', () => {
  const eisCount = (q: string) => within(section('eisenhower')!.querySelector<HTMLElement>(`[data-eis-cell="${q}"]`)!).getByTestId('dash-eis-count').textContent
  const Q4_LIST = {
    id: 90, name: 'Q4 work', sortOrder: 9, sort: 'manual' as const, grouping: 'none' as const,
    membership: { kind: 'custom' as const, predicate: { ...emptyPredicate(), tags: [Q4] } },
  }
  /** Delegate renamed and narrowed: not Waiting (a status of the sample). */
  const waiting = STATUSES.find((s) => s.name === 'Waiting')!

  it('its list with a filter and a custom pane: counts, names, Copy summary and drills', () => {
    useListDefinitionStore.setState({ listDefinitions: [...SAMPLE_LISTS, Q4_LIST] })
    useSettingsStore.setState({
      eisenhowerListId: 90,
      eisenhowerPanes: { delegate: { name: 'Hand off', filter: { ...emptyPredicate(), markers: { urgent: true, important: false }, statusIds: [waiting.id!], negate: { statusIds: true } } } },
    })
    const onDrill = vi.fn()
    setup(tabWith({ tiles: ['open'], sections: [{ id: 'eisenhower' }] }), onDrill)
    // The list's five open tasks (the q4 tag), as under the q4 screen filter before.
    expect(sectionCount('eisenhower')).toBe('5 open')
    expect(['do', 'schedule', 'delegate', 'drop'].map(eisCount)).toEqual(['0', '1', '1', '3'])
    expect(section('eisenhower')!.textContent).toContain('“Q4 work” · Custom panes')
    const delegate = section('eisenhower')!.querySelector<HTMLElement>('[data-eis-cell="delegate"]')!
    expect(delegate.textContent).toContain('Hand off')
    expect(delegate.textContent).toContain('not Waiting')
    expect(lastResult?.summary.plain.split('\n').at(-1)).toBe('Do 0 · Schedule 1 · Hand off 1 · Drop 3')
    fireEvent.click(delegate)
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'Hand off', source: { kind: 'todos', todoIds: [7] } })
    expect(onDrill.mock.lastCall?.[0].description).toContain('Open tasks of “Q4 work” in “Hand off”')
    fireEvent.click(within(section('eisenhower')!).getByTestId('dash-section-count'))
    expect(onDrill.mock.lastCall?.[0].source.groups.map((g: { label: string }) => g.label)).toEqual(['Do', 'Schedule', 'Hand off', 'Drop'])
  })

  it('the list’s unsaved draft counts, as in the widget', () => {
    useListDefinitionStore.setState({ listDefinitions: [...SAMPLE_LISTS, Q4_LIST] })
    useListDraftStore.setState({ drafts: { 90: { ...Q4_LIST, membership: { kind: 'custom', predicate: { ...emptyPredicate() } } } } })
    useSettingsStore.setState({ eisenhowerListId: 90 })
    setup(tabWith({ sections: [{ id: 'eisenhower' }] }))
    expect(sectionCount('eisenhower')).toBe('19 open')
  })

  it('its list without a filter: every task, the sub line names no list', () => {
    useListDefinitionStore.setState({ listDefinitions: [...SAMPLE_LISTS, { ...Q4_LIST, name: 'Eisenhower', membership: { kind: 'custom', predicate: emptyPredicate() }, owner: { eisenhower: true } }] })
    useSettingsStore.setState({ eisenhowerListId: 90 })
    setup(tabWith({ tiles: ['open'], sections: [{ id: 'eisenhower' }] }))
    expect(sectionCount('eisenhower')).toBe('19 open')
    expect(section('eisenhower')!.textContent).not.toContain('“Eisenhower”')
    expect(section('eisenhower')!.textContent).toContain('Urgent × important')
  })

  it('its list not loaded yet: every task is counted', () => {
    useSettingsStore.setState({ eisenhowerListId: 99 })
    setup(tabWith({ tiles: ['open'], sections: [{ id: 'eisenhower' }] }))
    expect(section('eisenhower')!.textContent).not.toContain('deleted')
    expect(sectionCount('eisenhower')).toBe('19 open')
  })

})
