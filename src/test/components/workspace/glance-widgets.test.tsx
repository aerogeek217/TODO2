import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, within, act } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { GlanceWidget } from '../../../components/workspace/glance/GlanceWidget'
import type { GlanceResult } from '../../../components/workspace/glance/glance-hooks'
import { glanceMenu } from '../../../components/workspace/glance/glance-menu'
import type { DashboardDrill } from '../../../components/workspace/glance/glance-types'
import type { MenuEntry, MenuItemEntry } from '../../../components/shared/MenuPopover'
import { createTab, isGlanceKind, WIDGET_KINDS, type GlanceTab, type GlanceWidgetKind } from '../../../models/workspace-layout'
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
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { clearFilterStore, resetEntityStores } from '../../helpers'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import type { WidgetFace } from '../../../utils/widget-face'
import {
  ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, Q4, SAMPLE_EVENTS, SAMPLE_LISTS, SAMPLE_TASKS, SAMPLE_TODAY, STATUSES, TAGS,
} from '../../fixtures/dashboard-sample'

let lastResult: GlanceResult | null = null

function setup(tab: GlanceTab, onDrill?: (d: DashboardDrill) => void, face?: WidgetFace) {
  return render(
    <DndContext>
      <WidgetFaceContext.Provider value={face ? { forced: face } : {}}>
        <GlanceWidget tab={tab} onResult={(r) => { lastResult = r }} onDrill={onDrill} />
      </WidgetFaceContext.Provider>
    </DndContext>,
  )
}

const number = () => document.querySelector<HTMLElement>('[data-number-metric]')!
const numberCount = () => within(number()).getByTestId('number-count').textContent

const GLANCE_KINDS = WIDGET_KINDS.filter(isGlanceKind) as GlanceWidgetKind[]

/** The section id each section kind renders. */
const SECTION_OF: Partial<Record<GlanceWidgetKind, string>> = {
  followup: 'followup', next7: 'next7', trend: 'trend', status: 'status', people: 'people',
  tags: 'tags', stale: 'stale', recent: 'recent', eisenhowerSummary: 'eisenhower',
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 10, 10))
  lastResult = null
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

describe('Number widget', () => {
  it('a new Number counts Overdue, lit: label, count, sub-line, its 14 days and the change since yesterday', () => {
    setup(createTab('number', 'n'))
    expect(number().dataset.numberMetric).toBe('overdue')
    expect(numberCount()).toBe('2')
    expect(number().dataset.lit).toBe('true')
    expect(within(number()).getByTestId('number-count').style.color).toBe('var(--color-overdue)')
    expect(number().textContent).toContain('Overdue')
    expect(number().textContent).toContain('Oldest Wed 7 · 3d late')
    expect(number().querySelector('[data-sparkline] polyline')).not.toBeNull()
    expect(within(number()).getByTestId('number-delta').textContent).toMatch(/vs yesterday$/)
  })

  it('a count that asks for nothing stays neutral; metrics without a log have no line', () => {
    setup({ id: 'n', kind: 'number', config: { metric: 'focus' } })
    expect(numberCount()).toBe('3')
    expect(number().dataset.lit).toBeUndefined()
    expect(within(number()).getByTestId('number-count').style.color).toBe('var(--color-text-primary)')
    expect(number().querySelector('[data-sparkline]')).toBeNull()
    expect(within(number()).queryByTestId('number-delta')).toBeNull()
  })

  it('Open reads its trend sub-line from the history', () => {
    setup({ id: 'n', kind: 'number', config: { metric: 'open' } })
    expect(numberCount()).toBe('19')
    expect(number().textContent).toContain('+3 in the last 14 days')
    expect(number().querySelector('[data-sparkline]')).not.toBeNull()
  })

  it('a click opens the tile’s tasks in the task dialog', () => {
    const onDrill = vi.fn()
    setup(createTab('number', 'n'), onDrill)
    fireEvent.click(number())
    expect(onDrill).toHaveBeenCalledTimes(1)
    const drill = onDrill.mock.calls[0]![0] as DashboardDrill
    expect(drill.title).toBe('Overdue tasks')
    if (drill.source.kind !== 'todos') throw new Error('a tile opens its tasks')
    expect(drill.source.todoIds).toHaveLength(2)
  })

  it('without a host to open tasks it is a plain group, not a button', () => {
    setup(createTab('number', 'n'))
    expect(number().tagName).toBe('DIV')
    expect(number().getAttribute('aria-label')).toMatch(/^Overdue: 2\./)
  })

  it('Closed this week: completions since the week began, never lit; its drill says since when', () => {
    const onDrill = vi.fn()
    setup({ id: 'n', kind: 'number', config: { metric: 'closedThisWeek' } }, onDrill)
    expect(number().textContent).toContain('Closed this week')
    expect(number().textContent).toContain('Since Sun 4')
    expect(number().dataset.lit).toBeUndefined()
    fireEvent.click(number())
    expect((onDrill.mock.calls[0]![0] as DashboardDrill).description).toBe('Tasks completed since Sun 4.')
  })

  it('under the screen filter: shown of total, and the dialog says so', () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, tags: new Set([Q4]) } }))
    const onDrill = vi.fn()
    setup({ id: 'n', kind: 'number', config: { metric: 'open' } }, onDrill)
    expect(numberCount()).toMatch(/^\d+of 19$/)
    fireEvent.click(number())
    expect((onDrill.mock.calls[0]![0] as DashboardDrill).description).toMatch(/Only tasks the top-bar filter shows\.$/)
  })

  it('reports its lines for Copy', () => {
    setup(createTab('number', 'n'))
    expect(lastResult?.summary.plain).toBe('Overdue 2\nOldest Wed 7 · 3d late')
  })
})

describe('section widgets', () => {
  it.each(Object.entries(SECTION_OF))('%s renders its section, header included, filling its cell', (kind, sectionId) => {
    setup(createTab(kind as GlanceWidgetKind, 'w') as GlanceTab)
    const root = document.querySelector<HTMLElement>(`[data-glance="${kind}"]`)!
    expect(root).not.toBeNull()
    const section = root.querySelector<HTMLElement>(`[data-dash-section="${sectionId}"]`)!
    expect(section).not.toBeNull()
    expect(section.querySelector('[class*="panelHeader"]')).not.toBeNull()
    expect(lastResult?.summary.plain.length).toBeGreaterThan(0)
  })

  it('the row widgets are each their own selection scope; the others are none', () => {
    for (const kind of GLANCE_KINDS) {
      const { unmount } = setup(createTab(kind, `w-${kind}`) as GlanceTab)
      const root = document.querySelector<HTMLElement>(`[data-glance="${kind}"]`)!
      expect(root.hasAttribute('data-selection-scope')).toBe(['followup', 'stale', 'recent'].includes(kind))
      unmount()
    }
  })

  it('Needs follow-up: its rows select in its own scope, two show the bulk bar', () => {
    setup(createTab('followup', 'fu'))
    const rows = document.querySelectorAll<HTMLElement>('[data-glance="followup"] [data-row-key]')
    expect(rows.length).toBeGreaterThan(1)
    const title = (row: HTMLElement) => row.querySelector('[data-todo-id] span[data-task-title]')!
    act(() => { fireEvent.click(title(rows[0]!)) })
    act(() => { fireEvent.click(title(rows[1]!), { ctrlKey: true }) })
    expect(useUIStore.getState().selectionScope).toBe('fu')
    expect(useUIStore.getState().selectedTodoIds.size).toBe(2)
    expect(document.querySelector('[data-glance="followup"] [role="toolbar"]')).not.toBeNull()
  })

  it('options come from the config: look ahead, range, the Unassigned and No tag rows, the day spans', () => {
    setup({ id: 'w', kind: 'followup', config: { lookAhead: 3 } })
    expect(document.querySelector('[data-dash-section="followup"]')!.textContent).toContain('Late, today and the next 3 days')
    cleanup()
    setup({ id: 'w', kind: 'trend', config: { range: '4w' } })
    expect(document.querySelector('[data-dash-section="trend"]')!.textContent).toContain('Last 4 weeks')
    cleanup()
    setup({ id: 'w', kind: 'people', config: { showUnassigned: false } })
    expect(document.querySelector('[data-person-row="none"]')).toBeNull()
    cleanup()
    setup({ id: 'w', kind: 'people', config: { showUnassigned: true } })
    expect(document.querySelector('[data-person-row="none"]')).not.toBeNull()
    cleanup()
    setup({ id: 'w', kind: 'stale', config: { staleDays: 30 } })
    expect(document.querySelector('[data-dash-section="stale"]')!.textContent).toContain('Not changed in 30 days or more')
    cleanup()
    setup({ id: 'w', kind: 'recent', config: { recentDays: 14 } })
    expect(document.querySelector('[data-dash-section="recent"]')!.textContent).toContain('Last 14 days')
  })

  it('a section’s count opens its tasks', () => {
    const onDrill = vi.fn()
    setup(createTab('stale', 's'), onDrill)
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-dash-section="stale"]')!).getByTestId('dash-section-count'))
    expect(onDrill).toHaveBeenCalledTimes(1)
  })
})

describe('glance tab menus', () => {
  const item = (entries: readonly MenuEntry[], label: string) => entries.find((e): e is MenuItemEntry => e.kind === 'item' && e.label === label)!
  const choose = (entries: readonly MenuEntry[], label: string, choice: string) => {
    const children = item(entries, label).children!
    item(children, choice).onSelect!()
  }

  it.each([
    ['number', 'Metric', 'Closed this week', { metric: 'closedThisWeek' }],
    ['number', 'Breakdown', 'By tag', { breakdown: 'tags' }],
    ['followup', 'Look ahead', '14 days', { lookAhead: 14 }],
    ['trend', 'Range', '12 weeks', { range: '12w' }],
    ['people', 'Unassigned', 'Hidden', { showUnassigned: false }],
    ['tags', 'No tag', 'Hidden', { showUntagged: false }],
    ['stale', 'Older than', '60 days', { staleDays: 60 }],
    ['recent', 'Last', '30 days', { recentDays: 30 }],
  ] as const)('%s: %s › %s patches its config', (kind, label, choice, patch) => {
    const patchTabConfig = vi.fn()
    useWorkspaceStore.setState({ patchTabConfig })
    const tab = createTab(kind, 'w') as GlanceTab
    const menu = glanceMenu(tab, undefined)!
    // The current value is the item's note.
    expect(item(menu.settingEntries, label).note).toBeTruthy()
    choose(menu.settingEntries, label, choice)
    expect(patchTabConfig).toHaveBeenCalledWith('w', kind, patch)
  })

  it('picking the current value changes nothing; Copy is offered once the widget has reported its lines', () => {
    const patchTabConfig = vi.fn()
    useWorkspaceStore.setState({ patchTabConfig })
    const tab = createTab('number', 'n')
    choose(glanceMenu(tab, undefined)!.settingEntries, 'Metric', 'Overdue')
    expect(patchTabConfig).not.toHaveBeenCalled()
    expect(glanceMenu(tab, undefined)!.actions).toEqual([])
    expect(glanceMenu(tab, { plain: 'Overdue 2', html: '<p>x</p>' })!.actions.map((a) => a.label)).toEqual(['Copy'])
    // The kinds without a setting have none; the Eisenhower summary links to its panes.
    expect(glanceMenu(createTab('status', 's'), undefined)!.settingEntries).toEqual([])
    expect(glanceMenu(createTab('eisenhowerSummary', 'e'), undefined)!.settingEntries.map((e) => (e as MenuItemEntry).label)).toEqual(['Customize panes…'])
    expect(glanceMenu(undefined, undefined)).toBeUndefined()
  })
})

describe('faces (D25 R)', () => {
  const smallFace = () => document.querySelector<HTMLElement>('[data-testid="glance-small-face"]')
  const smallValue = () => within(smallFace()!).getByTestId('glance-small-value').textContent

  it('a small Number is its label and count: no sub-line, no 14-day line', () => {
    setup(createTab('number', 'n'), undefined, 'small')
    expect(numberCount()).toBe('2')
    expect(number().textContent).toContain('Overdue')
    expect(number().textContent).not.toContain('Oldest')
    expect(number().querySelector('[data-sparkline]')).toBeNull()
    expect(within(number()).queryByTestId('number-delta')).toBeNull()
    expect(document.querySelector('[data-glance]')!.getAttribute('data-face')).toBe('small')
  })

  it('a medium Number adds its sub-line and its line, but no breakdown', () => {
    setup({ id: 'n', kind: 'number', config: { metric: 'open', breakdown: 'people' } }, undefined, 'medium')
    expect(number().textContent).toContain('+3 in the last 14 days')
    expect(number().querySelector('[data-sparkline]')).not.toBeNull()
    expect(document.querySelector('[data-testid="number-breakdown"]')).toBeNull()
  })

  it('a large Number breaks its tasks down by the config’s pick, most first, Unassigned last; a line opens its tasks', () => {
    const onDrill = vi.fn()
    setup({ id: 'n', kind: 'number', config: { metric: 'open', breakdown: 'people' } }, onDrill, 'large')
    const rows = [...document.querySelectorAll<HTMLElement>('[data-breakdown]')]
    expect(rows.length).toBeGreaterThan(1)
    const count = (r: HTMLElement) => Number(r.lastElementChild!.textContent)
    const named = rows.filter((r) => r.dataset.breakdown !== 'none').map(count)
    expect(named).toEqual([...named].sort((a, b) => b - a))
    expect(rows.findIndex((r) => r.dataset.breakdown === 'none')).toBeOneOf([-1, rows.length - 1])
    fireEvent.click(rows[0]!)
    const drill = onDrill.mock.calls[0]![0] as DashboardDrill
    expect(drill.title).toMatch(/^Open tasks · /)
    if (drill.source.kind !== 'todos') throw new Error('a line opens its tasks')
    expect(drill.source.todoIds).toHaveLength(count(rows[0]!))
  })

  it('a large Number with no breakdown (absent or none) draws none', () => {
    setup({ id: 'n', kind: 'number', config: { metric: 'open' } }, undefined, 'large')
    expect(document.querySelector('[data-testid="number-breakdown"]')).toBeNull()
    cleanup()
    setup({ id: 'n', kind: 'number', config: { metric: 'open', breakdown: 'none' } }, undefined, 'large')
    expect(document.querySelector('[data-testid="number-breakdown"]')).toBeNull()
  })

  it('a small Number’s own click drills and marks the click handled (not the cell’s popover)', () => {
    const onDrill = vi.fn()
    setup(createTab('number', 'n'), onDrill, 'small')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    number().dispatchEvent(click)
    expect(onDrill).toHaveBeenCalledTimes(1)
    expect(click.defaultPrevented).toBe(true)
  })

  it.each(GLANCE_KINDS.filter((k) => k !== 'number'))('a small %s is its title and headline number, not its section', (kind) => {
    setup(createTab(kind, 'w') as GlanceTab, undefined, 'small')
    expect(smallFace()).not.toBeNull()
    expect(document.querySelector('[data-dash-section]')).toBeNull()
    expect(smallValue()).toMatch(/^[+−]?\d+( of \d+)?$|^–$/)
  })

  it.each(GLANCE_KINDS.filter((k) => k !== 'number'))('a medium %s is its section as today', (kind) => {
    setup(createTab(kind, 'w') as GlanceTab, undefined, 'medium')
    expect(smallFace()).toBeNull()
    expect(document.querySelector(`[data-dash-section="${SECTION_OF[kind]}"]`)).not.toBeNull()
  })

  it('the headlines: the late follow-ups, the Stale and Recently completed counts, the top person, the Do count, the net', () => {
    const headline = (kind: GlanceWidgetKind) => {
      setup(createTab(kind, 'w') as GlanceTab, undefined, 'small')
      const out = { value: smallValue(), label: smallFace()!.getAttribute('aria-label') }
      cleanup()
      return out
    }
    const large = <T,>(kind: GlanceWidgetKind, read: (section: HTMLElement) => T): T => {
      setup(createTab(kind, 'w') as GlanceTab, vi.fn(), 'large')
      const out = read(document.querySelector<HTMLElement>('[data-dash-section]')!)
      cleanup()
      return out
    }
    const late = large('followup', (el) => within(el).getByRole('group', { name: 'Late' }).querySelectorAll('[data-todo-id]').length)
    expect(headline('followup').value).toBe(String(late))
    expect(headline('stale').value).toBe(large('stale', (el) => within(el).getByTestId('dash-section-count').textContent))
    expect(headline('recent').value).toBe(large('recent', (el) => within(el).getByTestId('dash-section-count').textContent))
    const topPerson = large('people', (el) => el.querySelector('[data-person-row]')!.getAttribute('aria-label')!.match(/^(.+): (\d+) open/)!)
    expect(headline('people').label).toBe(`People: ${topPerson[1]}: ${topPerson[2]} open`)
    expect(headline('eisenhowerSummary').value).toBe(large('eisenhowerSummary', (el) => el.querySelector('[data-eis-cell="do"] [data-testid="dash-eis-count"]')!.textContent))
    expect(headline('trend').label).toMatch(/^Created vs completed: [+−]?\d+ net · 14 days$/)
  })

  it('a small row widget is no selection scope and draws no bulk bar (its full widget in the popover is)', () => {
    useUIStore.setState({ selectionScope: 'w', selectedTodoIds: new Set([1, 2]) })
    setup(createTab('followup', 'w') as GlanceTab, undefined, 'small')
    const root = document.querySelector<HTMLElement>('[data-glance]')!
    expect(root.hasAttribute('data-selection-scope')).toBe(false)
    expect(within(root).queryByRole('toolbar', { name: 'Selected tasks' })).toBeNull()
  })
})
