import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { GLANCE_GLYPH } from '../../../utils/glance-glyphs'
import { render, cleanup, act, within, fireEvent } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { GlanceWidget } from '../../../components/workspace/glance/GlanceWidget'
import type { GlanceResult } from '../../../components/workspace/glance/glance-hooks'
import type { GlanceDrill } from '../../../components/workspace/glance/glance-types'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import type { TileMetricId } from '../../../models/glance-widgets'
import { createTab, type GlanceTab, type GlanceWidgetKind } from '../../../models/workspace-layout'
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
import { emptyPredicate } from '../../../models/filter-predicate'
import { clearFilterStore, resetEntityStores } from '../../helpers'
import {
  ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, Q4, SAMPLE_EVENTS, SAMPLE_LISTS, SAMPLE_TASKS, SAMPLE_TODAY, STATUSES, TAGS,
} from '../../fixtures/glance-sample'

/**
 * The glance widgets over the design sample (the old Dashboard's numbers):
 * Numbers for its tiles and a widget per section, each tab named by its
 * kind (a Number by its metric).
 */

/** What each widget last reported, by tab id. */
const results = new Map<string, GlanceResult>()
const lines = (tabId: string) => results.get(tabId)?.summary.plain.split('\n')

const num = (metric: TileMetricId): GlanceTab => ({ id: metric, kind: 'number', config: { metric } })
const of = (kind: GlanceWidgetKind, config?: object): GlanceTab => {
  const tab = createTab(kind, kind) as GlanceTab
  return (config ? { ...tab, config: { ...tab.config, ...config } } : tab) as GlanceTab
}
const DEFAULT_TILES: TileMetricId[] = ['open', 'focus', 'urgent', 'overdue', 'followupDue']
/** A new Dashboard's parts, as widgets: its tiles and its sections. */
const defaults = (): GlanceTab[] => [...DEFAULT_TILES.map(num), of('followup'), of('next7'), of('trend'), of('status'), of('people')]

function setup(tabs: GlanceTab[] = defaults(), onDrill?: (d: GlanceDrill) => void) {
  return render(
    <DndContext>
      <WidgetFaceContext.Provider value={{}}>
        {tabs.map((tab) => <GlanceWidget key={tab.id} tab={tab} onResult={(r) => { results.set(tab.id, r) }} onDrill={onDrill} />)}
      </WidgetFaceContext.Provider>
    </DndContext>,
  )
}

const tile = (id: string) => document.querySelector<HTMLElement>(`[data-number-metric="${id}"]`)!
const tileCount = (id: string) => within(tile(id)).getByTestId('number-count').textContent
const section = (id: string) => document.querySelector<HTMLElement>(`[data-glance-section="${id}"]`)
const sectionCount = (id: string) => within(section(id)!).getByTestId('glance-section-count').textContent
const rowTitles = (el: HTMLElement) => Array.from(el.querySelectorAll('[data-row-todo]'))
  .map((r) => SAMPLE_TASKS.find((t) => t.id === Number((r as HTMLElement).dataset.rowTodo))?.title)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 10, 10))
  results.clear()
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ urgentDueWithinDays: 3, weekStartsOn: 0 })
  useTodoStore.setState({ todos: SAMPLE_TASKS })
  usePersonStore.setState({ people: PEOPLE, assignedPeopleMap: ASSIGNED_PEOPLE })
  useTagStore.setState({ tags: TAGS, assignedTagsMap: ASSIGNED_TAGS })
  useStatusStore.setState({ statuses: STATUSES })
  useListDefinitionStore.setState({ listDefinitions: SAMPLE_LISTS })
  useListDraftStore.setState({ drafts: {} })
  useUIStore.setState({ selectedTodoIds: new Set(), selectionScope: null, taskDialog: null })
  // The trend's and the Numbers' history, as the cache holds them after their reads.
  useTrendEventsStore.setState({
    entries: new Map([
      [trendEventsKey('14d', SAMPLE_TODAY, 0), { events: SAMPLE_EVENTS, stale: false, loading: false }],
      [trendEventsKey('history', SAMPLE_TODAY, 0), { events: SAMPLE_EVENTS, stale: false, loading: false }],
    ]),
    generation: 0,
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('glance widgets — the design sample', () => {
  it('renders the default tiles with the design numbers and sub-lines', () => {
    setup()
    expect(Array.from(document.querySelectorAll<HTMLElement>('[data-number-metric]')).map((el) => el.dataset.numberMetric))
      .toEqual(['open', 'focus', 'urgent', 'overdue', 'followupDue'])
    expect(['open', 'urgent', 'overdue', 'followupDue', 'focus'].map(tileCount)).toEqual(['19', '8', '2', '2', '3'])
    expect(tile('open').textContent).toContain('+3 in the last 14 days')
    expect(tile('urgent').textContent).toContain('3 flagged · 5 by due date')
    expect(tile('overdue').textContent).toContain('Oldest Wed 7 · 3d late')
    expect(tile('followupDue').textContent).toContain('1 late · 3 more in 7 days')
    expect(tile('focus').textContent).toContain('2 due today')
    expect(tile('open').querySelector('polyline')).not.toBeNull()
  })

  it('tiles are lit only when their number asks for action', () => {
    setup()
    expect(['open', 'focus', 'urgent', 'overdue', 'followupDue'].filter((id) => tile(id).dataset.lit === 'true'))
      .toEqual(['urgent', 'overdue', 'followupDue'])
    const count = (id: string) => tile(id).querySelector<HTMLElement>('[data-testid="number-count"]')!.style.color
    expect(count('overdue')).toBe('var(--color-overdue)')
    expect(count('open')).toBe('var(--color-text-primary)')
    expect(count('focus')).toBe('var(--color-text-primary)')
  })

  it('each section widget renders its section', () => {
    setup()
    const ids = Array.from(document.querySelectorAll('[data-glance-section]')).map((el) => (el as HTMLElement).dataset.glanceSection)
    expect(ids).toEqual(['followup', 'next7', 'trend', 'status', 'people'])
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
    const days = within(section('next7')!).getAllByTestId('glance-day')
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
    const today = within(panel).getAllByTestId('glance-day')[1]!
    const due = today.querySelector('[data-count="due"]')
    const followup = today.querySelector('[data-count="followup"]')
    expect(due?.textContent).toBe('3')
    expect(followup?.textContent).toBe('1')
    expect(glyphOf(due)).toBe(GLANCE_GLYPH.calendar)
    expect(glyphOf(followup)).toBe(GLANCE_GLYPH.followup)
    // The key shows the same glyphs beside its words.
    const key = (label: string) => within(panel).getByText(label)
    expect(glyphOf(key('Due'))).toBe(GLANCE_GLYPH.calendar)
    expect(glyphOf(key('Follow-up'))).toBe(GLANCE_GLYPH.followup)
  })

  it('Created vs completed: the window totals', () => {
    setup()
    expect(within(section('trend')!).getByTestId('glance-trend-completed').textContent).toBe('14completed')
    expect(within(section('trend')!).getByTestId('glance-trend-created').textContent).toBe('17created')
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
    setup([of('people', { showUnassigned: false })])
    const rows = Array.from(section('people')!.querySelectorAll<HTMLElement>('[data-person-row]'))
    expect(rows.map((r) => r.dataset.personRow)).not.toContain('none')
  })
})

describe('glance widgets — priority badges', () => {
  const badges = (row: Element) => Array.from(row.querySelectorAll<HTMLElement>('[data-priority]')).map((b) => [b.dataset.priority, b.textContent])

  it('a People row shows its open tasks by priority, a badge for each that has any, named on the row', () => {
    setup([of('people')], vi.fn())
    const rows = Array.from(section('people')!.querySelectorAll<HTMLElement>('[data-person-row]'))
    expect(rows.length).toBeGreaterThan(1)
    const withBadges = rows.find((r) => badges(r).length > 0)!
    for (const [key, count] of badges(withBadges)) expect(withBadges.getAttribute('aria-label')).toMatch(new RegExp(`${count} ${key}`, 'i'))
    expect(section('people')!.textContent).toContain('Priority')
    expect(section('people')!.textContent).not.toContain('Hot')
  })

  it('a Tags row likewise', () => {
    setup([of('tags')], vi.fn())
    expect(section('tags')!.querySelector('[data-priority]')).not.toBeNull()
    expect(section('tags')!.textContent).not.toContain('Hot')
  })
})

describe('glance widgets — screen filter', () => {
  it('every count reads shown of total under the top-bar filter', () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, tags: new Set([Q4]) } }))
    setup()
    expect(['open', 'urgent', 'overdue', 'followupDue', 'focus'].map(tileCount))
      .toEqual(['5of 19', '1of 8', '0of 2', '0of 2', '1of 3'])
    expect(tile('overdue').textContent).toContain('Nothing overdue')
    // At 0 a tile goes neutral, its count muted.
    expect(tile('overdue').dataset.lit).toBeUndefined()
    expect(tile('overdue').querySelector<HTMLElement>('[data-testid="number-count"]')!.style.color).toBe('var(--color-text-muted)')
    expect(tile('focus').textContent).toContain('None due today')
    expect(lines('open')?.[0]).toBe('Open 5 of 19')
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
    expect(tileCount('urgent')).toBe('7')
  })
})

describe('glance widgets — drill hook', () => {
  type Group = { label: string; todoIds: number[] }

  it('without a drill handler numbers are not buttons', () => {
    setup()
    expect(tile('open').tagName).toBe('DIV')
    expect(section('followup')!.querySelector('button[data-testid="glance-section-count"]')).toBeNull()
    expect(section('people')!.querySelector('button[data-person-row]')).toBeNull()
  })

  it('a tile opens its tasks in dialog order, saying what it counts', () => {
    const onDrill = vi.fn()
    setup([num('urgent'), num('dueNext7')], onDrill)
    fireEvent.click(tile('urgent'))
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({
      description: 'Urgent = flagged urgent, or due within 3 days (Settings › Tasks).',
      // Overdue first, then by due date, ties by sortOrder.
      source: { kind: 'todos', todoIds: [5, 6, 1, 2, 3, 7, 12, 13] },
    })
    fireEvent.click(tile('dueNext7'))
    expect(onDrill.mock.lastCall?.[0].description).toBe('Open tasks due today through Fri 16.')
  })

  it('panel counts open their tasks: Needs follow-up and Status under headings', () => {
    const onDrill = vi.fn()
    setup(defaults(), onDrill)
    fireEvent.click(within(section('followup')!).getByTestId('glance-section-count'))
    const fu = onDrill.mock.lastCall?.[0]
    expect(fu.title).toBe('Needs follow-up')
    expect(fu.source.groups.map((g: Group) => [g.label, g.todoIds])).toEqual([['Late', [10]], ['Today', [9]], ['Next 7 days', [11, 8, 4]]])

    fireEvent.click(within(section('status')!).getByTestId('glance-section-count'))
    const st = onDrill.mock.lastCall?.[0]
    expect(st.title).toBe('Open tasks')
    expect(st.source.groups.map((g: Group) => [g.label, g.todoIds.length])).toEqual([['To do', 11], ['In progress', 5], ['Waiting', 2], ['Blocked', 1]])
  })

  it('a status row opens its tasks', () => {
    const onDrill = vi.fn()
    setup(defaults(), onDrill)
    const waiting = Array.from(section('status')!.querySelectorAll<HTMLElement>('[data-status-key]')).find((r) => r.textContent?.startsWith('Waiting'))!
    fireEvent.click(waiting)
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'Waiting', description: 'Status: Waiting.', source: { kind: 'todos', todoIds: [9, 10] } })
  })

  it('a Next 7 days column opens its due and follow-up tasks under headings', () => {
    const onDrill = vi.fn()
    setup(defaults(), onDrill)
    const days = within(section('next7')!).getAllByTestId('glance-day')
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
    setup(defaults(), onDrill)
    const today = Array.from(section('trend')!.querySelectorAll<HTMLElement>('button[class*="trendGroup"]')).at(-1)!
    fireEvent.click(today)
    const day = onDrill.mock.lastCall?.[0]
    expect(day.title).toBe('Sat 10')
    expect(day.source.groups.map((g: Group) => [g.label, g.todoIds])).toEqual([['Completed', [114]], ['Created', [1]]])

    fireEvent.click(within(section('trend')!).getByTestId('glance-trend-completed'))
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'Completed', description: 'Tasks completed in the last 14 days.' })
    expect(onDrill.mock.lastCall?.[0].source.todoIds).toHaveLength(14)
    fireEvent.click(within(section('trend')!).getByTestId('glance-trend-created'))
    expect(onDrill.mock.lastCall?.[0].source.todoIds).toHaveLength(17)
  })

  it('a person row opens that person’s tasks in their own order; Unassigned too', () => {
    const onDrill = vi.fn()
    setup(defaults(), onDrill)
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
    setup(defaults(), onDrill)
    fireEvent.click(tile('open'))
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({
      description: 'Every open task. Only tasks the top-bar filter shows.',
      source: { kind: 'todos', todoIds: [7, 14, 15, 4, 17] },
    })
  })
})

describe('glance widgets — Tags, Stale tasks, Recently completed, Eisenhower', () => {
  const NEW_SECTIONS = (): GlanceTab[] => [of('tags'), of('stale'), of('recent'), of('eisenhowerSummary')]
  const tagRows = () => Array.from(section('tags')!.querySelectorAll<HTMLElement>('[data-tag-row]'))
  const eisCount = (q: string) => within(section('eisenhower')!.querySelector<HTMLElement>(`[data-eis-cell="${q}"]`)!).getByTestId('glance-eis-count').textContent

  it('Tags: open tasks per tag by count then name, No tag last (can be hidden), the tagged count', () => {
    setup([of('tags')])
    expect(sectionCount('tags')).toBe('9 tagged')
    expect(tagRows().map((r) => [r.dataset.tagRow, r.querySelector('[class*="tagName"]')?.textContent, r.querySelector('[data-testid="glance-tag-open"]')?.textContent]))
      .toEqual([['1', '#q4', '5'], ['4', '#errands', '2'], ['3', '#home', '1'], ['2', '#planning', '1'], ['none', 'No tag', '10']])
    cleanup()
    setup([of('tags', { showUntagged: false })])
    expect(tagRows().map((r) => r.dataset.tagRow)).toEqual(['1', '4', '3', '2'])
  })

  it('Stale tasks: open tasks not changed in N days, oldest first, as task rows', () => {
    setup([of('stale')])
    expect(sectionCount('stale')).toBe('2')
    expect(section('stale')!.textContent).toContain('Not changed in 14 days or more')
    expect(rowTitles(section('stale')!)).toEqual(['Offsite agenda', 'Clean up shared drive'])
    expect(section('stale')!.querySelector('[data-drag-id^="lw|stale|stale|"]')).not.toBeNull()
    cleanup()
    setup([of('stale', { staleDays: 60 })])
    expect(section('stale')!.textContent).toContain('Nothing stale')
    expect(section('stale')!.textContent).toContain('Every open task changed in the last 60 days.')
  })

  it('Recently completed: completed in the last N days, newest first, as task rows', () => {
    setup([of('recent')])
    expect(sectionCount('recent')).toBe('7')
    expect(section('recent')!.textContent).toContain('Last 7 days')
    expect(rowTitles(section('recent')!)).toEqual([
      'Ship release notes', 'Order team swag', 'Interview debrief', 'Q4 OKR draft', 'Car service', 'Fix login bug', 'Team lunch booking',
    ])
    cleanup()
    setup([of('recent', { recentDays: 14 })])
    expect(sectionCount('recent')).toBe('14')
  })

  it('Eisenhower: open tasks by urgent × important', () => {
    setup([of('eisenhowerSummary')])
    expect(sectionCount('eisenhower')).toBe('19 open')
    expect(['do', 'schedule', 'delegate', 'drop'].map(eisCount)).toEqual(['3', '1', '5', '10'])
    expect(section('eisenhower')!.querySelector('[data-eis-cell="delegate"]')!.textContent).toContain('4 by due date')
  })

  it('under the top-bar filter their counts read shown of total, and so do their lines for Copy', () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, tags: new Set([Q4]) } }))
    setup([num('open'), ...NEW_SECTIONS()])
    expect(sectionCount('tags')).toBe('5 of 9 tagged')
    expect(tagRows().map((r) => r.dataset.tagRow)).toEqual(['1'])
    expect(sectionCount('stale')).toBe('1 of 2')
    expect(sectionCount('recent')).toBe('1 of 7')
    expect(sectionCount('eisenhower')).toBe('5 of 19 open')
    expect(['do', 'schedule', 'delegate', 'drop'].map(eisCount)).toEqual(['0of 3', '1', '1of 5', '3of 10'])
    expect(lines('open')?.[0]).toBe('Open 5 of 19')
    expect(lines('tags')).toEqual(['Tags 5 of 9 tagged', '#q4 5'])
    expect(lines('stale')?.[0]).toBe('Stale tasks 1 of 2')
    expect(lines('recent')?.[0]).toBe('Recently completed 1 of 7')
    expect(lines('eisenhowerSummary')?.at(-1)).toBe('Do 0 of 3 · Schedule 1 · Delegate 1 of 5 · Drop 3 of 10')
  })

  it('their numbers open the tasks behind them', () => {
    const onDrill = vi.fn()
    setup(NEW_SECTIONS(), onDrill)
    fireEvent.click(tagRows()[0]!)
    expect(onDrill.mock.lastCall?.[0]).toEqual({ title: '#q4', glyph: 'tag', description: 'Open tasks tagged #q4.', source: { kind: 'todos', todoIds: [4, 7, 14, 15, 17] } })
    fireEvent.click(tagRows().at(-1)!)
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'No tag', source: { kind: 'todos', todoIds: [1, 2, 5, 8, 9, 10, 11, 12, 16, 19] } })
    fireEvent.click(within(section('tags')!).getByTestId('glance-section-count'))
    const tags = onDrill.mock.lastCall?.[0]
    expect(tags.title).toBe('Tagged tasks')
    expect(tags.source.groups.map((g: { label: string; todoIds: number[] }) => [g.label, g.todoIds.length])).toEqual([['#q4', 5], ['#errands', 2], ['#home', 1], ['#planning', 1]])

    fireEvent.click(within(section('stale')!).getByTestId('glance-section-count'))
    expect(onDrill.mock.lastCall?.[0]).toEqual({
      title: 'Stale tasks', glyph: 'stale', description: 'Open tasks not changed in 14 days or more, oldest first.', source: { kind: 'todos', todoIds: [17, 19] },
    })
    fireEvent.click(within(section('recent')!).getByTestId('glance-section-count'))
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'Recently completed', source: { kind: 'todos', todoIds: [114, 113, 112, 103, 111, 110, 109] } })

    fireEvent.click(section('eisenhower')!.querySelector<HTMLElement>('[data-eis-cell="delegate"]')!)
    expect(onDrill.mock.lastCall?.[0]).toEqual({
      title: 'Delegate', glyph: 'matrix',
      description: 'Open tasks that are urgent, not important. Urgent includes tasks due within 3 days.',
      source: { kind: 'todos', todoIds: [5, 6, 7, 12, 13] },
    })
    fireEvent.click(within(section('eisenhower')!).getByTestId('glance-section-count'))
    expect(onDrill.mock.lastCall?.[0].source.groups.map((g: { label: string; todoIds: number[] }) => [g.label, g.todoIds.length]))
      .toEqual([['Do', 3], ['Schedule', 1], ['Delegate', 5], ['Drop', 10]])
  })
})

describe('the Eisenhower summary follows the app-wide panes and the Eisenhower’s list', () => {
  const eisCount = (q: string) => within(section('eisenhower')!.querySelector<HTMLElement>(`[data-eis-cell="${q}"]`)!).getByTestId('glance-eis-count').textContent
  const Q4_LIST = {
    id: 90, name: 'Q4 work', sortOrder: 9, sort: 'manual' as const, grouping: 'none' as const,
    membership: { kind: 'custom' as const, predicate: { ...emptyPredicate(), tags: [Q4] } },
  }
  /** Delegate renamed and narrowed: not Waiting (a status of the sample). */
  const waiting = STATUSES.find((s) => s.name === 'Waiting')!

  it('its list with a filter and a custom pane: counts, names, Copy and drills', () => {
    useListDefinitionStore.setState({ listDefinitions: [...SAMPLE_LISTS, Q4_LIST] })
    useSettingsStore.setState({
      eisenhowerListId: 90,
      eisenhowerPanes: { delegate: { name: 'Hand off', filter: { ...emptyPredicate(), markers: [{ values: ['urgent'] }, { values: ['important'], not: true }], statusIds: [waiting.id!], negate: { statusIds: true } } } },
    })
    const onDrill = vi.fn()
    setup([num('open'), of('eisenhowerSummary')], onDrill)
    // The list's five open tasks (the q4 tag), as under the q4 screen filter before.
    expect(sectionCount('eisenhower')).toBe('5 open')
    expect(['do', 'schedule', 'delegate', 'drop'].map(eisCount)).toEqual(['0', '1', '1', '3'])
    expect(section('eisenhower')!.textContent).toContain('“Q4 work” · Custom panes')
    const delegate = section('eisenhower')!.querySelector<HTMLElement>('[data-eis-cell="delegate"]')!
    expect(delegate.textContent).toContain('Hand off')
    expect(delegate.textContent).toContain('not Waiting')
    expect(lines('eisenhowerSummary')?.at(-1)).toBe('Do 0 · Schedule 1 · Hand off 1 · Drop 3')
    fireEvent.click(delegate)
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'Hand off', source: { kind: 'todos', todoIds: [7] } })
    expect(onDrill.mock.lastCall?.[0].description).toContain('Open tasks of “Q4 work” in “Hand off”')
    fireEvent.click(within(section('eisenhower')!).getByTestId('glance-section-count'))
    expect(onDrill.mock.lastCall?.[0].source.groups.map((g: { label: string }) => g.label)).toEqual(['Do', 'Schedule', 'Hand off', 'Drop'])
  })

  it('the list’s unsaved draft counts, as in the widget', () => {
    useListDefinitionStore.setState({ listDefinitions: [...SAMPLE_LISTS, Q4_LIST] })
    useListDraftStore.setState({ drafts: { 90: { ...Q4_LIST, membership: { kind: 'custom', predicate: { ...emptyPredicate() } } } } })
    useSettingsStore.setState({ eisenhowerListId: 90 })
    setup([of('eisenhowerSummary')])
    expect(sectionCount('eisenhower')).toBe('19 open')
  })

  it('its list without a filter: every task, the sub line names no list', () => {
    useListDefinitionStore.setState({ listDefinitions: [...SAMPLE_LISTS, { ...Q4_LIST, name: 'Eisenhower', membership: { kind: 'custom', predicate: emptyPredicate() }, owner: { eisenhower: true } }] })
    useSettingsStore.setState({ eisenhowerListId: 90 })
    setup([num('open'), of('eisenhowerSummary')])
    expect(sectionCount('eisenhower')).toBe('19 open')
    expect(section('eisenhower')!.textContent).not.toContain('“Eisenhower”')
    expect(section('eisenhower')!.textContent).toContain('Urgent × important')
  })

  it('its list not loaded yet: every task is counted', () => {
    useSettingsStore.setState({ eisenhowerListId: 99 })
    setup([num('open'), of('eisenhowerSummary')])
    expect(section('eisenhower')!.textContent).not.toContain('deleted')
    expect(sectionCount('eisenhower')).toBe('19 open')
  })

})

describe('glance widgets — a completed row leaves its widget (D19)', () => {
  const complete = (id: number) => act(() => {
    useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === id ? { ...t, isCompleted: true, completedAt: new Date() } : t)) })
  })
  const reopen = (id: number) => act(() => {
    useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === id ? { ...t, isCompleted: false, completedAt: undefined } : t)) })
  })
  const leavingOf = (el: HTMLElement, id: number) => el.querySelector(`[data-row-todo="${id}"]`)?.getAttribute('data-leaving') ?? null

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(2026, 9, 10, 10))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stays in place, completed, for 500 ms, folds for 180 ms, then drops out; the count moves at once', () => {
    setup([of('stale')])
    complete(17)
    const stale = section('stale')!
    expect(rowTitles(stale)).toEqual(['Offsite agenda', 'Clean up shared drive'])
    expect(leavingOf(stale, 17)).toBe('stay')
    expect(within(stale.querySelector<HTMLElement>('[data-row-todo="17"]')!).getByRole('checkbox', { name: 'Mark incomplete' })).toBeChecked()
    expect(sectionCount('stale')).toBe('1')
    act(() => { vi.advanceTimersByTime(500) })
    expect(leavingOf(stale, 17)).toBe('fold')
    act(() => { vi.advanceTimersByTime(180) })
    expect(rowTitles(stale)).toEqual(['Clean up shared drive'])
  })

  it('Needs follow-up and Stale tasks: the row lingers in its group, which stays until it has folded', () => {
    setup([of('followup'), of('stale')])
    complete(10)
    complete(17)
    const followup = section('followup')!
    expect(within(followup).getByRole('group', { name: 'Late' })).toBeTruthy()
    expect(leavingOf(followup, 10)).toBe('stay')
    expect(leavingOf(section('stale')!, 17)).toBe('stay')
    act(() => { vi.advanceTimersByTime(680) })
    expect(within(followup).queryByRole('group', { name: 'Late' })).toBeNull()
    expect(rowTitles(section('stale')!)).toEqual(['Clean up shared drive'])
  })

  it('Stale tasks: the row lingers though the completion moved its modified date to now', () => {
    setup([of('stale')])
    act(() => {
      const now = new Date()
      useTodoStore.setState({ todos: useTodoStore.getState().todos.map((t) => (t.id === 17 ? { ...t, isCompleted: true, completedAt: now, modifiedAt: now } : t)) })
    })
    expect(rowTitles(section('stale')!)).toEqual(['Offsite agenda', 'Clean up shared drive'])
    expect(leavingOf(section('stale')!, 17)).toBe('stay')
    act(() => { vi.advanceTimersByTime(680) })
    expect(rowTitles(section('stale')!)).toEqual(['Clean up shared drive'])
  })

  it('a section that shows completed tasks (Recently completed) gains the row at once, unfolded', () => {
    setup([of('stale'), of('recent')])
    complete(17)
    expect(leavingOf(section('stale')!, 17)).toBe('stay')
    expect(section('recent')!.querySelector('[data-row-todo="17"]')).not.toBeNull()
    expect(leavingOf(section('recent')!, 17)).toBeNull()
  })

  it('reopened while it lingers, it simply stays', () => {
    setup([of('stale')])
    complete(17)
    reopen(17)
    expect(leavingOf(section('stale')!, 17)).toBeNull()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(rowTitles(section('stale')!)).toContain('Offsite agenda')
  })

  it('under reduced motion the row leaves at once', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    setup([of('stale')])
    complete(17)
    expect(rowTitles(section('stale')!)).toEqual(['Clean up shared drive'])
  })
})
