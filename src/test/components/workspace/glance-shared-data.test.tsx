import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { GlanceWidget } from '../../../components/workspace/glance/GlanceWidget'
import { createTab, isGlanceKind, WIDGET_KINDS, type GlanceTab, type GlanceWidgetKind } from '../../../models/workspace-layout'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { applyFilter } from '../../../utils/filter-match'
import { resetEntityStores, clearFilterStore } from '../../helpers'
import { ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, SAMPLE_TASKS, STATUSES, TAGS } from '../../fixtures/dashboard-sample'

// Count the screen filter's runs: every glance widget reads the one shared base.
vi.mock('../../../utils/filter-match', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/filter-match')>()
  return { ...actual, applyFilter: vi.fn(actual.applyFilter) }
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
  it('a dozen glance widgets filter the tasks once, and once again after a task changes', () => {
    const kinds: GlanceWidgetKind[] = [...WIDGET_KINDS.filter(isGlanceKind), 'number', 'number']
    const tabs = kinds.map((k, i) => (k === 'number' ? { id: `w${i}`, kind: 'number', config: { metric: i % 2 ? 'open' : 'overdue' } } : createTab(k, `w${i}`)) as GlanceTab)
    render(<DndContext>{tabs.map((t) => <GlanceWidget key={t.id} tab={t} />)}</DndContext>)
    expect(document.querySelectorAll('[data-glance]')).toHaveLength(12)
    // Once for the shared base (the Eisenhower summary's own list isn't loaded: it reads the base).
    expect(vi.mocked(applyFilter)).toHaveBeenCalledTimes(1)

    vi.mocked(applyFilter).mockClear()
    act(() => { useTodoStore.setState({ todos: SAMPLE_TASKS.map((t) => (t.id === SAMPLE_TASKS[0]!.id ? { ...t, title: 'Renamed' } : t)) }) })
    expect(vi.mocked(applyFilter)).toHaveBeenCalledTimes(1)
  })
})
