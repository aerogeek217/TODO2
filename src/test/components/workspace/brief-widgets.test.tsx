import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, within, act } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { GlanceWidget } from '../../../components/workspace/glance/GlanceWidget'
import type { GlanceResult } from '../../../components/workspace/glance/glance-hooks'
import { glanceMenu } from '../../../components/workspace/glance/glance-menu'
import type { GlanceDrill } from '../../../components/workspace/glance/glance-types'
import type { MenuItemEntry } from '../../../components/shared/MenuPopover'
import type { PersistedTodoItem, Tag } from '../../../models'
import { createTab, type GlanceTab } from '../../../models/workspace-layout'
import { clearFocus } from '../../../services/today-focus'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { trendEventsKey, useTrendEventsStore } from '../../../stores/trend-events-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { WidgetFace } from '../../../utils/widget-face'
import { clearFilterStore, makeTodo, patchScreenFilter, resetEntityStores } from '../../helpers'

// The face is the cell's size, which JSDOM doesn't lay out: each test picks it.
const faceState = vi.hoisted(() => ({ face: 'large' as WidgetFace }))
vi.mock('../../../hooks/use-widget-face', () => ({ useWidgetFace: () => [() => {}, faceState.face] }))

const NOW = new Date(2026, 10, 11, 10)
const TODAY = new Date(2026, 10, 11)
const day = (n: number) => new Date(2026, 10, 11 + n)
const OLD = new Date(2026, 8, 1)

const ATLAS: Tag = { id: 1, name: 'Project: Atlas', color: '#4f8cff' }
const BETA: Tag = { id: 2, name: 'Project: Beta', color: '#e05050' }

function task(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return makeTodo({ createdAt: OLD, modifiedAt: day(-1), ...overrides })
}

const TASKS: PersistedTodoItem[] = [
  task({ id: 1, title: 'Ship the beta', dueDate: day(-1), focus: true }),
  task({ id: 2, title: 'Book the venue', dueDate: day(3), focus: true }),
  task({ id: 3, title: 'Pay the invoice', dueDate: TODAY }),
  task({ id: 4, title: 'Renew the domain', dueDate: day(-5), modifiedAt: OLD }),
  task({ id: 5, title: 'Write the notes', focus: true, isCompleted: true, completedAt: day(0) }),
  task({ id: 6, title: 'Plan the offsite' }),
]

let lastResult: GlanceResult | null = null

function setup(tab: GlanceTab, onDrill?: (d: GlanceDrill) => void) {
  return render(
    <DndContext>
      <GlanceWidget tab={tab} onResult={(r) => { lastResult = r }} onDrill={onDrill} />
    </DndContext>,
  )
}

const root = (kind: string) => document.querySelector<HTMLElement>(`[data-glance="${kind}"]`)!

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  faceState.face = 'large'
  lastResult = null
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ urgentDueWithinDays: 3, weekStartsOn: 0, staleAfterDays: 30 })
  useTodoStore.setState({ todos: TASKS })
  useTagStore.setState({
    tags: [ATLAS, BETA],
    assignedTagsMap: new Map([[1, [ATLAS]], [4, [ATLAS]], [2, [BETA]], [6, [BETA]]]),
  })
  useStatusStore.setState({ statuses: [] })
  useUIStore.setState({ selectedTodoIds: new Set(), selectionScope: null, taskDialog: null, confirmPrompts: [] })
  useTrendEventsStore.setState({
    entries: new Map([[trendEventsKey('changes', TODAY, 0), { events: [], stale: false, loading: false }]]),
    generation: 0,
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('What changed', () => {
  const sentences = () => [...root('changes').querySelectorAll('[data-change]')].map((el) => el.getAttribute('data-change'))

  it('large: today’s date, then every sentence, the first as the headline; Copy has them all', () => {
    setup(createTab('changes', 'c', { tagIds: [1] }))
    expect(root('changes').dataset.face).toBeUndefined()
    expect(root('changes').textContent).toContain('Wednesday, November 11')
    expect(sentences()).toEqual(['late', 'tag', 'dueToday', 'closed'])
    expect(root('changes').querySelector('[data-change="late"]')!.textContent).toBe('1 task went late since yesterday.')
    expect(root('changes').querySelector('[data-change="tag"]')!.textContent).toBe('#Project: Atlas has the most late tasks (2).')
    expect(lastResult?.summary.plain.split('\n')).toHaveLength(4)
  })

  it('medium: the first three; small: the headline alone, no date', () => {
    faceState.face = 'medium'
    setup(createTab('changes', 'c', { tagIds: [1] }))
    expect(sentences()).toEqual(['late', 'tag', 'dueToday'])
    cleanup()
    faceState.face = 'small'
    setup(createTab('changes', 'c', { tagIds: [1] }))
    expect(sentences()).toEqual(['late'])
    expect(root('changes').textContent).not.toContain('November')
  })

  it('a sentence opens its tasks', () => {
    const onDrill = vi.fn()
    setup(createTab('changes', 'c', { tagIds: [1] }), onDrill)
    fireEvent.click(root('changes').querySelector('[data-change="tag"]')!)
    const drill = onDrill.mock.calls[0]![0] as GlanceDrill
    expect(drill.title).toBe('Late in #Project: Atlas')
    expect(drill.source).toEqual({ kind: 'todos', todoIds: [4, 1] })
  })

  it('the closed sentence’s usual reads only the weeks inside Settings’ completed-task retention', () => {
    const closedOn = (id: number, at: Date) => task({ id, isCompleted: true, completedAt: at })
    useTodoStore.setState({ todos: [...TASKS, closedOn(10, day(-9)), closedOn(11, day(-9)), closedOn(12, day(-15))] })
    const closed = () => root('changes').querySelector('[data-change="closed"]')!.textContent
    setup(createTab('changes', 'c'))
    expect(closed()).toBe('1 closed this week, about your usual 0.8 a week.')
    cleanup()
    useSettingsStore.setState({ completedRetentionDays: 14 })
    setup(createTab('changes', 'c'))
    expect(closed()).toBe('1 closed this week, below your usual 2 a week.')
  })

  it('nothing to say: a quiet line', () => {
    useTodoStore.setState({ todos: [task({ id: 6 })] })
    setup(createTab('changes', 'c'))
    expect(sentences()).toEqual(['none'])
    expect(root('changes').textContent).toContain('Nothing new since yesterday.')
    expect(lastResult?.summary.plain).toBe('Nothing new since yesterday.')
  })

  it('while its events are read, it shows no sentence', () => {
    useTrendEventsStore.setState({ entries: new Map(), generation: 0 })
    vi.spyOn(useTrendEventsStore.getState(), 'load').mockResolvedValue()
    setup(createTab('changes', 'c'))
    expect(sentences()).toEqual([])
    expect(root('changes').querySelector('[aria-busy="true"]')).not.toBeNull()
  })
})

describe('Today', () => {
  it('large: the open Focus tasks as rows, then up to five suggestions; its own selection scope', () => {
    setup(createTab('today', 't'))
    const r = root('today')
    expect(r.getAttribute('data-selection-scope')).toBe('t')
    const rows = [...r.querySelectorAll('[data-row-key] [data-todo-id]')].map((el) => Number(el.getAttribute('data-todo-id')))
    expect(rows).toEqual([1, 2])
    const suggested = within(r.querySelector<HTMLElement>('[data-today-suggested]')!)
    expect([...r.querySelectorAll('[data-suggestion]')].map((el) => el.getAttribute('data-suggestion'))).toEqual(['3', '4'])
    expect(suggested.getByText('Due today')).toBeTruthy()
    expect(suggested.getByText('Slipping')).toBeTruthy()
    expect(lastResult?.summary.plain).toBe('Today 2\nShip the beta\nBook the venue')
  })

  it('a suggestion’s + puts it in Focus, one undo step', () => {
    const setMarkerFlags = vi.fn().mockResolvedValue(undefined)
    useTodoStore.setState({ setMarkerFlags })
    setup(createTab('today', 't'))
    fireEvent.click(within(root('today')).getByRole('button', { name: 'Add “Pay the invoice” to Focus' }))
    expect(setMarkerFlags).toHaveBeenCalledWith([{ todoId: 3, focus: true }], 'Added “Pay the invoice” to Focus')
  })

  it('small: Today and the Focus count, opening them; medium: the Focus titles', () => {
    const onDrill = vi.fn()
    faceState.face = 'small'
    setup(createTab('today', 't'), onDrill)
    expect(within(root('today')).getByTestId('today-count').textContent).toBe('2')
    fireEvent.click(within(root('today')).getByRole('button', { name: 'Today: 2. Show tasks' }))
    expect((onDrill.mock.calls[0]![0] as GlanceDrill).source).toEqual({ kind: 'todos', todoIds: [1, 2] })
    cleanup()
    faceState.face = 'medium'
    setup(createTab('today', 't'))
    expect([...root('today').querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Ship the beta', 'Book the venue'])
    expect(root('today').querySelector('[data-suggestion]')).toBeNull()
  })

  it('nothing in Focus: says so, and still suggests', () => {
    useTodoStore.setState({ todos: TASKS.map((t) => ({ ...t, focus: undefined })) })
    setup(createTab('today', 't'))
    expect(root('today').textContent).toContain('Nothing picked for today')
    expect(root('today').querySelectorAll('[data-suggestion]').length).toBeGreaterThan(0)
  })
})

describe('Project pulse', () => {
  it('large: a card per picked tag, in pick order, its ring the late share; a card opens the tag’s open tasks', () => {
    const onDrill = vi.fn()
    setup(createTab('pulse', 'p', { tagIds: [2, 1] }), onDrill)
    const cards = [...root('pulse').querySelectorAll<HTMLElement>('[data-pulse-card]')]
    expect(cards.map((c) => c.dataset.pulseCard)).toEqual(['2', '1'])
    const atlas = cards[1]!
    expect(atlas.textContent).toContain('2 late (100%)')
    expect(atlas.querySelector<HTMLElement>('[class*="ring"]')!.style.getPropertyValue('--pulse-late')).toBe('100%')
    expect(atlas.querySelector('[data-pulse-lines] polyline')).not.toBeNull()
    expect(atlas.textContent).toContain('Steady: +0 net in 4 weeks')
    fireEvent.click(atlas)
    expect(onDrill.mock.calls[0]![0]).toMatchObject({ title: '#Project: Atlas', source: { kind: 'todos', todoIds: [4, 1] } })
    expect(lastResult?.summary.plain.split('\n')[0]).toBe('#Project: Beta 2 open · 0 late · 0 stale · Steady: +0 net in 4 weeks')
  })

  it('medium: a line per tag; small: the worst tag’s late share', () => {
    faceState.face = 'medium'
    setup(createTab('pulse', 'p', { tagIds: [2, 1] }))
    expect([...root('pulse').querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Project: Beta2 open · 0% late · Steady',
      'Project: Atlas2 open · 100% late · Steady',
    ])
    cleanup()
    faceState.face = 'small'
    setup(createTab('pulse', 'p', { tagIds: [2, 1] }))
    expect(within(root('pulse')).getByTestId('pulse-worst').textContent).toBe('100% late')
    expect(root('pulse').textContent).toContain('#Project: Atlas')
  })

  it('no tags picked: says how to pick them', () => {
    setup(createTab('pulse', 'p'))
    expect(root('pulse').textContent).toContain('No tags picked')
  })

  it('the picked tags deleted since: says so, not that none are picked', () => {
    setup(createTab('pulse', 'p', { tagIds: [98, 99] }))
    expect(root('pulse').textContent).toContain('The picked tags were deleted')
    expect(root('pulse').textContent).not.toContain('No tags picked')
    cleanup()
    faceState.face = 'small'
    setup(createTab('pulse', 'p', { tagIds: [98, 99] }))
    expect(root('pulse').textContent).toContain('Picked tags deleted')
  })
})

describe('the brief parts’ tab menus', () => {
  const item = (entries: readonly { kind: string }[], label: string) =>
    entries.find((e): e is MenuItemEntry => e.kind === 'item' && (e as MenuItemEntry).label === label)!

  it.each(['changes', 'pulse'] as const)('%s: Tags › ticks a tag in or out of the picks', (kind) => {
    const patchTabConfig = vi.fn()
    useWorkspaceStore.setState({ patchTabConfig })
    const tab = createTab(kind, 'w', { tagIds: [2] }) as GlanceTab
    const tags = item(glanceMenu(tab, undefined)!.settingEntries, 'Tags')
    expect(tags.note).toBe('1')
    const beta = item(tags.children!, 'Project: Beta')
    expect(beta.checked).toBe(true)
    item(tags.children!, 'Project: Atlas').onSelect!()
    expect(patchTabConfig).toHaveBeenCalledWith('w', kind, { tagIds: [2, 1] })
    beta.onSelect!()
    expect(patchTabConfig).toHaveBeenLastCalledWith('w', kind, { tagIds: [] })
  })

  it('Today offers Clear Focus… before Copy', () => {
    const tab = createTab('today', 't')
    expect(glanceMenu(tab, undefined)!.actions.map((a) => a.label)).toEqual(['Clear Focus…'])
    expect(glanceMenu(tab, { plain: 'Today 2', html: '' })!.actions.map((a) => a.label)).toEqual(['Clear Focus…', 'Copy'])
  })
})

describe('Clear Focus', () => {
  /** Answers the prompt on screen once it is asked. */
  async function answer(a: true | false | 'discard') {
    await vi.waitFor(() => expect(useUIStore.getState().confirmPrompts).toHaveLength(1))
    act(() => useUIStore.getState().answerConfirmation(a))
  }

  function spyFlags() {
    const setMarkerFlags = vi.fn().mockResolvedValue(undefined)
    useTodoStore.setState({ setMarkerFlags })
    return setMarkerFlags
  }

  it('Keep the open ones: only the done ones leave Focus', async () => {
    const setMarkerFlags = spyFlags()
    const done = clearFocus()
    await answer(true)
    await done
    expect(useUIStore.getState().confirmPrompts).toHaveLength(0)
    expect(setMarkerFlags).toHaveBeenCalledWith([{ todoId: 5, focus: false }], 'Cleared Focus from 1 done task')
  })

  it('the prompt names the open count; Clear all clears every Focus task, open and done, in one step', async () => {
    const setMarkerFlags = spyFlags()
    const done = clearFocus()
    await vi.waitFor(() => expect(useUIStore.getState().confirmPrompts).toHaveLength(1))
    const prompt = useUIStore.getState().confirmPrompts[0]!
    expect(prompt.confirmLabel).toBe('Keep the 2 open ones for tomorrow')
    expect(prompt.discardLabel).toBe('Clear all')
    await answer('discard')
    await done
    expect(setMarkerFlags).toHaveBeenCalledTimes(1)
    expect(setMarkerFlags.mock.calls[0]![0]).toEqual([{ todoId: 1, focus: false }, { todoId: 2, focus: false }, { todoId: 5, focus: false }])
  })

  it('cancel changes nothing; nothing in Focus asks nothing', async () => {
    const setMarkerFlags = spyFlags()
    const done = clearFocus()
    await answer(false)
    await done
    expect(setMarkerFlags).not.toHaveBeenCalled()
    useTodoStore.setState({ todos: [task({ id: 6 })] })
    await clearFocus()
    expect(useUIStore.getState().confirmPrompts).toHaveLength(0)
  })

  it('under the screen filter: only the Focus tasks it keeps, and the prompt says so', async () => {
    const setMarkerFlags = spyFlags()
    patchScreenFilter({ tags: new Set([2]) })
    const done = clearFocus()
    await vi.waitFor(() => expect(useUIStore.getState().confirmPrompts).toHaveLength(1))
    expect(useUIStore.getState().confirmPrompts[0]!.message).toContain('Only the tasks the top bar’s filter shows')
    await answer('discard')
    await done
    expect(setMarkerFlags.mock.calls[0]![0]).toEqual([{ todoId: 2, focus: false }])
  })
})
