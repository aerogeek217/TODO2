import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, cleanup, fireEvent, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { GlanceWidget } from '../../../components/workspace/glance/GlanceWidget'
import type { GlanceResult } from '../../../components/workspace/glance/glance-hooks'
import { glanceMenu } from '../../../components/workspace/glance/glance-menu'
import type { GlanceDrill } from '../../../components/workspace/glance/glance-types'
import type { MenuItemEntry } from '../../../components/shared/MenuPopover'
import type { PersistedTodoItem, Tag } from '../../../models'
import { createTab, type GlanceTab } from '../../../models/workspace-layout'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { WidgetFace } from '../../../utils/widget-face'
import { useUndoStore } from '../../../stores/undo-store'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'
import { single } from '../../helpers/layout-builders'
import { layoutSteps } from '../../helpers/layout-steps'

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
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
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

describe('Project pulse’s tab menu', () => {
  const item = (entries: readonly { kind: string }[], label: string) =>
    entries.find((e): e is MenuItemEntry => e.kind === 'item' && (e as MenuItemEntry).label === label)!

  it('Tags › ticks a tag in or out of the picks', () => {
    const kind = 'pulse'
    const patchTabConfig = vi.fn()
    useWorkspaceStore.setState({ patchTabConfig })
    const tab = createTab(kind, 'w', { tagIds: [2] })
    const tags = item(glanceMenu(tab, undefined)!.settingEntries, 'Tags')
    expect(tags.note).toBe('1')
    const beta = item(tags.children!, 'Project: Beta')
    expect(beta.checked).toBe(true)
    item(tags.children!, 'Project: Atlas').onSelect!()
    expect(patchTabConfig).toHaveBeenCalledWith('w', kind, { tagIds: [2, 1] })
    beta.onSelect!()
    expect(patchTabConfig).toHaveBeenLastCalledWith('w', kind, { tagIds: [] })
  })
})

// Item 9: tags added with the + card and removed with a card's ×, each one undo step.
describe('Project pulse: + and × on the widget', () => {
  /** The tab in the open layout, rendered live, so its writes land there and show. */
  function setupLive(tab: GlanceTab) {
    const layout = { id: 1, sortOrder: 0, name: 'L', createdAt: new Date(), modifiedAt: new Date(), ...single({ id: 'c', tabs: [tab] }) }
    useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout] })
    function Live() {
      const live = useWorkspaceStore((s) => s.working!.cells[0]!.tabs[0]) as GlanceTab
      return <GlanceWidget tab={live} />
    }
    return render(<DndContext><Live /></DndContext>)
  }
  const picked = () => (useWorkspaceStore.getState().working!.cells[0]!.tabs[0] as Extract<GlanceTab, { kind: 'pulse' }>).config.tagIds
  const option = (name: string) => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent?.includes(name))!

  it('a card’s × removes its tag: one undo step, named plainly; Undo brings it back', async () => {
    setupLive(createTab('pulse', 'p', { tagIds: [2, 1] }))
    const remove = root('pulse').querySelector<HTMLButtonElement>('[data-pulse-remove="1"]')!
    expect(remove.getAttribute('aria-label')).toBe('Remove “Project: Atlas” from project pulse')
    await act(async () => { fireEvent.click(remove) })
    expect(picked()).toEqual([2])
    expect(layoutSteps()).toEqual(['Removed “Project: Atlas” from project pulse'])
    expect(root('pulse').querySelector('[data-pulse-card="1"]')).toBeNull()
    await act(async () => { await useUndoStore.getState().undo() })
    expect(picked()).toEqual([2, 1])
  })

  it('the + card after the last card opens the tag picker, the picked tags ticked; a pick adds its card at the end', async () => {
    setupLive(createTab('pulse', 'p', { tagIds: [2] }))
    const grid = root('pulse').querySelector('[data-pulse-add]')!.parentElement!
    expect(grid.lastElementChild!.hasAttribute('data-pulse-add')).toBe(true)
    const add = root('pulse').querySelector<HTMLButtonElement>('[data-pulse-add]')!
    expect(add.getAttribute('aria-label')).toBe('Add a tag to project pulse')
    await act(async () => { fireEvent.click(add) })
    expect(add.getAttribute('aria-expanded')).toBe('true')
    expect(option('Project: Beta').getAttribute('aria-selected')).toBe('true')
    expect(option('Project: Atlas').getAttribute('aria-selected')).toBe('false')
    // No Create row: it picks among the tags there are.
    expect(document.body.textContent).not.toContain('Create "')
    await act(async () => { fireEvent.click(option('Project: Atlas')) })
    expect(picked()).toEqual([2, 1])
    expect(layoutSteps()).toEqual(['Added “Project: Atlas” to project pulse'])
    expect([...root('pulse').querySelectorAll<HTMLElement>('[data-pulse-card]')].map((c) => c.dataset.pulseCard)).toEqual(['2', '1'])
    // Unticking in the picker removes it again.
    await act(async () => { fireEvent.click(option('Project: Atlas')) })
    expect(picked()).toEqual([2])
    expect(layoutSteps().at(-1)).toBe('Removed “Project: Atlas” from project pulse')
  })

  it('with no tag picked, the empty state’s Add tag opens the same picker', async () => {
    setupLive(createTab('pulse', 'p'))
    expect(root('pulse').textContent).toContain('No tags picked')
    const add = within(root('pulse')).getByRole('button', { name: '+ Add tag' })
    await act(async () => { fireEvent.click(add) })
    await act(async () => { fireEvent.click(option('Project: Beta')) })
    expect(picked()).toEqual([2])
    expect(layoutSteps()).toEqual(['Added “Project: Beta” to project pulse'])
    expect(root('pulse').querySelector('[data-pulse-card="2"]')).not.toBeNull()
  })

  it('the faces without cards are unchanged: no + card, no ×', () => {
    faceState.face = 'medium'
    setupLive(createTab('pulse', 'p', { tagIds: [2, 1] }))
    expect(root('pulse').querySelector('[data-pulse-add]')).toBeNull()
    expect(root('pulse').querySelector('[data-pulse-remove]')).toBeNull()
  })
})
