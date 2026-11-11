import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Person, Status, Tag } from '../../models'
import { createTab, type LayoutTab, type PersistedWorkspaceLayout } from '../../models/workspace-layout'
import { firstReviewTab, reviewWidgetTarget, setReviewWidgetFilter, setReviewWidgetFilterText } from '../../services/review-widget'
import { useListWidgetStore } from '../../stores/list-widget-store'
import { usePersonStore } from '../../stores/person-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { cell, grid } from '../helpers/layout-builders'

/**
 * What the Review buttons (widget feedback 2B) call into (2A): a Review
 * tab's filter set — temporary, never the layout — with the tab shown, and
 * the widget a jump goes to (J4).
 */

const aisha: Person = { id: 1, name: 'Aisha Rahman', initials: 'AR' }
const ben: Person = { id: 2, name: 'Ben', initials: 'B' }
const q4: Tag = { id: 3, name: 'q4', color: '#c8743a' }
const waiting: Status = { id: 4, name: 'Waiting', color: '#4caf50', sortOrder: 1 }

const T0 = new Date('2026-11-01T09:00:00Z')
const notes = (id: string): LayoutTab => createTab('notes', id)
const review = (id: string): LayoutTab => createTab('review', id)

function layout(id: number, body: ReturnType<typeof grid>): PersistedWorkspaceLayout {
  return { id, name: `L${id}`, sortOrder: id, createdAt: T0, modifiedAt: T0, ...body }
}

let setActiveTab: ReturnType<typeof vi.fn>
let setTrackCollapsed: ReturnType<typeof vi.fn>

beforeEach(() => {
  usePersonStore.setState({ people: [aisha, ben] })
  useTagStore.setState({ tags: [q4] })
  useStatusStore.setState({ statuses: [waiting] })
  setActiveTab = vi.fn(() => Promise.resolve())
  setTrackCollapsed = vi.fn(() => Promise.resolve())
  useWorkspaceStore.setState({ setActiveTab: setActiveTab as never, setTrackCollapsed: setTrackCollapsed as never })
})

describe('firstReviewTab', () => {
  it('the first Review tab in reading order (top track, then left), a cell’s tabs in strip order', () => {
    const body = grid([
      [cell('a', [notes('n1')]), cell('b', [notes('n2'), review('rv-b')])],
      [cell('c', [review('rv-c')]), cell('c', [review('rv-c')])],
    ])
    expect(firstReviewTab(body)).toBe('rv-b')
    expect(firstReviewTab(grid([[cell('a', [notes('n1')])]]))).toBeNull()
  })
})

describe('reviewWidgetTarget', () => {
  it('the open layout’s first Review widget', () => {
    const open = layout(2, grid([[cell('a', [notes('n')]), cell('b', [review('rv2')])]]))
    const other = layout(1, grid([[cell('a', [review('rv1')])]]))
    useWorkspaceStore.setState({ working: open, layouts: [other, open] })
    expect(reviewWidgetTarget()).toEqual({ layoutId: 2, tabId: 'rv2', open: true })
  })

  it('else the first layout in tab order that has one', () => {
    const open = layout(1, grid([[cell('a', [notes('n')])]]))
    const second = layout(2, grid([[cell('a', [notes('m')])]]))
    const third = layout(3, grid([[cell('a', [review('rv3')])]]))
    const fourth = layout(4, grid([[cell('a', [review('rv4')])]]))
    useWorkspaceStore.setState({ working: open, layouts: [open, second, third, fourth] })
    expect(reviewWidgetTarget()).toEqual({ layoutId: 3, tabId: 'rv3', open: false })
  })

  it('none anywhere: null', () => {
    const open = layout(1, grid([[cell('a', [notes('n')])]]))
    useWorkspaceStore.setState({ working: open, layouts: [open] })
    expect(reviewWidgetTarget()).toBeNull()
  })

  it('the open layout as shown counts, not its stored copy in the list', () => {
    const stored = layout(1, grid([[cell('a', [notes('n')])]]))
    const shown = layout(1, grid([[cell('a', [notes('n'), review('rv-new')])]]))
    useWorkspaceStore.setState({ working: shown, layouts: [stored] })
    expect(reviewWidgetTarget()).toEqual({ layoutId: 1, tabId: 'rv-new', open: true })
  })
})

describe('setReviewWidgetFilter / setReviewWidgetFilterText', () => {
  beforeEach(() => {
    const open = layout(1, grid([[cell('a', [notes('n'), review('rv')], { activeTabId: 'n' })]], { rows: [{ weight: 1000, collapsed: true }] }))
    useWorkspaceStore.setState({ working: open, saved: open, layouts: [open] })
  })

  it('sets the tab’s filter in memory and shows the tab — its cell’s active tab, its row expanded', () => {
    setReviewWidgetFilter('rv', { expression: { kind: 'person', id: 2 }, showCompleted: false })
    expect(useListWidgetStore.getState().reviewFilters.rv).toEqual({ expression: { kind: 'person', id: 2 }, showCompleted: false })
    expect(setActiveTab).toHaveBeenCalledWith('rv')
    expect(setTrackCollapsed).toHaveBeenCalledWith(['r1'], false)
  })

  it('from text, names read as the field reads them (a quoted name with a space)', () => {
    const parse = setReviewWidgetFilterText('rv', '@"Aisha Rahman" or @Ben and !Waiting')
    expect(parse.ok).toBe(true)
    expect(useListWidgetStore.getState().reviewFilters.rv).toEqual({
      expression: { kind: 'or', items: [{ kind: 'person', id: 1 }, { kind: 'and', items: [{ kind: 'person', id: 2 }, { kind: 'status', id: 4 }] }] },
      showCompleted: false,
    })
    expect(setActiveTab).toHaveBeenCalledWith('rv')
  })

  it('a text that doesn’t read changes nothing and says why; an empty one clears the filter', () => {
    setReviewWidgetFilterText('rv', '#q4')
    const parse = setReviewWidgetFilterText('rv', '@Ben and')
    expect(parse.ok).toBe(false)
    expect(useListWidgetStore.getState().reviewFilters.rv).toEqual({ expression: { kind: 'tag', id: 3 }, showCompleted: false })
    expect(setReviewWidgetFilterText('rv', '').ok).toBe(true)
    expect(useListWidgetStore.getState().reviewFilters.rv).toBeUndefined()
  })

  it('nothing is written to the layout', () => {
    const patchTabConfig = vi.fn()
    const patchTabViewState = vi.fn()
    useWorkspaceStore.setState({ patchTabConfig: patchTabConfig as never, patchTabViewState: patchTabViewState as never })
    setReviewWidgetFilterText('rv', '@Ben')
    expect(patchTabConfig).not.toHaveBeenCalled()
    expect(patchTabViewState).not.toHaveBeenCalled()
  })
})
