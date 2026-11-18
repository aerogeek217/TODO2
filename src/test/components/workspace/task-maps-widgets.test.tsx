import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WorkClustersWidget } from '../../../components/workspace/clusters/WorkClustersWidget'
import type { ClustersTab } from '../../../models/workspace-layout'
import { usePersonStore } from '../../../stores/person-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'

const TODAY = new Date(2026, 10, 18, 10)
const day = (offset: number) => new Date(2026, 10, 18 + offset, 9)
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
