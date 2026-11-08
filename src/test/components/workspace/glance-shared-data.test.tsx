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
import { computeTiles } from '../../../services/stats/tiles'
import { computeTagStats } from '../../../services/stats/tags'
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
vi.mock('../../../services/stats/tiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/stats/tiles')>()
  return { ...actual, computeTiles: vi.fn(actual.computeTiles) }
})
vi.mock('../../../services/stats/tags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/stats/tags')>()
  return { ...actual, computeTagStats: vi.fn(actual.computeTagStats) }
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
    vi.mocked(computeTiles).mockClear()
    vi.mocked(computeTagStats).mockClear()
    vi.mocked(applyFilter).mockClear()
    act(() => { useStatusUpdateStore.setState({ byTodo: new Map([[SAMPLE_TASKS[0]!.id, []]]) }) })
    act(() => { useSubtaskStore.setState({ byTodo: new Map([[SAMPLE_TASKS[0]!.id, []]]) }) })
    // The screen filter reads the text again (it may search the updates)…
    expect(vi.mocked(applyFilter)).toHaveBeenCalledTimes(2)
    // …but keeps the same tasks, so every part hits its memo.
    expect(vi.mocked(computeTiles)).not.toHaveBeenCalled()
    expect(vi.mocked(computeTagStats)).not.toHaveBeenCalled()
  })

  it('a screen filter change recomputes the shown half only; the every-task totals stay', () => {
    const tabs: GlanceTab[] = [{ id: 'n', kind: 'number', config: { metric: 'open' } }, createTab('tags', 't') as GlanceTab]
    render(<DndContext>{tabs.map((t) => <GlanceWidget key={t.id} tab={t} />)}</DndContext>)
    vi.mocked(computeTiles).mockClear()
    vi.mocked(computeTagStats).mockClear()
    act(() => { useFilterStore.getState().setAllFilters({ ...useFilterStore.getState().filters, tags: new Set([TAGS[0]!.id]) }) })
    expect(vi.mocked(computeTiles)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(computeTiles).mock.calls[0]![0].length).toBeLessThan(SAMPLE_TASKS.length)
    expect(vi.mocked(computeTagStats)).toHaveBeenCalledTimes(1)
  })
})
