import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, cleanup, fireEvent, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { GlanceWidget } from '../../../components/workspace/glance/GlanceWidget'
import type { GlanceResult } from '../../../components/workspace/glance/glance-hooks'
import type { GlanceDrill } from '../../../components/workspace/glance/glance-types'
import { NumberEditorHost } from '../../../components/workspace/glance/NumberEditor'
import { glanceMenu } from '../../../components/workspace/glance/glance-menu'
import type { MenuEntry } from '../../../components/shared/MenuPopover'
import { emptyPredicate } from '../../../models/filter-predicate'
import type { NumberConfig } from '../../../models/glance-widgets'
import type { NumberTab, PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
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
import type { WidgetFace } from '../../../utils/widget-face'
import { clearFilterStore, resetEntityStores } from '../../helpers'
import { numberTab, single } from '../../helpers/layout-builders'
import {
  ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, SAMPLE_EVENTS, SAMPLE_LISTS, SAMPLE_TASKS, SAMPLE_TODAY, STATUSES, TAGS,
} from '../../fixtures/glance-sample'
import { layoutSteps } from '../../helpers/layout-steps'

/**
 * A Number's shapes (D26 P6): each shape's widget over the glance sample
 * (19 open tasks, 2 of them overdue, 2 waiting), and Edit number's fields
 * for the shape it shows.
 */

let lastResult: GlanceResult | null = null

function setup(tab: NumberTab, onDrill?: (d: GlanceDrill) => void, face: WidgetFace = 'medium') {
  return render(
    <DndContext>
      <WidgetFaceContext.Provider value={{ forced: face }}>
        <GlanceWidget tab={tab} onResult={(r) => { lastResult = r }} onDrill={onDrill} />
      </WidgetFaceContext.Provider>
    </DndContext>,
  )
}

const number = () => document.querySelector<HTMLElement>('[data-number]')!
const figure = () => within(number()).getByTestId('number-count').textContent
const shape = (patch: Partial<NumberConfig>, metric: Parameters<typeof numberTab>[1] = 'overdue') => numberTab('n', metric, { name: 'Late', ...patch })

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
  useTrendEventsStore.setState({
    entries: new Map([[trendEventsKey('history', SAMPLE_TODAY, 0), { events: SAMPLE_EVENTS, stale: false, loading: false }]]),
    generation: 0,
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Share of…', () => {
  it('its tasks as a share of every open task: a ring, the percent, N of M, its line', () => {
    setup(shape({ show: 'share', litWhen: 'never', litAt: undefined }))
    expect(number().dataset.show).toBe('share')
    expect(figure()).toBe('11%')
    expect(within(number()).getByTestId('number-share-of').textContent).toBe('2 of 19')
    expect(within(number()).getByTestId('number-ring')).not.toBeNull()
    expect(number().querySelector('[data-sparkline]')).not.toBeNull()
    expect(within(number()).getByTestId('number-delta').textContent).toMatch(/pts? vs yesterday$|^No change vs yesterday$/)
    expect(lastResult?.summary.plain).toBe('Late 11%\n2 of 19')
  })

  it('of a second filter; lit by its percent', () => {
    // Overdue among the Doing tasks: 0 of 5.
    setup(shape({ show: 'share', of: { ...emptyPredicate(), statusIds: [2] }, litWhen: 'above', litAt: 10 }))
    expect(within(number()).getByTestId('number-share-of').textContent).toBe('0 of 5')
    expect(figure()).toBe('0%')
    expect(number().dataset.lit).toBeUndefined()
    cleanup()
    setup(shape({ show: 'share', litWhen: 'above', litAt: 10 }))
    expect(number().dataset.lit).toBe('true')
  })

  it('its small face is its label and percent, its line and change beside it where they fit', () => {
    setup(shape({ show: 'share' }), undefined, 'small')
    expect(figure()).toBe('11%')
    expect(within(number()).queryByTestId('number-ring')).toBeNull()
    expect(within(number()).queryByTestId('number-share-of')).toBeNull()
    expect(number().querySelector('[data-sparkline]')).not.toBeNull()
    expect(number().textContent).toBe('Late11%No change vs yesterday')
  })

  it('a click opens the shared tasks', () => {
    const onDrill = vi.fn()
    setup(shape({ show: 'share' }), onDrill)
    fireEvent.click(number())
    const drill = onDrill.mock.calls[0]![0] as GlanceDrill
    expect(drill.title).toBe('Late')
    expect(drill.source).toMatchObject({ kind: 'todos' })
    expect((drill.source as unknown as { todoIds: number[] }).todoIds).toHaveLength(2)
    expect(drill.description).toMatch(/Out of: Every open task\.$/)
  })
})

describe('Oldest', () => {
  it('the stalest task’s age, its title, and N · median', () => {
    setup(shape({ show: 'oldest', oldestBy: 'created' }, 'open'))
    expect(number().dataset.show).toBe('oldest')
    // Created before the 14 days, on 1 Sep: 39 days on 10 Oct.
    expect(figure()).toBe('39')
    expect(number().textContent).toContain('days old')
    expect(['Offsite agenda', 'Clean up shared drive']).toContain(within(number()).getByTestId('number-oldest-title').textContent)
    expect(within(number()).getByTestId('number-oldest-foot').textContent).toMatch(/^19 · median \d+ days?$/)
  })

  it('lit by its age; by due date it reads days overdue; no tasks reads —', () => {
    setup(shape({ show: 'oldest', oldestBy: 'deadline', litWhen: 'above', litAt: 2 }))
    // The overdue ones are due 7 and 8 Oct.
    expect(figure()).toBe('3')
    expect(number().textContent).toContain('days overdue')
    expect(number().dataset.lit).toBe('true')
    cleanup()
    setup(shape({ show: 'oldest', oldestBy: 'created', filter: { ...emptyPredicate(), searchText: 'nothing matches this' } }))
    expect(figure()).toBe('—')
    expect(number().textContent).toContain('No tasks')
  })
})

describe('the colour otherwise (widget feedback 2D)', () => {
  it('a shape not lit by its own rule draws its name and figure in it; lit, in its colour when lit', () => {
    setup(shape({ show: 'goal', goal: { atLeast: 2 }, color: '#e86bf0', unlitColor: '#A78BFA' }))
    expect(number().dataset.lit).toBeUndefined()
    expect(within(number()).getByTestId('number-count').style.color).toBe('var(--hue-violet-text)')
    cleanup()
    setup(shape({ show: 'goal', goal: { atMost: 1 }, color: '#e86bf0', unlitColor: '#A78BFA' }))
    expect(number().dataset.lit).toBe('true')
    expect(within(number()).getByTestId('number-count').style.color).toBe('var(--color-overdue)')
  })

  it('a Share of… line follows the colour that applies', () => {
    setup(shape({ show: 'share', litWhen: 'never', litAt: undefined, unlitColor: '#A78BFA' }))
    expect(number().querySelector('[data-sparkline] polyline')!.getAttribute('stroke')).toBe('var(--hue-violet-text)')
    cleanup()
    setup(shape({ show: 'share', litWhen: 'never', litAt: undefined }))
    expect(number().querySelector('[data-sparkline] polyline')!.getAttribute('stroke')).toBe('var(--color-accent)')
  })

  it('Against a goal lights by its own rule: both colours in its editor', () => {
    const tab = shape({ show: 'goal', goal: { atLeast: 2 } })
    const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'L', createdAt: new Date(), modifiedAt: new Date(), ...single({ id: 'c', tabs: [tab] }) }
    useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout] })
    render(<DndContext><GlanceWidget tab={tab} /><NumberEditorHost /></DndContext>)
    act(() => { useUIStore.getState().openNumberEditor('n') })
    const editor = document.querySelector<HTMLElement>('[data-number-editor="n"]')!
    expect(within(editor).getByRole('group', { name: 'Color when lit' })).not.toBeNull()
    expect(within(editor).getByRole('group', { name: 'Color otherwise' })).not.toBeNull()
  })
})

describe('Against a goal', () => {
  it('at most: over the limit, lit; at least: met', () => {
    setup(shape({ show: 'goal', goal: { atMost: 1 } }))
    expect(number().dataset.show).toBe('goal')
    expect(figure()).toBe('2')
    expect(within(number()).getByTestId('number-goal-target').textContent).toBe('/ 1')
    expect(within(number()).getByTestId('number-goal-state').textContent).toBe('1 over the limit')
    expect(number().dataset.lit).toBe('true')
    cleanup()
    setup(shape({ show: 'goal', goal: { atLeast: 2 } }))
    expect(within(number()).getByTestId('number-goal-state').textContent).toBe('Goal met')
    expect(number().dataset.lit).toBeUndefined()
  })

  it('a weekly goal marks its pace (Saturday, the last day of a Sunday week: the whole goal)', () => {
    setup(shape({ show: 'goal', goal: { atLeast: 4, period: 'week' } }))
    const tick = within(number()).getByTestId('number-goal-pace')
    expect(tick.getAttribute('title')).toBe('Pace: 4 by the end of Sat')
    expect(tick.style.left).toBe('100%')
    expect(within(number()).getByTestId('number-goal-state').textContent).toBe('Behind pace (Sat)')
    expect(number().dataset.lit).toBe('true')
    expect(within(number()).getByTestId('number-goal-bar').querySelector('span')!.style.width).toBe('50%')
  })
})

describe('A group', () => {
  const items = [
    { name: 'Open', filter: emptyPredicate() },
    { name: 'Late', filter: numberTab('x', 'overdue').config.filter, color: '#e86bf0' },
  ]

  it('its counts side by side, each lit in its own colour, each opening its tasks', () => {
    const onDrill = vi.fn()
    setup(numberTab('n', 'open', { name: 'Due', show: 'group', items, litWhen: 'above', litAt: 0 }), onDrill)
    expect(number().dataset.show).toBe('group')
    const counts = within(number()).getAllByTestId('number-group-count').map((el) => el.textContent)
    expect(counts[0]).toBe('19')
    expect(counts[1]).toBe('2')
    const late = within(number()).getByRole('button', { name: 'Late: 2. Show tasks' })
    expect(late.dataset.lit).toBe('true')
    fireEvent.click(late)
    const drill = onDrill.mock.calls[0]![0] as GlanceDrill
    expect(drill.title).toBe('Due · Late')
    expect((drill.source as unknown as { todoIds: number[] }).todoIds).toHaveLength(Number(counts[1]))
    expect(lastResult?.summary.plain).toBe(`Due\nOpen 19 · Late ${counts[1]}`)
  })

  it('its small face is its label and its counts (the names as tooltips)', () => {
    setup(numberTab('n', 'open', { name: 'Due', show: 'group', items }), undefined, 'small')
    expect(within(number()).getAllByTestId('number-group-count')).toHaveLength(2)
    expect(number().textContent).not.toContain('Open')
    expect(number().querySelector('[data-group-item="0"]')!.getAttribute('title')).toBe('Open')
  })
})

describe('Follow a list', () => {
  it('counts what the list shows, with its badge; no list picked reads —', () => {
    // Waiting on: the 2 waiting tasks, both due for a follow-up.
    setup(numberTab('n', 'open', { name: '', show: 'list', list: { listDefinitionId: 1 } }))
    expect(number().dataset.show).toBe('list')
    expect(figure()).toBe('2')
    expect(number().textContent).toContain('Waiting on')
    expect(number().querySelector('[data-number-badge]')).not.toBeNull()
    cleanup()
    setup(numberTab('n', 'open', { name: 'Follow', show: 'list' }))
    expect(figure()).toBe('—')
    expect(within(number()).getByTestId('number-list-note').textContent).toBe('No list picked')
  })

  it('a list with a prompt reads — until it is picked', () => {
    setup(numberTab('n', 'open', { name: 'For', show: 'list', list: { listDefinitionId: 5 } }))
    expect(figure()).toBe('—')
    expect(within(number()).getByTestId('number-list-note').textContent).toBe('Pick to count')
  })
})

describe('the Number’s menu', () => {
  const labels = (entries: MenuEntry[]) => entries.flatMap((e) => ('label' in e ? [e.label] : []))

  it('offers the breakdown on a count only', () => {
    expect(labels(glanceMenu(numberTab('n', 'open'), undefined)!.settingEntries)).toContain('Breakdown')
    expect(labels(glanceMenu(shape({ show: 'share' }), undefined)!.settingEntries)).not.toContain('Breakdown')
  })
})

describe('Edit number’s shape fields', () => {
  function openEditor(tab: NumberTab) {
    const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'L', createdAt: new Date(), modifiedAt: new Date(), ...single({ id: 'c', tabs: [tab] }) }
    useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout] })
    render(<DndContext><GlanceWidget tab={tab} /><NumberEditorHost /></DndContext>)
    act(() => { useUIStore.getState().openNumberEditor(tab.id) })
    return document.querySelector<HTMLElement>(`[data-number-editor="${tab.id}"]`)!
  }
  const config = () => (useWorkspaceStore.getState().working!.cells[0]!.tabs[0] as NumberTab).config
  const show = (editor: HTMLElement, value: string) => fireEvent.change(within(editor).getByTestId('number-editor-show'), { target: { value } })
  const has = (editor: HTMLElement, name: string) => within(editor).queryByRole('combobox', { name }) != null
  /** The editor's Save (it writes its copy and closes), then the editor opened again. */
  const saveAndReopen = (editor: HTMLElement) => {
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    expect(document.querySelector('[data-number-editor]')).toBeNull()
    act(() => { useUIStore.getState().openNumberEditor('n') })
    return document.querySelector<HTMLElement>('[data-number-editor="n"]')!
  }

  it('shows only the active shape’s fields, and keeps only its field', () => {
    let editor = openEditor(numberTab('n', 'overdue'))
    expect(within(editor).getByTestId('number-editor-show')).toHaveValue('count')
    expect(has(editor, 'Compare with')).toBe(true)

    show(editor, 'share')
    expect(within(editor).getByTestId('number-editor-of')).not.toBeNull()
    expect(within(editor).getByTestId('number-editor-filter')).not.toBeNull()
    expect(has(editor, 'Compare with')).toBe(true)
    editor = saveAndReopen(editor)
    expect(config()).toMatchObject({ show: 'share' })
    expect(config()).not.toHaveProperty('of')

    show(editor, 'oldest')
    expect(within(editor).queryByTestId('number-editor-of')).toBeNull()
    expect(has(editor, 'Age by')).toBe(true)
    expect(has(editor, 'Compare with')).toBe(false)
    editor = saveAndReopen(editor)
    expect(config()).toMatchObject({ show: 'oldest', oldestBy: 'lastFollowup' })

    show(editor, 'goal')
    expect(has(editor, 'Light up when')).toBe(false)
    expect(has(editor, 'Goal')).toBe(true)
    editor = saveAndReopen(editor)
    expect(config()).toMatchObject({ show: 'goal', goal: { atLeast: 10, period: 'week' } })
    expect(config()).not.toHaveProperty('oldestBy')
    fireEvent.change(within(editor).getByRole('combobox', { name: 'Goal' }), { target: { value: 'atMost' } })
    fireEvent.change(within(editor).getByRole('spinbutton', { name: 'Goal: at most' }), { target: { value: '3' } })
    fireEvent.change(within(editor).getByRole('combobox', { name: 'Pace' }), { target: { value: 'none' } })
    editor = saveAndReopen(editor)
    expect(config().goal).toEqual({ atMost: 3 })

    show(editor, 'group')
    expect(within(editor).queryByTestId('number-editor-filter')).toBeNull()
    expect(within(editor).queryByRole('group', { name: /^Color/ })).toBeNull()
    expect(within(editor).getByRole('textbox', { name: 'Count 1 name' })).toHaveValue('Overdue')
    editor = saveAndReopen(editor)
    expect(config().items).toEqual([{ name: 'Overdue', filter: numberTab('n', 'overdue').config.filter, color: numberTab('n', 'overdue').config.color }])
    expect(config()).not.toHaveProperty('goal')
    fireEvent.click(within(editor).getByRole('button', { name: 'Add a count' }))
    editor = saveAndReopen(editor)
    expect(config().items).toHaveLength(2)

    show(editor, 'list')
    expect(within(editor).queryByTestId('number-editor-filter')).toBeNull()
    expect(has(editor, 'Top-bar lens')).toBe(false)
    editor = saveAndReopen(editor)
    // The layout's first list.
    expect(config()).toMatchObject({ show: 'list', list: { listDefinitionId: 1 } })
    expect(config()).not.toHaveProperty('items')
    fireEvent.change(within(editor).getByTestId('number-editor-list'), { target: { value: '3' } })
    editor = saveAndReopen(editor)
    expect(config().list).toEqual({ listDefinitionId: 3 })

    // Within one editor, back to each: as it was left there.
    show(editor, 'goal')
    fireEvent.change(within(editor).getByRole('combobox', { name: 'Goal' }), { target: { value: 'atMost' } })
    fireEvent.change(within(editor).getByRole('spinbutton', { name: 'Goal: at most' }), { target: { value: '3' } })
    show(editor, 'oldest')
    fireEvent.change(within(editor).getByRole('combobox', { name: 'Age by' }), { target: { value: 'deadline' } })
    show(editor, 'group')
    fireEvent.click(within(editor).getByRole('button', { name: 'Add a count' }))
    show(editor, 'list')
    expect(within(editor).getByTestId('number-editor-list')).toHaveValue('3')
    show(editor, 'goal')
    expect(within(editor).getByRole('combobox', { name: 'Goal' })).toHaveValue('atMost')
    expect(within(editor).getByRole('spinbutton', { name: 'Goal: at most' })).toHaveValue(3)
    show(editor, 'oldest')
    expect(within(editor).getByRole('combobox', { name: 'Age by' })).toHaveValue('deadline')
    show(editor, 'group')
    expect(within(editor).getByRole('textbox', { name: 'Count 2 name' })).toBeInTheDocument()
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    // Saved: only the active shape's field.
    expect(config()).toMatchObject({ show: 'group' })
    expect(config().items).toHaveLength(2)
    expect(config()).not.toHaveProperty('list')
    expect(config()).not.toHaveProperty('goal')
    expect(config()).not.toHaveProperty('oldestBy')
    expect(layoutSteps()).not.toEqual([])
  })

  it('a share’s and an oldest’s threshold reads in its unit', () => {
    const editor = openEditor(shape({ show: 'share', litWhen: 'above', litAt: 20 }))
    expect(within(editor).getByRole('spinbutton', { name: 'Light up when above (%)' })).toHaveValue(20)
  })

  it('a group’s counts: renamed, recoloured, removed down to one, up to six', () => {
    let editor = openEditor(numberTab('n', 'open', { name: 'Due', show: 'group', items: [{ name: 'A', filter: emptyPredicate() }] }))
    expect(within(editor).queryByRole('button', { name: 'Remove count 1' })).toBeNull()
    for (let i = 0; i < 5; i++) fireEvent.click(within(editor).getByRole('button', { name: 'Add a count' }))
    expect(within(editor).queryByRole('button', { name: 'Add a count' })).toBeNull()
    editor = saveAndReopen(editor)
    expect(config().items).toHaveLength(6)
    fireEvent.change(within(editor).getByRole('textbox', { name: 'Count 2 name' }), { target: { value: 'Late' } })
    let second = within(editor).getByRole('group', { name: 'Count 2' })
    fireEvent.click(within(second).getAllByRole('radio')[2]!)
    editor = saveAndReopen(editor)
    expect(config().items![1]).toMatchObject({ name: 'Late', color: expect.stringMatching(/^#/) })
    second = within(editor).getByRole('group', { name: 'Count 2' })
    fireEvent.click(within(second).getByRole('radio', { name: /^Auto/ }))
    editor = saveAndReopen(editor)
    expect(config().items![1]).not.toHaveProperty('color')
    fireEvent.click(within(editor).getByRole('button', { name: 'Remove count 1' }))
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    expect(config().items).toHaveLength(5)
    expect(config().items![0]!.name).toBe('Late')
  })
})
