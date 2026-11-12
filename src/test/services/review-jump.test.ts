import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTab, type LayoutTab, type PersistedWorkspaceLayout } from '../../models/workspace-layout'
import { jumpToReview, reviewJumpAvailable } from '../../services/review-jump'
import { registerOpenEditor } from '../../stores/editor-leave'
import { useListWidgetStore, type ReviewFilter } from '../../stores/list-widget-store'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { cell, grid } from '../helpers/layout-builders'

/**
 * A Review button's jump (widget feedback 2B): the filter shown in the open
 * layout's first Review widget, else the first layout that has one (switched
 * to as the layout tabs switch, an editor with changes asked first); none
 * anywhere, nowhere to go. Nothing is written to a layout.
 */

const T0 = new Date('2026-11-01T09:00:00Z')
const notes = (id: string): LayoutTab => createTab('notes', id)
const review = (id: string): LayoutTab => createTab('review', id)
const AISHA: ReviewFilter = { expression: { kind: 'person', id: 1 }, showCompleted: false }

function layout(id: number, body: ReturnType<typeof grid>): PersistedWorkspaceLayout {
  return { id, name: `L${id}`, sortOrder: id, createdAt: T0, modifiedAt: T0, ...body }
}

let setActiveTab: ReturnType<typeof vi.fn>
let setTrackCollapsed: ReturnType<typeof vi.fn>
let patchTabConfig: ReturnType<typeof vi.fn>
let patchTabViewState: ReturnType<typeof vi.fn>

/** `load` as the store's: it switches unless an editor's question is answered Keep editing. */
function stubLoad(layouts: PersistedWorkspaceLayout[]) {
  const load = vi.fn(async (id: number) => {
    const { editorsHoldChanges, leaveOpenEditors } = await import('../../stores/editor-leave')
    if (editorsHoldChanges() && !(await leaveOpenEditors())) return
    const next = layouts.find((l) => l.id === id)
    if (next) useWorkspaceStore.setState({ activeLayoutId: id, working: next, saved: next })
  })
  useWorkspaceStore.setState({ load: load as never })
  return load
}

beforeEach(() => {
  setActiveTab = vi.fn(() => Promise.resolve())
  setTrackCollapsed = vi.fn(() => Promise.resolve())
  patchTabConfig = vi.fn()
  patchTabViewState = vi.fn()
  useWorkspaceStore.setState({
    setActiveTab: setActiveTab as never,
    setTrackCollapsed: setTrackCollapsed as never,
    patchTabConfig: patchTabConfig as never,
    patchTabViewState: patchTabViewState as never,
  })
})

describe('jumpToReview', () => {
  it('on the open layout: sets the widget’s filter and shows its tab; nothing written to the layout', async () => {
    const open = layout(1, grid([[cell('a', [notes('n'), review('rv')], { activeTabId: 'n' })]], { rows: [{ weight: 1000, collapsed: true }] }))
    useWorkspaceStore.setState({ working: open, saved: open, layouts: [open], activeLayoutId: 1 })
    const load = stubLoad([open])
    expect(reviewJumpAvailable()).toBe(true)
    expect(await jumpToReview(AISHA)).toBe(true)
    expect(useListWidgetStore.getState().reviewFilters.rv).toEqual(AISHA)
    expect(setActiveTab).toHaveBeenCalledWith('rv')
    expect(setTrackCollapsed).toHaveBeenCalledWith(['r1'], false)
    expect(load).not.toHaveBeenCalled()
    expect(patchTabConfig).not.toHaveBeenCalled()
    expect(patchTabViewState).not.toHaveBeenCalled()
  })

  it('replaces what the widget was reviewing, without asking', async () => {
    const open = layout(1, grid([[cell('a', [review('rv')])]]))
    useWorkspaceStore.setState({ working: open, saved: open, layouts: [open], activeLayoutId: 1 })
    useListWidgetStore.getState().setReviewFilter('rv', { expression: { kind: 'tag', id: 3 }, showCompleted: false })
    const ask = vi.spyOn(useUIStore.getState(), 'askConfirmation')
    await jumpToReview(AISHA)
    expect(useListWidgetStore.getState().reviewFilters.rv).toEqual(AISHA)
    expect(ask).not.toHaveBeenCalled()
  })

  it('on another layout: switches to the first one that has a widget, then shows the filter there', async () => {
    const open = layout(1, grid([[cell('a', [notes('n')])]]))
    const second = layout(2, grid([[cell('a', [notes('m')])]]))
    const third = layout(3, grid([[cell('a', [review('rv3')])]]))
    useWorkspaceStore.setState({ working: open, saved: open, layouts: [open, second, third], activeLayoutId: 1 })
    const load = stubLoad([open, second, third])
    expect(await jumpToReview(AISHA)).toBe(true)
    expect(load).toHaveBeenCalledWith(3)
    expect(useWorkspaceStore.getState().activeLayoutId).toBe(3)
    expect(useListWidgetStore.getState().reviewFilters.rv3).toEqual(AISHA)
  })

  it('an editor with changes asks first; Keep editing cancels the jump', async () => {
    const open = layout(1, grid([[cell('a', [notes('n')])]]))
    const other = layout(2, grid([[cell('a', [review('rv2')])]]))
    useWorkspaceStore.setState({ working: open, saved: open, layouts: [open, other], activeLayoutId: 1 })
    stubLoad([open, other])
    const ask = vi.fn(() => Promise.resolve(false))
    const unregister = registerOpenEditor({ changed: () => true, ask })
    expect(await jumpToReview(AISHA)).toBe(false)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(useWorkspaceStore.getState().activeLayoutId).toBe(1)
    expect(useListWidgetStore.getState().reviewFilters.rv2).toBeUndefined()
    unregister()
  })

  it('an editor with changes, Save or Discard: the jump goes on', async () => {
    const open = layout(1, grid([[cell('a', [notes('n')])]]))
    const other = layout(2, grid([[cell('a', [review('rv2')])]]))
    useWorkspaceStore.setState({ working: open, saved: open, layouts: [open, other], activeLayoutId: 1 })
    stubLoad([open, other])
    let changed = true
    const unregister = registerOpenEditor({ changed: () => changed, ask: () => { changed = false; return Promise.resolve(true) } })
    expect(await jumpToReview(AISHA)).toBe(true)
    expect(useListWidgetStore.getState().reviewFilters.rv2).toEqual(AISHA)
    unregister()
  })

  it('on the open layout, an editor with changes asks only when the widget would hide another tab of its cell', async () => {
    const ask = vi.fn(() => Promise.resolve(false))
    const unregister = registerOpenEditor({ changed: () => true, ask })
    const shown = layout(1, grid([[cell('a', [notes('n')]), cell('b', [review('rv')])]]))
    useWorkspaceStore.setState({ working: shown, saved: shown, layouts: [shown], activeLayoutId: 1 })
    expect(await jumpToReview(AISHA)).toBe(true)
    expect(ask).not.toHaveBeenCalled()
    const hidden = layout(1, grid([[cell('a', [notes('n'), review('rv')], { activeTabId: 'n' })]]))
    useWorkspaceStore.setState({ working: hidden, saved: hidden, layouts: [hidden] })
    expect(await jumpToReview({ expression: { kind: 'tag', id: 9 }, showCompleted: false })).toBe(false)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(useListWidgetStore.getState().reviewFilters.rv).toEqual(AISHA)
    unregister()
  })

  it('closes the task dialog and the filtered-tasks panel, which would cover the widget', async () => {
    const open = layout(1, grid([[cell('a', [review('rv')])]]))
    useWorkspaceStore.setState({ working: open, saved: open, layouts: [open], activeLayoutId: 1 })
    useUIStore.setState({ taskDialog: { title: 'Aisha', glyph: 'people', description: '', source: { kind: 'todos', todoIds: [] } }, filterPanelOpen: true })
    await jumpToReview(AISHA)
    expect(useUIStore.getState().taskDialog).toBeNull()
    expect(useUIStore.getState().filterPanelOpen).toBe(false)
  })

  it('no Review widget anywhere: nowhere to go', async () => {
    const open = layout(1, grid([[cell('a', [notes('n')])]]))
    useWorkspaceStore.setState({ working: open, saved: open, layouts: [open], activeLayoutId: 1 })
    expect(reviewJumpAvailable()).toBe(false)
    expect(await jumpToReview(AISHA)).toBe(false)
    expect(useListWidgetStore.getState().reviewFilters).toEqual({})
  })
})
