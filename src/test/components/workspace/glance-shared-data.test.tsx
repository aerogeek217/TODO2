import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { GlanceWidget } from '../../../components/workspace/glance/GlanceWidget'
import { NeglectMapWidget } from '../../../components/workspace/neglect/NeglectMapWidget'
import { createTab, isGlanceKind, WIDGET_KINDS, type GlanceTab, type GlanceWidgetKind, type NeglectTab } from '../../../models/workspace-layout'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { applyFilter } from '../../../utils/filter-match'
import { computeMetrics } from '../../../services/stats/metrics'
import { computeTagStats } from '../../../services/stats/tags'
import { computeFollowupGroups } from '../../../services/stats/followup-groups'
import { computeStaleTasks } from '../../../services/stats/stale'
import { SHARED_MEMO_WARNING } from '../../../utils/shared-memo'
import { useFilterStore } from '../../../stores/filter-store'
import { useStatusUpdateStore } from '../../../stores/status-update-store'
import { useSubtaskStore } from '../../../stores/subtask-store'
import { resetEntityStores, clearFilterStore } from '../../helpers'
import { ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, SAMPLE_TASKS, STATUSES, TAGS } from '../../fixtures/glance-sample'

// Count the screen filter's runs: every glance widget reads the one shared base.
vi.mock('../../../utils/filter-match', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/filter-match')>()
  return { ...actual, applyFilter: vi.fn(actual.applyFilter) }
})
// And two statistics' runs: what a write recomputes.
vi.mock('../../../services/stats/metrics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/stats/metrics')>()
  return { ...actual, computeMetrics: vi.fn(actual.computeMetrics) }
})
vi.mock('../../../services/stats/tags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/stats/tags')>()
  return { ...actual, computeTagStats: vi.fn(actual.computeTagStats) }
})
// And two with options: a memo keeps one input set per choice (A9).
vi.mock('../../../services/stats/followup-groups', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/stats/followup-groups')>()
  return { ...actual, computeFollowupGroups: vi.fn(actual.computeFollowupGroups) }
})
vi.mock('../../../services/stats/stale', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/stats/stale')>()
  return { ...actual, computeStaleTasks: vi.fn(actual.computeStaleTasks) }
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
    const kinds: GlanceWidgetKind[] = [...WIDGET_KINDS.filter(isGlanceKind), 'number', 'number']
    const tabs = kinds.map((k, i) => (k === 'number' ? { id: `w${i}`, kind: 'number', config: { metric: i % 2 ? 'open' : 'overdue' } } : createTab(k, `w${i}`)) as GlanceTab)
    render(<DndContext>{tabs.map((t) => <GlanceWidget key={t.id} tab={t} />)}</DndContext>)
    expect(document.querySelectorAll('[data-glance]')).toHaveLength(15)
    // Once for the shared base (the Eisenhower summary's own list isn't loaded: it reads the base).
    expect(vi.mocked(applyFilter)).toHaveBeenCalledTimes(1)

    vi.mocked(applyFilter).mockClear()
    act(() => { useTodoStore.setState({ todos: SAMPLE_TASKS.map((t) => (t.id === SAMPLE_TASKS[0]!.id ? { ...t, title: 'Renamed' } : t)) }) })
    expect(vi.mocked(applyFilter)).toHaveBeenCalledTimes(1)
  })

  it('a Neglect map beside them reads the same base: still one screen-filter pass', () => {
    const tabs: GlanceTab[] = [{ id: 'n', kind: 'number', config: { metric: 'open' } }, createTab('tags', 't') as GlanceTab]
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
      { id: 'n', kind: 'number', config: { metric: 'open' } },
      createTab('tags', 't') as GlanceTab,
      createTab('followup', 'f') as GlanceTab,
    ]
    render(<DndContext>{tabs.map((t) => <GlanceWidget key={t.id} tab={t} />)}</DndContext>)
    vi.mocked(computeMetrics).mockClear()
    vi.mocked(computeTagStats).mockClear()
    vi.mocked(applyFilter).mockClear()
    act(() => { useStatusUpdateStore.setState({ byTodo: new Map([[SAMPLE_TASKS[0]!.id, []]]) }) })
    act(() => { useSubtaskStore.setState({ byTodo: new Map([[SAMPLE_TASKS[0]!.id, []]]) }) })
    // The screen filter reads the text again (it may search the updates)…
    expect(vi.mocked(applyFilter)).toHaveBeenCalledTimes(2)
    // …but keeps the same tasks, so every part hits its memo.
    expect(vi.mocked(computeMetrics)).not.toHaveBeenCalled()
    expect(vi.mocked(computeTagStats)).not.toHaveBeenCalled()
  })

  it('a screen filter change recomputes the shown half only; the every-task totals stay', () => {
    const tabs: GlanceTab[] = [{ id: 'n', kind: 'number', config: { metric: 'open' } }, createTab('tags', 't') as GlanceTab]
    render(<DndContext>{tabs.map((t) => <GlanceWidget key={t.id} tab={t} />)}</DndContext>)
    vi.mocked(computeMetrics).mockClear()
    vi.mocked(computeTagStats).mockClear()
    act(() => { useFilterStore.getState().setAllFilters({ ...useFilterStore.getState().filters, tags: new Set([TAGS[0]!.id]) }) })
    expect(vi.mocked(computeMetrics)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(computeMetrics).mock.calls[0]![0].length).toBeLessThan(SAMPLE_TASKS.length)
    expect(vi.mocked(computeTagStats)).toHaveBeenCalledTimes(1)
  })

  it('a dozen widgets, options differing, still hit on a re-render: no part recomputes and no memo warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(computeFollowupGroups).mockClear()
    vi.mocked(computeStaleTasks).mockClear()
    const tabs: GlanceTab[] = [
      ...WIDGET_KINDS.filter(isGlanceKind).filter((k) => k !== 'followup' && k !== 'stale').map((k) => createTab(k, `w-${k}`) as GlanceTab),
      { id: 'f3', kind: 'followup', config: { lookAhead: 3 } },
      { id: 'f7', kind: 'followup', config: { lookAhead: 7 } },
      { id: 'f14', kind: 'followup', config: { lookAhead: 14 } },
      { id: 's7', kind: 'stale', config: { staleDays: 7 } },
      { id: 's30', kind: 'stale', config: { staleDays: 30 } },
    ]
    expect(tabs.length).toBeGreaterThanOrEqual(12)
    const tree = () => <DndContext>{tabs.map((t) => <GlanceWidget key={t.id} tab={t} />)}</DndContext>
    const { rerender } = render(tree())
    // Each half once per look-ahead / threshold on screen.
    expect(vi.mocked(computeFollowupGroups)).toHaveBeenCalledTimes(6)
    expect(vi.mocked(computeStaleTasks)).toHaveBeenCalledTimes(4)
    for (const fn of [applyFilter, computeMetrics, computeTagStats, computeFollowupGroups, computeStaleTasks]) vi.mocked(fn).mockClear()
    for (let i = 0; i < 4; i++) rerender(tree())
    expect(vi.mocked(applyFilter)).not.toHaveBeenCalled()
    expect(vi.mocked(computeMetrics)).not.toHaveBeenCalled()
    expect(vi.mocked(computeTagStats)).not.toHaveBeenCalled()
    expect(vi.mocked(computeFollowupGroups)).not.toHaveBeenCalled()
    expect(vi.mocked(computeStaleTasks)).not.toHaveBeenCalled()
    // A task write: each part recomputes once per option on screen, never per widget.
    act(() => { useTodoStore.setState({ todos: SAMPLE_TASKS.map((t) => (t.id === SAMPLE_TASKS[0]!.id ? { ...t, title: 'Renamed' } : t)) }) })
    for (let i = 0; i < 4; i++) rerender(tree())
    expect(vi.mocked(computeFollowupGroups)).toHaveBeenCalledTimes(6)
    expect(vi.mocked(computeStaleTasks)).toHaveBeenCalledTimes(4)
    expect(warn.mock.calls.filter((c) => String(c[0]).includes(SHARED_MEMO_WARNING))).toEqual([])
    warn.mockRestore()
  })
})
