import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { PressureRadarWidget } from '../../../components/workspace/radar/PressureRadarWidget'
import { useRadarMenuEntries } from '../../../components/workspace/radar/radar-menu'
import { WorkClustersWidget } from '../../../components/workspace/clusters/WorkClustersWidget'
import type { ClustersTab, RadarTab } from '../../../models/workspace-layout'
import type { MenuEntry } from '../../../components/shared/MenuPopover'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'

const TODAY = new Date(2026, 10, 18, 10)
const day = (offset: number) => new Date(2026, 10, 18 + offset, 9)
const RADAR: RadarTab = { id: 'radar', kind: 'radar', config: { waitingStatusIds: [7] } }
const CLUSTERS: ClustersTab = { id: 'clusters', kind: 'clusters', config: {} }

let width = 1200
let height = 700

beforeEach(() => {
  width = 1200
  height = 700
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  resetEntityStores()
  clearFilterStore()
  useTodoStore.setState({
    todos: [
      makeTodo({ id: 1, title: 'Late report', dueDate: day(-3), sortOrder: 1 }),
      makeTodo({ id: 2, title: 'Chase vendor', statusId: 7, lastFollowupAt: day(-9), sortOrder: 2 }),
      makeTodo({ id: 3, title: 'Call back', nextFollowupAt: day(5), sortOrder: 3 }),
      makeTodo({ id: 4, title: 'Old idea', modifiedAt: day(-60), sortOrder: 4 }),
      makeTodo({ id: 5, title: 'Plan offsite', dueDate: day(12), sortOrder: 5 }),
    ],
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the Pressure radar widget', () => {
  it('draws a dot per open task and each quarter’s count; a quarter’s word and the middle open their tasks', () => {
    const show = vi.spyOn(useUIStore.getState(), 'showTaskDialog')
    render(<PressureRadarWidget tab={RADAR} />)
    expect(document.querySelectorAll('[data-radar-dot]')).toHaveLength(5)
    expect([...document.querySelectorAll('[data-radar-dot]')].map((d) => d.getAttribute('data-radar-dot')).sort())
      .toEqual(['due', 'due', 'followup', 'untouched', 'waiting'])
    // Late report, Chase vendor (a week since its last follow-up, 2 days ago) and Old idea (stale) need you now.
    expect(document.querySelectorAll('[data-radar-dot][data-now="true"]')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: /^Due date: show 2 tasks, 1 need you now/ }))
    expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Due date', source: { kind: 'todos', todoIds: [1, 5] } }))
    fireEvent.click(screen.getByTestId('radar-now'))
    expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Need you now', source: { kind: 'todos', todoIds: [4, 1, 2] } }))
  })

  it('a dot opens its task', () => {
    const open = vi.spyOn(useUIStore.getState(), 'openEditPopup')
    render(<PressureRadarWidget tab={RADAR} />)
    fireEvent.click(screen.getByRole('button', { name: /^Call back: Follow-up · follow-up in 5 days/ }))
    expect(open).toHaveBeenCalledWith(3)
  })

  it('a small cell shows how many need you now; a short one the quarters as rows', () => {
    height = 80
    const { unmount } = render(<PressureRadarWidget tab={RADAR} />)
    expect(screen.getByTestId('radar-face-count')).toHaveTextContent('3')
    unmount()
    height = 200
    render(<PressureRadarWidget tab={RADAR} />)
    expect(document.querySelector('[data-radar-face="medium"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Waiting: 1 open, 1 need you now' })).toBeEnabled()
  })

  it('its menu ticks the Waiting statuses, one layout write each', () => {
    useStatusStore.setState({ statuses: [{ id: 7, name: 'Waiting', color: '#a070e0', sortOrder: 0 }, { id: 8, name: 'Blocked', color: '#e05050', sortOrder: 1 }] })
    const patch = vi.spyOn(useWorkspaceStore.getState(), 'patchTabConfig').mockImplementation(() => {})
    const { result } = renderHook(() => useRadarMenuEntries(RADAR))
    const item = result.current[0] as Extract<MenuEntry, { kind: 'item' }>
    expect(item.label).toBe('Waiting statuses')
    expect(item.note).toBe('1')
    const blocked = item.children?.find((e) => e.kind === 'item' && e.label === 'Blocked') as Extract<MenuEntry, { kind: 'item' }>
    blocked.onSelect?.()
    expect(patch).toHaveBeenCalledWith('radar', 'radar', { waitingStatusIds: [7, 8] })
  })
})

describe('the Work clusters widget', () => {
  beforeEach(() => {
    const ana = { id: 1, name: 'Ana', initials: 'A' }
    const ben = { id: 2, name: 'Ben', initials: 'B' }
    const atlas = { id: 11, name: 'Project: Atlas', color: '#3b82f6' }
    usePersonStore.setState({ people: [ana, ben], assignedPeopleMap: new Map([[1, [ana]], [2, [ana, ben]], [5, [ben]]]) })
    useTagStore.setState({ tags: [atlas], assignedTagsMap: new Map([[1, [atlas]], [2, [atlas]], [5, [atlas]]]) })
  })

  it('draws a bubble per person and tag; a cluster’s name, without its Project: prefix, opens its tasks', () => {
    const show = vi.spyOn(useUIStore.getState(), 'showTaskDialog')
    render(<WorkClustersWidget tab={CLUSTERS} />)
    expect([...document.querySelectorAll('[data-cluster-node]')].map((n) => n.getAttribute('data-cluster-node')).sort()).toEqual(['p:1', 'p:2', 't:11'])
    fireEvent.click(screen.getByRole('button', { name: 'Atlas cluster: show 3 tasks' }))
    expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Atlas', source: { kind: 'todos', todoIds: [1, 2, 5] } }))
  })

  it('a bubble opens the person / tag menu', () => {
    render(<WorkClustersWidget tab={CLUSTERS} />)
    fireEvent.click(screen.getByRole('button', { name: /^Ana: 2 open tasks · 1 overdue/ }))
    expect(screen.getByRole('menu', { name: '@Ana' })).toBeInTheDocument()
  })

  it('a short cell lists the clusters', () => {
    height = 200
    render(<WorkClustersWidget tab={CLUSTERS} />)
    expect(document.querySelector('[data-clusters-face="medium"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: /Atlas/ })).toHaveTextContent('Atlas1 overdue3')
  })
})
