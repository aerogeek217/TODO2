import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, cleanup, fireEvent, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { GlanceWidget } from '../../../components/workspace/glance/GlanceWidget'
import type { GlanceResult } from '../../../components/workspace/glance/glance-hooks'
import { glanceMenu } from '../../../components/workspace/glance/glance-menu'
import type { GlanceDrill } from '../../../components/workspace/glance/glance-types'
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
import { numberTab } from '../../helpers/layout-builders'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import type { WidgetFace } from '../../../utils/widget-face'
import {
  ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, Q4, SAMPLE_EVENTS, SAMPLE_LISTS, SAMPLE_TASKS, SAMPLE_TODAY, STATUSES, TAGS,
} from '../../fixtures/glance-sample'

let lastResult: GlanceResult | null = null

function setup(tab: GlanceTab, onDrill?: (d: GlanceDrill) => void, face?: WidgetFace) {
  return render(
    <DndContext>
      <WidgetFaceContext.Provider value={face ? { forced: face } : {}}>
        <GlanceWidget tab={tab} onResult={(r) => { lastResult = r }} onDrill={onDrill} />
      </WidgetFaceContext.Provider>
    </DndContext>,
  )
}

const number = () => document.querySelector<HTMLElement>('[data-number]')!
const numberCount = () => within(number()).getByTestId('number-count').textContent

const GLANCE_KINDS = WIDGET_KINDS.filter(isGlanceKind) as GlanceWidgetKind[]

/** The section id each section kind renders. */
const SECTION_OF: Partial<Record<GlanceWidgetKind, string>> = {
  trend: 'trend', status: 'status', people: 'people', tags: 'tags',
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
  it('a new Number counts every open task, never lit, with its 14 days and the change since yesterday', () => {
    setup(createTab('number', 'n'))
    expect(number().dataset.number).toBe('n')
    expect(numberCount()).toBe('19')
    expect(number().dataset.lit).toBeUndefined()
    expect(number().textContent).toContain('Open')
    expect(number().querySelector('[data-sparkline] polyline')).not.toBeNull()
    expect(within(number()).getByTestId('number-delta').textContent).toMatch(/vs yesterday$/)
    // State alone: the line is exact.
    expect(within(number()).queryByTestId('number-approximate')).toBeNull()
  })

  it('Overdue (converted): lit above 0 in its colour', () => {
    setup(numberTab('n', 'overdue'))
    expect(numberCount()).toBe('2')
    expect(number().dataset.lit).toBe('true')
    expect(within(number()).getByTestId('number-count').style.color).toBe('rgb(232, 107, 240)')
    expect(number().textContent).toContain('Overdue')
  })

  it('lit above / below a threshold; Auto lights in the accent', () => {
    setup(numberTab('n', 'open', { litWhen: 'above', litAt: 18 }))
    expect(number().dataset.lit).toBe('true')
    expect(within(number()).getByTestId('number-count').style.color).toBe('var(--color-accent)')
    cleanup()
    setup(numberTab('n', 'open', { litWhen: 'above', litAt: 19 }))
    expect(number().dataset.lit).toBeUndefined()
    cleanup()
    setup(numberTab('n', 'open', { litWhen: 'below', litAt: 20 }))
    expect(number().dataset.lit).toBe('true')
  })

  it('compares with the same point of last week, or with nothing', () => {
    setup(numberTab('n', 'closedThisWeek'), undefined, 'medium')
    expect(within(number()).getByTestId('number-delta').textContent).toMatch(/vs last Sat$/)
    expect(number().getAttribute('aria-label')).toMatch(/vs last Sat\.$/)
    cleanup()
    setup(numberTab('n', 'open', { compare: 'none' }), undefined, 'medium')
    expect(number().querySelector('[data-sparkline]')).not.toBeNull()
    expect(within(number()).queryByTestId('number-delta')).toBeNull()
  })

  it('a filter reading what the log didn’t hold for the whole line is marked ≈', () => {
    setup(numberTab('n', 'focus'))
    expect(numberCount()).toBe('3')
    expect(number().dataset.lit).toBeUndefined()
    expect(within(number()).getByTestId('number-count').style.color).toBe('var(--color-text-primary)')
    expect(number().querySelector('[data-sparkline]')).not.toBeNull()
    expect(within(number()).getByTestId('number-approximate').getAttribute('title')).toMatch(/priorities/)
    // Once the log covers the whole line, it is exact.
    cleanup()
    useSettingsStore.setState({ historyLogSince: new Date(2026, 8, 1) })
    setup(numberTab('n', 'focus'))
    expect(within(number()).queryByTestId('number-approximate')).toBeNull()
  })

  it('a click opens its tasks in the task dialog, titled by its name and saying what it counts', () => {
    const onDrill = vi.fn()
    setup(numberTab('n', 'overdue', { name: 'Late' }), onDrill)
    fireEvent.click(number())
    expect(onDrill).toHaveBeenCalledTimes(1)
    const drill = onDrill.mock.calls[0]![0] as GlanceDrill
    expect(drill.title).toBe('Late')
    expect(drill.description).toBe('Open tasks where Due before today.')
    if (drill.source.kind !== 'todos') throw new Error('a Number opens its tasks')
    expect(drill.source.todoIds).toHaveLength(2)
  })

  it('without a host to open tasks it is a plain group, not a button', () => {
    setup(numberTab('n', 'overdue'))
    expect(number().tagName).toBe('DIV')
    expect(number().getAttribute('aria-label')).toMatch(/^Overdue: 2\./)
  })

  it('a blank name reads Number', () => {
    setup(numberTab('n', 'open', { name: ' ' }))
    expect(number().getAttribute('aria-label')).toMatch(/^Number: 19\./)
  })

  it('under the screen filter: shown of total, and the dialog says so', () => {
    useFilterStore.setState((s) => ({ filters: { ...s.filters, tags: new Set([Q4]) } }))
    const onDrill = vi.fn()
    setup(numberTab('n'), onDrill)
    expect(numberCount()).toMatch(/^\d+of 19$/)
    fireEvent.click(number())
    expect((onDrill.mock.calls[0]![0] as GlanceDrill).description).toMatch(/Only tasks the top-bar filter shows\.$/)
  })

  it('the top bar’s lens narrows it unless it ignores the lens, as a list can', () => {
    const lens = { id: 'lens-q4', name: 'Q4', predicate: { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: [Q4] } }
    useSettingsStore.setState({ lenses: [lens], activeLensId: lens.id })
    const onDrill = vi.fn()
    setup(numberTab('n'), onDrill)
    expect(numberCount()).toMatch(/^\d+of 19$/)
    cleanup()
    setup(numberTab('n', 'open', { ignoreLens: true }), onDrill)
    expect(numberCount()).toBe('19')
    fireEvent.click(number())
    // Nothing narrows it: the dialog doesn't say the top bar's filter does.
    expect((onDrill.mock.calls[0]![0] as GlanceDrill).description).toBe('Every open task.')
  })

  it('reports its lines for Copy: its name and count, then its change', () => {
    setup(numberTab('n', 'overdue'))
    expect(lastResult?.summary.plain).toMatch(/^Overdue 2\n([+−]\d+|No change) vs yesterday$/)
  })

  it('Edit number… opens its editor beside it', () => {
    setup(numberTab('n', 'overdue'))
    expect(document.querySelector('[data-number-editor]')).toBeNull()
    act(() => { useUIStore.getState().openNumberEditor('n') })
    expect(document.querySelector('[data-number-editor="n"]')).not.toBeNull()
  })
})

describe('section widgets', () => {
  it.each(Object.entries(SECTION_OF))('%s renders its section, header included, filling its cell', (kind, sectionId) => {
    setup(createTab(kind as GlanceWidgetKind, 'w') as GlanceTab)
    const root = document.querySelector<HTMLElement>(`[data-glance="${kind}"]`)!
    expect(root).not.toBeNull()
    const section = root.querySelector<HTMLElement>(`[data-glance-section="${sectionId}"]`)!
    expect(section).not.toBeNull()
    expect(section.querySelector('[class*="panelHeader"]')).not.toBeNull()
    expect(lastResult?.summary.plain.length).toBeGreaterThan(0)
  })

  it('no glance widget is a selection scope (none shows task rows)', () => {
    for (const kind of GLANCE_KINDS) {
      const { unmount } = setup(createTab(kind, `w-${kind}`) as GlanceTab)
      const root = document.querySelector<HTMLElement>(`[data-glance="${kind}"]`)!
      expect(root.hasAttribute('data-selection-scope')).toBe(false)
      unmount()
    }
  })

  it('People and Tags narrow by the top bar’s @ / # picks, as a list grouped by them does', () => {
    const [dana, alice] = [PEOPLE.find((p) => p.id === 1)!, PEOPLE.find((p) => p.id === 5)!]
    const [q4, home] = [TAGS.find((t) => t.id === 1)!, TAGS.find((t) => t.id === 3)!]
    // "Sign off on new logo" is Alice's and Dana's; "Budget review" is #q4 and #home.
    usePersonStore.setState({ assignedPeopleMap: new Map([...ASSIGNED_PEOPLE, [8, [alice, dana]]]) })
    useTagStore.setState({ assignedTagsMap: new Map([...ASSIGNED_TAGS, [7, [q4, home]]]) })
    const rows = (attr: string) => [...document.querySelectorAll(`[${attr}]`)].map((el) => el.getAttribute(attr))
    setup({ id: 'w', kind: 'people', config: { showUnassigned: true } })
    expect(rows('data-person-row')).toContain('1')
    cleanup()
    useFilterStore.getState().setAllFilters({ ...useFilterStore.getState().filters, personIds: new Set([5]) })
    setup({ id: 'w', kind: 'people', config: { showUnassigned: true } })
    expect(rows('data-person-row')).toEqual(['5'])
    cleanup()
    useFilterStore.getState().setAllFilters({ ...useFilterStore.getState().filters, personIds: null, tags: new Set([1]) })
    setup({ id: 'w', kind: 'tags', config: { showUntagged: true } })
    expect(rows('data-tag-row')).toEqual(['1'])
  })

  it('options come from the config: range, the Unassigned and No tag rows', () => {
    setup({ id: 'w', kind: 'trend', config: { range: '4w' } })
    expect(document.querySelector('[data-glance-section="trend"]')!.textContent).toContain('Last 4 weeks')
    cleanup()
    setup({ id: 'w', kind: 'people', config: { showUnassigned: false } })
    expect(document.querySelector('[data-person-row="none"]')).toBeNull()
    cleanup()
    setup({ id: 'w', kind: 'people', config: { showUnassigned: true } })
    expect(document.querySelector('[data-person-row="none"]')).not.toBeNull()
    cleanup()
    setup({ id: 'w', kind: 'tags', config: { showUntagged: false } })
    expect(document.querySelector('[data-tag-row="none"]')).toBeNull()
  })

  it('a section’s count opens its tasks', () => {
    const onDrill = vi.fn()
    setup(createTab('status', 's'), onDrill)
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-glance-section="status"]')!).getByTestId('glance-section-count'))
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
    ['number', 'Breakdown', 'By tag', { breakdown: 'tags' }],
    ['trend', 'Range', '12 weeks', { range: '12w' }],
    ['people', 'Unassigned', 'Hidden', { showUnassigned: false }],
    ['tags', 'No tag', 'Hidden', { showUntagged: false }],
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

  it('a Number’s menu opens its editor: Edit number…', () => {
    const entry = item(glanceMenu(createTab('number', 'n'), undefined)!.settingEntries, 'Edit number…')
    entry.onSelect!()
    expect(useUIStore.getState().numberEditorTabId).toBe('n')
  })

  it('picking the current value changes nothing; Copy is offered once the widget has reported its lines', () => {
    const patchTabConfig = vi.fn()
    useWorkspaceStore.setState({ patchTabConfig })
    const tab = createTab('number', 'n')
    choose(glanceMenu(tab, undefined)!.settingEntries, 'Breakdown', 'None')
    expect(patchTabConfig).not.toHaveBeenCalled()
    expect(glanceMenu(tab, undefined)!.actions).toEqual([])
    expect(glanceMenu(tab, { plain: 'Overdue 2', html: '<p>x</p>' })!.actions.map((a) => a.label)).toEqual(['Copy'])
    // The kinds without a setting have none.
    expect(glanceMenu(createTab('status', 's'), undefined)!.settingEntries).toEqual([])
    expect(glanceMenu(undefined, undefined)).toBeUndefined()
  })
})

describe('faces (D25 R)', () => {
  // The section widgets' faces; the Number and Project pulse (pulse-widget.test) draw their own.
  const SECTION_FACE_KINDS = GLANCE_KINDS.filter((k) => k !== 'number' && k !== 'pulse')
  const smallFace = () => document.querySelector<HTMLElement>('[data-testid="glance-small-face"]')
  const smallValue = () => within(smallFace()!).getByTestId('glance-small-value').textContent

  it('a small Number is its label and count: no 14-day line', () => {
    setup(numberTab('n', 'overdue'), undefined, 'small')
    expect(numberCount()).toBe('2')
    expect(number().textContent).toContain('Overdue')
    expect(number().querySelector('[data-sparkline]')).toBeNull()
    expect(within(number()).queryByTestId('number-delta')).toBeNull()
    expect(document.querySelector('[data-glance]')!.getAttribute('data-face')).toBe('small')
  })

  it('a medium Number adds its line, but no breakdown', () => {
    setup(numberTab('n', 'open', { breakdown: 'people' }), undefined, 'medium')
    expect(number().querySelector('[data-sparkline]')).not.toBeNull()
    expect(document.querySelector('[data-testid="number-breakdown"]')).toBeNull()
  })

  it('a large Number breaks its tasks down by the config’s pick, most first, Unassigned last; a line opens its tasks', () => {
    const onDrill = vi.fn()
    setup(numberTab('n', 'open', { breakdown: 'people' }), onDrill, 'large')
    const rows = [...document.querySelectorAll<HTMLElement>('[data-breakdown]')]
    expect(rows.length).toBeGreaterThan(1)
    const count = (r: HTMLElement) => Number(r.lastElementChild!.textContent)
    const named = rows.filter((r) => r.dataset.breakdown !== 'none').map(count)
    expect(named).toEqual([...named].sort((a, b) => b - a))
    expect(rows.findIndex((r) => r.dataset.breakdown === 'none')).toBeOneOf([-1, rows.length - 1])
    fireEvent.click(rows[0]!)
    const drill = onDrill.mock.calls[0]![0] as GlanceDrill
    expect(drill.title).toMatch(/^Open · /)
    if (drill.source.kind !== 'todos') throw new Error('a line opens its tasks')
    expect(drill.source.todoIds).toHaveLength(count(rows[0]!))
  })

  it('a large Number with no breakdown (absent or none) draws none', () => {
    setup(numberTab('n'), undefined, 'large')
    expect(document.querySelector('[data-testid="number-breakdown"]')).toBeNull()
    cleanup()
    setup(numberTab('n', 'open', { breakdown: 'none' }), undefined, 'large')
    expect(document.querySelector('[data-testid="number-breakdown"]')).toBeNull()
  })

  it('a small Number’s own click drills and marks the click handled (not the cell’s popover)', () => {
    const onDrill = vi.fn()
    setup(numberTab('n', 'overdue'), onDrill, 'small')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    number().dispatchEvent(click)
    expect(onDrill).toHaveBeenCalledTimes(1)
    expect(click.defaultPrevented).toBe(true)
  })

  it.each(SECTION_FACE_KINDS)('a small %s is its title and headline number, not its section', (kind) => {
    setup(createTab(kind, 'w') as GlanceTab, undefined, 'small')
    expect(smallFace()).not.toBeNull()
    expect(document.querySelector('[data-glance-section]')).toBeNull()
    expect(smallValue()).toMatch(/^[+−]?\d+( of \d+)?$|^–$/)
  })

  it.each(SECTION_FACE_KINDS)('a medium %s is its section as today', (kind) => {
    setup(createTab(kind, 'w') as GlanceTab, undefined, 'medium')
    expect(smallFace()).toBeNull()
    expect(document.querySelector(`[data-glance-section="${SECTION_OF[kind]}"]`)).not.toBeNull()
  })

  it('the headlines: the top person, the net', () => {
    const headline = (kind: GlanceWidgetKind) => {
      setup(createTab(kind, 'w') as GlanceTab, undefined, 'small')
      const out = { value: smallValue(), label: smallFace()!.getAttribute('aria-label') }
      cleanup()
      return out
    }
    const large = <T,>(kind: GlanceWidgetKind, read: (section: HTMLElement) => T): T => {
      setup(createTab(kind, 'w') as GlanceTab, vi.fn(), 'large')
      const out = read(document.querySelector<HTMLElement>('[data-glance-section]')!)
      cleanup()
      return out
    }
    const topPerson = large('people', (el) => el.querySelector('[data-person-row]')!.getAttribute('aria-label')!.match(/^(.+): (\d+) open/)!)
    expect(headline('people').label).toBe(`People: ${topPerson[1]}: ${topPerson[2]} open`)
    expect(headline('trend').label).toMatch(/^Created vs completed: [+−]?\d+ net · 14 days$/)
  })
})
