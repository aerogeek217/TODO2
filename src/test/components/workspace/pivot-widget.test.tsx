import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, cleanup, fireEvent } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { GlanceWidget } from '../../../components/workspace/glance/GlanceWidget'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import type { PivotConfig } from '../../../models/chart-widgets'
import { createTab, type PivotTab, type PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { WidgetFace } from '../../../utils/widget-face'
import { clearFilterStore, resetEntityStores } from '../../helpers'
import { single } from '../../helpers/layout-builders'
import { ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, SAMPLE_TASKS, STATUSES, TAGS } from '../../fixtures/glance-sample'
import { layoutSteps } from '../../helpers/layout-steps'

/** The Pivot's headings sort its rows (item 8, view state), as a Breakdown's. */

function pivot(over: Partial<PivotConfig> = {}): PivotTab {
  const tab = createTab('pivot', 'p') as PivotTab
  return { ...tab, config: { ...tab.config, ...over } }
}

function setup(tab: PivotTab, face: WidgetFace = 'large') {
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'L', createdAt: new Date(), modifiedAt: new Date(), ...single({ id: 'c', tabs: [tab] }) }
  useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout] })
  function Live() {
    const live = useWorkspaceStore((s) => s.working!.cells[0]!.tabs[0]) as PivotTab
    return (
      <WidgetFaceContext.Provider value={{ forced: face }}>
        <GlanceWidget tab={live} />
      </WidgetFaceContext.Provider>
    )
  }
  return render(<DndContext><Live /></DndContext>)
}

const current = () => useWorkspaceStore.getState().working!.cells[0]!.tabs[0] as PivotTab
const keys = () => [...document.querySelectorAll<HTMLElement>('[data-pivot-row]')].map((r) => r.dataset.pivotRow)
const head = (key: string) => document.querySelector<HTMLButtonElement>(`[data-sort-key="${key}"]`)!
const sortOf = (key: string) => head(key).closest('[role="columnheader"]')!.getAttribute('aria-sort')
/** A row's count in the column `col` (`total` for Total). */
const count = (row: string, col: string) => {
  const text = document.querySelector(`[data-pivot-cell="${col === 'total' ? `${row}|total` : `${row}|${col}`}"]`)?.textContent ?? '–'
  return text === '–' ? 0 : Number(text)
}

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
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the Pivot’s headings sort its rows (item 8)', () => {
  it('a column: largest first, a second click reverses, a third goes back — view state, no undo step; the none row stays last', async () => {
    setup(pivot())
    const before = keys()
    expect(before.at(-1)).toBe('none')
    const col = [...document.querySelectorAll<HTMLButtonElement>('[data-sort-key]')].map((b) => b.dataset.sortKey!).find((k) => k.startsWith('status-'))!
    expect(sortOf(col)).toBe('none')
    await act(async () => { fireEvent.click(head(col)) })
    expect(current().viewState?.sort).toEqual({ by: col })
    expect(layoutSteps()).toEqual([])
    expect(sortOf(col)).toBe('descending')
    expect(head(col).textContent).toContain('▼')
    const desc = keys().filter((k) => k !== 'none').map((k) => count(k!, col))
    expect(desc).toEqual([...desc].sort((a, b) => b - a))
    expect(keys().at(-1)).toBe('none')
    await act(async () => { fireEvent.click(head(col)) })
    expect(current().viewState?.sort).toEqual({ by: col, reversed: true })
    expect(sortOf(col)).toBe('ascending')
    expect(head(col).textContent).toContain('▲')
    const asc = keys().filter((k) => k !== 'none').map((k) => count(k!, col))
    expect(asc).toEqual([...asc].sort((a, b) => a - b))
    await act(async () => { fireEvent.click(head(col)) })
    expect(current().viewState?.sort).toBeUndefined()
    expect(keys()).toEqual(before)
    expect(sortOf(col)).toBe('none')
  })

  it('Total sorts by the row totals; the name heading (what the rows split by) A–Z, then Z–A', async () => {
    setup(pivot())
    expect(head('name').textContent).toBe('Person')
    expect(head('total').textContent).toBe('Total')
    await act(async () => { fireEvent.click(head('total')) })
    const totals = keys().filter((k) => k !== 'none').map((k) => count(k!, 'total'))
    expect(totals).toEqual([...totals].sort((a, b) => b - a))
    await act(async () => { fireEvent.click(head('name')) })
    expect(current().viewState?.sort).toEqual({ by: 'name' })
    expect(sortOf('name')).toBe('ascending')
    const names = () => [...document.querySelectorAll('[data-pivot-row]')].filter((r) => r.getAttribute('data-pivot-row') !== 'none').map((r) => r.querySelector('[role="rowheader"]')!.textContent!)
    expect(names()).toEqual([...names()].sort((a, b) => a.localeCompare(b)))
    await act(async () => { fireEvent.click(head('name')) })
    expect(sortOf('name')).toBe('descending')
    expect(names()).toEqual([...names()].sort((a, b) => b.localeCompare(a)))
  })

  it('a stored sort by a column the table no longer shows reads as the natural order; the columns never move', () => {
    setup(pivot())
    const natural = keys()
    const cols = [...document.querySelectorAll<HTMLElement>('[data-pivot-head]')].map((h) => h.dataset.pivotHead)
    act(() => { void useWorkspaceStore.getState().patchTabViewState('p', 'pivot', { sort: { by: 'status-999' } }) })
    expect(keys()).toEqual(natural)
    expect([...document.querySelectorAll('[aria-sort="descending"], [aria-sort="ascending"]')]).toHaveLength(0)
    act(() => { void useWorkspaceStore.getState().patchTabViewState('p', 'pivot', { sort: { by: 'total', reversed: true } }) })
    expect([...document.querySelectorAll<HTMLElement>('[data-pivot-head]')].map((h) => h.dataset.pivotHead)).toEqual(cols)
  })

  it('the medium face sorts too', async () => {
    setup(pivot(), 'medium')
    await act(async () => { fireEvent.click(head('total')) })
    expect(current().viewState?.sort).toEqual({ by: 'total' })
  })
})
