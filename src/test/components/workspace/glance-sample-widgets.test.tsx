import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act, within, fireEvent } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { GlanceWidget } from '../../../components/workspace/glance/GlanceWidget'
import type { GlanceResult } from '../../../components/workspace/glance/glance-hooks'
import type { GlanceDrill } from '../../../components/workspace/glance/glance-types'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import type { V77NumberMetric } from '../../../data/upgrades/v78/number-metrics'
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
const DEFAULT_TILES: V77NumberMetric[] = ['open', 'focus', 'urgent', 'overdue', 'followupDue']
/** A new Dashboard's parts, as widgets: its tiles and its sections still kept (D26 retired Needs follow-up and Next 7 days). */
const defaults = (): GlanceTab[] => [...DEFAULT_TILES.map(num), of('trend'), of('status'), of('people')]

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
const section = (id: string) => document.querySelector<HTMLElement>(`[data-glance-section="${id}"]`)
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
    expect(ids).toEqual(['trend', 'status', 'people'])
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
    // At 0 a tile goes neutral, its count muted.
    expect(tile('overdue').dataset.lit).toBeUndefined()
    expect(tile('overdue').querySelector<HTMLElement>('[data-testid="number-count"]')!.style.color).toBe('var(--color-text-muted)')
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
    expect(section('status')!.querySelector('button[data-testid="glance-section-count"]')).toBeNull()
    expect(section('people')!.querySelector('button[data-person-row]')).toBeNull()
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

  it('a panel count opens its tasks: Status under headings', () => {
    const onDrill = vi.fn()
    setup(defaults(), onDrill)
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

describe('glance widgets — Tags', () => {
  const tagRows = () => Array.from(section('tags')!.querySelectorAll<HTMLElement>('[data-tag-row]'))

  it('Tags: open tasks per tag by count then name, No tag last (can be hidden), the tagged count', () => {
    setup([of('tags')])
    expect(sectionCount('tags')).toBe('9 tagged')
    expect(tagRows().map((r) => [r.dataset.tagRow, r.querySelector('[class*="tagName"]')?.textContent, r.querySelector('[data-testid="glance-tag-open"]')?.textContent]))
      .toEqual([['1', '#q4', '5'], ['4', '#errands', '2'], ['3', '#home', '1'], ['2', '#planning', '1'], ['none', 'No tag', '10']])
    cleanup()
    setup([of('tags', { showUntagged: false })])
    expect(tagRows().map((r) => r.dataset.tagRow)).toEqual(['1', '4', '3', '2'])
  })

  it('under the top-bar filter its counts read shown of total, and so do its lines for Copy', () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, tags: new Set([Q4]) } }))
    setup([num('open'), of('tags')])
    expect(sectionCount('tags')).toBe('5 of 9 tagged')
    expect(tagRows().map((r) => r.dataset.tagRow)).toEqual(['1'])
    expect(lines('open')?.[0]).toBe('Open 5 of 19')
    expect(lines('tags')).toEqual(['Tags 5 of 9 tagged', '#q4 5'])
  })

  it('its numbers open the tasks behind them', () => {
    const onDrill = vi.fn()
    setup([of('tags')], onDrill)
    fireEvent.click(tagRows()[0]!)
    expect(onDrill.mock.lastCall?.[0]).toEqual({ title: '#q4', glyph: 'tag', description: 'Open tasks tagged #q4.', source: { kind: 'todos', todoIds: [4, 7, 14, 15, 17] } })
    fireEvent.click(tagRows().at(-1)!)
    expect(onDrill.mock.lastCall?.[0]).toMatchObject({ title: 'No tag', source: { kind: 'todos', todoIds: [1, 2, 5, 8, 9, 10, 11, 12, 16, 19] } })
    fireEvent.click(within(section('tags')!).getByTestId('glance-section-count'))
    const tags = onDrill.mock.lastCall?.[0]
    expect(tags.title).toBe('Tagged tasks')
    expect(tags.source.groups.map((g: { label: string; todoIds: number[] }) => [g.label, g.todoIds.length])).toEqual([['#q4', 5], ['#errands', 2], ['#home', 1], ['#planning', 1]])
  })
})
