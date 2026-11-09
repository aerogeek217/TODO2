import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, renderHook, cleanup, act } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { GlanceWidget } from '../../../components/workspace/glance/GlanceWidget'
import { NeglectMapWidget } from '../../../components/workspace/neglect/NeglectMapWidget'
import { CalendarWidget } from '../../../components/workspace/calendar/CalendarWidget'
import { useEisenhowerSource } from '../../../hooks/use-eisenhower-source'
import { useScreenTasks } from '../../../hooks/use-glance-data'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import { useTodoNameLookups } from '../../../hooks/use-todo-name-lookups'
import { useFilterSettings } from '../../../hooks/use-filter-settings'
import { useScreenFilter } from '../../../stores/screen-filter'
import { createTab, isGlanceKind, WIDGET_KINDS, type CalendarTab, type GlanceTab, type GlanceWidgetKind, type NeglectTab } from '../../../models/workspace-layout'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { applyFilter } from '../../../utils/filter-match'
import { numberIds } from '../../../services/stats/number-count'
import { computeBreakdown } from '../../../services/stats/breakdown'
import { computePulse } from '../../../services/stats/pulse'
import { SHARED_MEMO_WARNING } from '../../../utils/shared-memo'
import { useFilterStore } from '../../../stores/filter-store'
import { useStatusUpdateStore } from '../../../stores/status-update-store'
import { useSubtaskStore } from '../../../stores/subtask-store'
import { resetEntityStores, clearFilterStore } from '../../helpers'
import { numberTab } from '../../helpers/layout-builders'
import { ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, SAMPLE_TASKS, STATUSES, TAGS } from '../../fixtures/glance-sample'

// Count the screen filter's runs: every glance widget reads the one shared base.
vi.mock('../../../utils/filter-match', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/filter-match')>()
  return { ...actual, applyFilter: vi.fn(actual.applyFilter) }
})
// And two statistics' runs: what a write recomputes.
vi.mock('../../../services/stats/number-count', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/stats/number-count')>()
  return { ...actual, numberIds: vi.fn(actual.numberIds) }
})
vi.mock('../../../services/stats/breakdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/stats/breakdown')>()
  return { ...actual, computeBreakdown: vi.fn(actual.computeBreakdown) }
})
// And one with options: a memo keeps one input set per choice (A9).
vi.mock('../../../services/stats/pulse', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/stats/pulse')>()
  return { ...actual, computePulse: vi.fn(actual.computePulse) }
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 10, 10))
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ urgentDueWithinDays: 3, weekStartsOn: 0 })
  useTodoStore.setState({ todos: SAMPLE_TASKS })
  usePersonStore.setState({ people: PEOPLE, assignedPeopleMap: ASSIGNED_PEOPLE })
  useTagStore.setState({ tags: TAGS, assignedTagsMap: ASSIGNED_TAGS })
  useStatusStore.setState({ statuses: STATUSES })
  vi.mocked(applyFilter).mockClear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('glance widgets share their data', () => {
  it('fifteen glance widgets filter the tasks once, and once again after a task changes', () => {
    const glanceKinds = WIDGET_KINDS.filter(isGlanceKind)
    const kinds: GlanceWidgetKind[] = [...glanceKinds, ...Array.from({ length: 15 - glanceKinds.length }, (): GlanceWidgetKind => 'number')]
    const tabs = kinds.map((k, i) => (k === 'number' ? numberTab(`w${i}`, i % 2 ? 'open' : 'overdue') : createTab(k, `w${i}`)) as GlanceTab)
    render(<DndContext>{tabs.map((t) => <GlanceWidget key={t.id} tab={t} />)}</DndContext>)
    expect(document.querySelectorAll('[data-glance]')).toHaveLength(15)
    // Once for the shared base.
    expect(vi.mocked(applyFilter)).toHaveBeenCalledTimes(1)

    vi.mocked(applyFilter).mockClear()
    act(() => { useTodoStore.setState({ todos: SAMPLE_TASKS.map((t) => (t.id === SAMPLE_TASKS[0]!.id ? { ...t, title: 'Renamed' } : t)) }) })
    expect(vi.mocked(applyFilter)).toHaveBeenCalledTimes(1)
  })

  it('a Neglect map beside them reads the same base: still one screen-filter pass', () => {
    const tabs: GlanceTab[] = [numberTab('n'), createTab('breakdown', 't', { breakdown: { splitBy: 'tags' } }) as GlanceTab]
    const neglect: NeglectTab = { id: 'm', kind: 'neglect', config: { colourBy: { kind: 'none' }, untouchedDays: 14 } }
    render(
      <DndContext>
        {tabs.map((t) => <GlanceWidget key={t.id} tab={t} />)}
        <NeglectMapWidget tab={neglect} />
        <NeglectMapWidget tab={{ ...neglect, id: 'm2' }} />
      </DndContext>,
    )
    expect(document.querySelectorAll('[data-testid="neglect-slipping-corner"]')).toHaveLength(2)
    expect(vi.mocked(applyFilter)).toHaveBeenCalledTimes(1)
  })

  it('a status update or subtask write that keeps the same tasks on screen recomputes no statistic', () => {
    const tabs: GlanceTab[] = [
      numberTab('n'),
      createTab('breakdown', 't', { breakdown: { splitBy: 'tags' } }) as GlanceTab,
      createTab('pulse', 'p') as GlanceTab,
    ]
    render(<DndContext>{tabs.map((t) => <GlanceWidget key={t.id} tab={t} />)}</DndContext>)
    vi.mocked(numberIds).mockClear()
    vi.mocked(computeBreakdown).mockClear()
    vi.mocked(applyFilter).mockClear()
    act(() => { useStatusUpdateStore.setState({ byTodo: new Map([[SAMPLE_TASKS[0]!.id, []]]) }) })
    act(() => { useSubtaskStore.setState({ byTodo: new Map([[SAMPLE_TASKS[0]!.id, []]]) }) })
    // The screen filter reads the text again (it may search the updates)…
    expect(vi.mocked(applyFilter)).toHaveBeenCalledTimes(2)
    // …but keeps the same tasks, so every part hits its memo.
    expect(vi.mocked(numberIds)).not.toHaveBeenCalled()
    expect(vi.mocked(computeBreakdown)).not.toHaveBeenCalled()
  })

  it('a screen filter change recomputes the shown half only (once per filter on screen); the every-task totals stay', () => {
    const tabs: GlanceTab[] = [numberTab('n'), createTab('breakdown', 't', { breakdown: { splitBy: 'tags' } }) as GlanceTab]
    render(<DndContext>{tabs.map((t) => <GlanceWidget key={t.id} tab={t} />)}</DndContext>)
    vi.mocked(numberIds).mockClear()
    vi.mocked(computeBreakdown).mockClear()
    act(() => { useFilterStore.getState().setAllFilters({ ...useFilterStore.getState().filters, tags: new Set([TAGS[0]!.id]) }) })
    // The Number's filter and the Breakdown's, each over the shown tasks.
    expect(vi.mocked(numberIds)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(numberIds).mock.calls[0]![1].length).toBeLessThan(SAMPLE_TASKS.length)
    expect(vi.mocked(computeBreakdown)).toHaveBeenCalledTimes(1)
  })

  it('a dozen widgets, options differing, still hit on a re-render: no part recomputes and no memo warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(computePulse).mockClear()
    const tabs: GlanceTab[] = [
      ...WIDGET_KINDS.filter(isGlanceKind).filter((k) => k !== 'pulse').map((k) => createTab(k, `w-${k}`) as GlanceTab),
      numberTab('n2', 'focus'),
      numberTab('n3', 'dueToday'),
      createTab('breakdown', 'b-tags', { breakdown: { splitBy: 'tags' } }) as GlanceTab,
      createTab('breakdown', 'b-status', { breakdown: { splitBy: 'status', style: 'stacked' } }) as GlanceTab,
      { id: 'p1', kind: 'pulse', config: { tagIds: [TAGS[0]!.id!] } },
      { id: 'p2', kind: 'pulse', config: { tagIds: [TAGS[1]!.id!] } },
      { id: 'p12', kind: 'pulse', config: { tagIds: [TAGS[0]!.id!, TAGS[1]!.id!] } },
      { id: 'p0', kind: 'pulse', config: { tagIds: [] } },
      { id: 'p3', kind: 'pulse', config: { tagIds: [TAGS[2]!.id!] } },
    ]
    expect(tabs.length).toBeGreaterThanOrEqual(12)
    const tree = () => <DndContext>{tabs.map((t) => <GlanceWidget key={t.id} tab={t} />)}</DndContext>
    const { rerender } = render(tree())
    // Once per tag pick on screen.
    expect(vi.mocked(computePulse)).toHaveBeenCalledTimes(5)
    for (const fn of [applyFilter, numberIds, computeBreakdown, computePulse]) vi.mocked(fn).mockClear()
    for (let i = 0; i < 4; i++) rerender(tree())
    expect(vi.mocked(applyFilter)).not.toHaveBeenCalled()
    expect(vi.mocked(numberIds)).not.toHaveBeenCalled()
    expect(vi.mocked(computeBreakdown)).not.toHaveBeenCalled()
    expect(vi.mocked(computePulse)).not.toHaveBeenCalled()
    // A task write: each part recomputes once per option on screen, never per widget.
    act(() => { useTodoStore.setState({ todos: SAMPLE_TASKS.map((t) => (t.id === SAMPLE_TASKS[0]!.id ? { ...t, title: 'Renamed' } : t)) }) })
    for (let i = 0; i < 4; i++) rerender(tree())
    expect(vi.mocked(computePulse)).toHaveBeenCalledTimes(5)
    expect(warn.mock.calls.filter((c) => String(c[0]).includes(SHARED_MEMO_WARNING))).toEqual([])
    warn.mockRestore()
  })

  it('the calendars (full and face) and the Eisenhower read the same base: still one screen-filter pass (A6)', () => {
    const calendar = createTab('calendar', 'cal') as CalendarTab
    function Eisenhower() {
      useEisenhowerSource()
      return null
    }
    render(
      <DndContext>
        <GlanceWidget tab={numberTab('n')} />
        <CalendarWidget tab={calendar} />
        <WidgetFaceContext.Provider value={{ forced: 'medium' }}>
          <CalendarWidget tab={{ ...calendar, id: 'cal2' }} />
        </WidgetFaceContext.Provider>
        <Eisenhower />
      </DndContext>,
    )
    expect(document.querySelector('[data-calendar-widget="cal"]')).not.toBeNull()
    expect(document.querySelector('[data-calendar-face-tab="cal2"]')).not.toBeNull()
    expect(vi.mocked(applyFilter)).toHaveBeenCalledTimes(1)
  })

  it('useScreenTasks keeps what applyFilter(screen) keeps: completed tasks only while the screen filter lets them through', () => {
    const done = { ...SAMPLE_TASKS[0]!, id: 9001, isCompleted: true, completedAt: new Date(2026, 9, 9) }
    useTodoStore.setState({ todos: [...SAMPLE_TASKS, done] })
    const { result, rerender } = renderHook(() => {
      const screen = useScreenFilter().filters
      const lookups = useTodoNameLookups()
      const settings = useFilterSettings()
      return { tasks: useScreenTasks(), expected: vi.mocked(applyFilter).getMockImplementation()!(screen, useTodoStore.getState().todos, lookups, new Date(2026, 9, 10), settings) }
    })
    expect(result.current.tasks.map((t) => t.id)).toEqual(result.current.expected.map((t) => t.id))
    expect(result.current.tasks.some((t) => t.id === 9001)).toBe(false)
    act(() => { useFilterStore.getState().setAllFilters({ ...useFilterStore.getState().filters, showCompleted: true }) })
    rerender()
    expect(result.current.tasks.map((t) => t.id)).toEqual(result.current.expected.map((t) => t.id))
    expect(result.current.tasks.some((t) => t.id === 9001)).toBe(true)
  })
})
