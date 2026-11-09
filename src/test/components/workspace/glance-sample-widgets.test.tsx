import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act, within, fireEvent } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { GlanceWidget } from '../../../components/workspace/glance/GlanceWidget'
import type { GlanceResult } from '../../../components/workspace/glance/glance-hooks'
import type { GlanceDrill } from '../../../components/workspace/glance/glance-types'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import type { V77NumberMetric } from '../../../data/upgrades/v78/number-metrics'
import { createTab, type GlanceTab, type GlanceWidgetKind } from '../../../models/workspace-layout'
import type { BreakdownConfig, BreakdownSplit } from '../../../models/chart-widgets'
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
import { clearFilterStore, resetEntityStores } from '../../helpers'
import { numberTab } from '../../helpers/layout-builders'
import {
  ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, Q4, SAMPLE_EVENTS, SAMPLE_LISTS, SAMPLE_TASKS, SAMPLE_TODAY, STATUSES, TAGS,
} from '../../fixtures/glance-sample'

/**
 * The glance widgets over the design sample (the old Dashboard's numbers):
 * Numbers for its tiles and a widget per section, each tab named by its
 * kind (a Number by the v77 metric it was, its tab id).
 */

/** What each widget last reported, by tab id. */
const results = new Map<string, GlanceResult>()
const lines = (tabId: string) => results.get(tabId)?.summary.plain.split('\n')

const num = (metric: V77NumberMetric): GlanceTab => numberTab(metric, metric)
const of = (kind: GlanceWidgetKind, config?: object): GlanceTab => {
  const tab = createTab(kind, kind) as GlanceTab
  return (config ? { ...tab, config: { ...tab.config, ...config } } : tab) as GlanceTab
}
/** A Breakdown (D26 P8) as People, Tags or Status became: its tab id the split's. */
const bd = (splitBy: BreakdownSplit, over: Partial<BreakdownConfig> = {}): GlanceTab => {
  const name = { people: 'People', tags: 'Tags', status: 'Status' }[splitBy as 'people'] ?? 'Breakdown'
  return createTab('breakdown', splitBy, { breakdown: { name, splitBy, ...over } })
}
const DEFAULT_TILES: V77NumberMetric[] = ['open', 'focus', 'urgent', 'overdue', 'followupDue']
/** A new Dashboard's parts, as widgets: its tiles and its sections still kept (D26 retired Needs follow-up and Next 7 days; People and Status are Breakdowns). */
const defaults = (): GlanceTab[] => [...DEFAULT_TILES.map(num), of('trend'), bd('status'), bd('people')]

function setup(tabs: GlanceTab[] = defaults(), onDrill?: (d: GlanceDrill) => void) {
  return render(
    <DndContext>
      <WidgetFaceContext.Provider value={{}}>
        {tabs.map((tab) => <GlanceWidget key={tab.id} tab={tab} onResult={(r) => { results.set(tab.id, r) }} onDrill={onDrill} />)}
      </WidgetFaceContext.Provider>
    </DndContext>,
  )
}

const tile = (id: string) => document.querySelector<HTMLElement>(`[data-number="${id}"]`)!
const tileCount = (id: string) => within(tile(id)).getByTestId('number-count').textContent
/** A section by its kind (`trend`), or a chart by its tab id (`[data-chart]`). */
const section = (id: string) => document.querySelector<HTMLElement>(`[data-glance-section="${id}"], [data-chart="${id}"]`)
/** A drill's ids in id order. */
const sortedIds = (drill: { source: { todoIds: number[] } } | undefined) => [...(drill?.source.todoIds ?? [])].sort((a, b) => a - b)
const bdRows = (id: string) => Array.from(section(id)!.querySelectorAll<HTMLElement>('[data-breakdown-row]'))
const sectionCount = (id: string) => within(section(id)!).getByTestId('glance-section-count').textContent

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
  it('renders the default tiles with the design numbers', () => {
    setup()
    expect(Array.from(document.querySelectorAll<HTMLElement>('[data-number]')).map((el) => el.dataset.number))
      .toEqual(['open', 'focus', 'urgent', 'overdue', 'followupDue'])
    expect(['open', 'urgent', 'overdue', 'followupDue', 'focus'].map(tileCount)).toEqual(['19', '8', '2', '2', '3'])
    expect(tile('open').querySelector('polyline')).not.toBeNull()
  })

  it('tiles are lit only when their number asks for action', () => {
    setup()
    expect(['open', 'focus', 'urgent', 'overdue', 'followupDue'].filter((id) => tile(id).dataset.lit === 'true'))
      .toEqual(['urgent', 'overdue', 'followupDue'])
    const count = (id: string) => tile(id).querySelector<HTMLElement>('[data-testid="number-count"]')!.style.color
    expect(count('overdue')).toBe('rgb(232, 107, 240)')
    expect(count('open')).toBe('var(--color-text-primary)')
    expect(count('focus')).toBe('var(--color-text-primary)')
  })

  it('each section widget renders its section', () => {
    setup()
    const ids = Array.from(document.querySelectorAll('[data-glance-section]')).map((el) => (el as HTMLElement).dataset.glanceSection)
    expect(ids).toEqual(['trend', 'breakdown', 'breakdown'])
  })

  it('Created vs completed: the window totals', () => {
    setup()
    expect(within(section('trend')!).getByTestId('glance-trend-completed').textContent).toBe('14completed')
    expect(within(section('trend')!).getByTestId('glance-trend-created').textContent).toBe('17created')
    expect(section('trend')!.textContent).toContain('+3open since 09/27')
  })

  it('Status (a Breakdown): open counts per status, in Settings order', () => {
    setup()
    expect(sectionCount('status')).toBe('19 open')
    expect(bdRows('status').map((r) => [r.dataset.breakdownRow, r.querySelector('[data-testid="breakdown-figure"]')?.textContent]))
      .toEqual([['status-1', '11'], ['status-2', '5'], ['status-3', '2'], ['status-4', '1']])
  })

  it('People (a Breakdown): every person with a task, Unassigned last', () => {
    setup()
    const rows = bdRows('people')
    expect(rows.map((r) => r.querySelector('button')?.getAttribute('aria-label')?.split(':')[0]).sort())
      .toEqual(['Alice Chen', 'Ben Ortiz', 'Dana Kim', 'Priya Nair', 'Sam Lee', 'Unassigned'])
    expect(rows.at(-1)?.dataset.breakdownRow).toBe('none')
  })

  it('People: Unassigned can be hidden', () => {
    setup([bd('people', { showNone: false })])
    expect(bdRows('people').map((r) => r.dataset.breakdownRow)).not.toContain('none')
  })
})

describe('glance widgets — priority badges', () => {
  const badges = (row: Element) => Array.from(row.querySelectorAll<HTMLElement>('[data-priority]')).map((b) => [b.dataset.priority, b.textContent])

  it('a People row shows its open tasks by priority, a badge for each that has any, each badge named', () => {
    setup([bd('people')], vi.fn())
    const rows = bdRows('people')
    expect(rows.length).toBeGreaterThan(1)
    const withBadges = rows.find((r) => badges(r).length > 0)!
    for (const b of withBadges.querySelectorAll<HTMLElement>('[data-priority]')) expect(b.title).toMatch(new RegExp(`^${b.textContent} ${b.dataset.priority}$`, 'i'))
    expect(section('people')!.textContent).toContain('Priority')
    expect(section('people')!.textContent).not.toContain('Hot')
  })

  it('a Tags row likewise; a Priority split has no Priority column', () => {
    setup([bd('tags'), bd('priority')], vi.fn())
    expect(section('tags')!.querySelector('[data-priority]')).not.toBeNull()
    expect(section('priority')!.querySelector('[data-priority]')).toBeNull()
    expect(section('priority')!.querySelector('[data-sort-key="priority"]')).toBeNull()
  })
})

describe('glance widgets — screen filter', () => {
  it('every count reads shown of total under the top-bar filter', () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, tags: new Set([Q4]) } }))
    setup()
    expect(['open', 'urgent', 'overdue', 'followupDue', 'focus'].map(tileCount))
      .toEqual(['5of 19', '1of 8', '0of 2', '0of 2', '1of 3'])
    // At 0 a tile goes neutral, its count muted.
    expect(tile('overdue').dataset.lit).toBeUndefined()
    expect(tile('overdue').querySelector<HTMLElement>('[data-testid="number-count"]')!.style.color).toBe('var(--color-text-muted)')
    expect(lines('open')?.[0]).toBe('Open 5 of 19')
    expect(sectionCount('status')).toBe('5 open')
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
    expect(section('status')!.querySelector('button[data-testid="glance-section-count"]')).toBeNull()
  })

  it('a tile opens its tasks in dialog order, saying what it counts', () => {
    const onDrill = vi.fn()
    setup([num('urgent'), num('followupDue'), num('closedThisWeek')], onDrill)
    fireEvent.click(tile('urgent'))
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({
      title: 'Urgent',
      description: 'Open tasks where Priority Urgent.',
      // Overdue first, then by due date, ties by sortOrder (as the v77 metric's).
      source: { kind: 'todos', todoIds: [5, 6, 1, 2, 3, 7, 12, 13] },
    })
    // A follow-up filter: by next follow-up.
    fireEvent.click(tile('followupDue'))
    const followups = onDrill.mock.lastCall?.[0].source.todoIds as number[]
    const at = (id: number) => SAMPLE_TASKS.find((t) => t.id === id)!.nextFollowupAt!.getTime()
    expect(followups.map(at)).toEqual(followups.map(at).sort((a, b) => a - b))
    // One letting completed tasks through: the newest completion first.
    fireEvent.click(tile('closedThisWeek'))
    const closed = onDrill.mock.lastCall?.[0].source.todoIds as number[]
    const done = (id: number) => SAMPLE_TASKS.find((t) => t.id === id)!.completedAt!.getTime()
    expect(closed.length).toBeGreaterThan(1)
    expect(closed.map(done)).toEqual(closed.map(done).sort((a, b) => b - a))
  })

  it('a chart count opens its tasks: Status under headings', () => {
    const onDrill = vi.fn()
    setup(defaults(), onDrill)
    fireEvent.click(within(section('status')!).getByTestId('glance-section-count'))
    const st = onDrill.mock.lastCall?.[0]
    expect(st.title).toBe('Status')
    expect(st.source.groups.map((g: Group) => [g.label, g.todoIds.length])).toEqual([['To do', 11], ['In progress', 5], ['Waiting', 2], ['Blocked', 1]])
  })

  it('a status row opens its tasks', () => {
    const onDrill = vi.fn()
    setup(defaults(), onDrill)
    fireEvent.click(bdRows('status').find((r) => r.dataset.breakdownRow === 'status-3')!)
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'Status · Waiting', description: 'Status: the tasks with the status Waiting.', source: { kind: 'todos', todoIds: [9, 10] } })
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

  it('a person row opens that person’s tasks, offering their check-in; Unassigned too', () => {
    const onDrill = vi.fn()
    setup(defaults(), onDrill)
    const priyaId = PEOPLE.find((p) => p.name === 'Priya Nair')!.id
    fireEvent.click(bdRows('people').find((r) => r.dataset.breakdownRow === `person-${priyaId}`)!)
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({
      title: 'People · Priya Nair', glyph: 'people', description: 'People: the tasks assigned to Priya Nair.',
      personId: priyaId,
    })
    expect(sortedIds(onDrill.mock.lastCall?.[0])).toEqual([3, 11, 14, 15])
    fireEvent.click(bdRows('people').at(-1)!)
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'People · Unassigned', description: 'People: the tasks unassigned.' })
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

describe('glance widgets — Tags (a Breakdown)', () => {
  const tagRows = () => bdRows('tags')

  it('Tags: open tasks per tag, No tags last (can be hidden), the count of tasks it counts', () => {
    setup([bd('tags')])
    expect(sectionCount('tags')).toBe('19 open')
    expect(tagRows().map((r) => [r.dataset.breakdownRow, r.querySelector('[data-testid="breakdown-figure"]')?.textContent]).sort())
      .toEqual([['none', '10'], ['tag-1', '5'], ['tag-2', '1'], ['tag-3', '1'], ['tag-4', '2']])
    expect(tagRows().at(-1)?.dataset.breakdownRow).toBe('none')
    cleanup()
    setup([bd('tags', { showNone: false })])
    expect(tagRows().map((r) => r.dataset.breakdownRow)).not.toContain('none')
  })

  it('under the top-bar filter only the picked tag is left, and so in its lines for Copy', () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, tags: new Set([Q4]) } }))
    setup([num('open'), bd('tags')])
    expect(sectionCount('tags')).toBe('5 open')
    expect(tagRows().map((r) => r.dataset.breakdownRow)).toEqual(['tag-1'])
    expect(lines('open')?.[0]).toBe('Open 5 of 19')
    expect(lines('tags')).toEqual(['Tags 5 open', '#q4 5'])
  })

  it('its rows open the tasks behind them', () => {
    const onDrill = vi.fn()
    setup([bd('tags')], onDrill)
    fireEvent.click(tagRows().find((r) => r.dataset.breakdownRow === 'tag-1')!)
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'Tags · #q4', glyph: 'tag', description: 'Tags: the tasks tagged #q4.' })
    expect(sortedIds(onDrill.mock.lastCall?.[0])).toEqual([4, 7, 14, 15, 17])
    fireEvent.click(tagRows().at(-1)!)
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'Tags · No tags' })
    expect(sortedIds(onDrill.mock.lastCall?.[0])).toEqual([1, 2, 5, 8, 9, 10, 11, 12, 16, 19])
  })
})
