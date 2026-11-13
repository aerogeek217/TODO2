import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTab, type LayoutTab, type PersistedWorkspaceLayout } from '../../models/workspace-layout'
import { REVIEW_POPUP_TAB_ID } from '../../models/review'
import { focusReviewWidget, jumpToReview } from '../../services/review-jump'
import { registerOpenEditor } from '../../stores/editor-leave'
import { useListWidgetStore, type ReviewFilter } from '../../stores/list-widget-store'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { resetModuleState } from '../../utils/module-reset'
import { cell, grid } from '../helpers/layout-builders'

/**
 * A Review button's jump: the filter shown in the open layout's first Review
 * widget; without one, in the popup review (the widget popup, no layout
 * switch, an editor with changes asked first). Nothing is written to a layout.
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

  it('another layout has one, the open one none: the popup review takes the filter (no layout switch)', async () => {
    const open = layout(1, grid([[cell('a', [notes('n')])]]))
    const other = layout(3, grid([[cell('a', [review('rv3')])]]))
    useWorkspaceStore.setState({ working: open, saved: open, layouts: [open, other], activeLayoutId: 1 })
    const load = stubLoad([open, other])
    expect(await jumpToReview(AISHA)).toBe(true)
    expect(load).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().activeLayoutId).toBe(1)
    expect(useUIStore.getState().widgetPopup).toEqual({ kind: 'review' })
    expect(useListWidgetStore.getState().reviewFilters[REVIEW_POPUP_TAB_ID]).toEqual(AISHA)
    expect(useListWidgetStore.getState().reviewFilters.rv3).toBeUndefined()
  })

  it('the popup review: an editor with changes asks first; Keep editing opens nothing', async () => {
    const open = layout(1, grid([[cell('a', [notes('n')])]]))
    useWorkspaceStore.setState({ working: open, saved: open, layouts: [open], activeLayoutId: 1 })
    const ask = vi.fn(() => Promise.resolve(false))
    const unregister = registerOpenEditor({ changed: () => true, ask })
    expect(await jumpToReview(AISHA)).toBe(false)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(useUIStore.getState().widgetPopup).toBeNull()
    expect(useListWidgetStore.getState().reviewFilters[REVIEW_POPUP_TAB_ID]).toBeUndefined()
    unregister()
  })

  it('the popup review: Save or Discard, then it opens', async () => {
    const open = layout(1, grid([[cell('a', [notes('n')])]]))
    useWorkspaceStore.setState({ working: open, saved: open, layouts: [open], activeLayoutId: 1 })
    let changed = true
    const unregister = registerOpenEditor({ changed: () => changed, ask: () => { changed = false; return Promise.resolve(true) } })
    expect(await jumpToReview(AISHA)).toBe(true)
    expect(useListWidgetStore.getState().reviewFilters[REVIEW_POPUP_TAB_ID]).toEqual(AISHA)
    unregister()
  })

  it('a second jump replaces what the popup review reviewed', async () => {
    const open = layout(1, grid([[cell('a', [notes('n')])]]))
    useWorkspaceStore.setState({ working: open, saved: open, layouts: [open], activeLayoutId: 1 })
    await jumpToReview(AISHA)
    const tag: ReviewFilter = { expression: { kind: 'tag', id: 3 }, showCompleted: false }
    await jumpToReview(tag)
    expect(useListWidgetStore.getState().reviewFilters[REVIEW_POPUP_TAB_ID]).toEqual(tag)
  })

  it('on the open layout: another widget open larger closes; that widget open larger stays', async () => {
    const open = layout(1, grid([[cell('a', [notes('n')]), cell('b', [review('rv')])]]))
    useWorkspaceStore.setState({ working: open, saved: open, layouts: [open], activeLayoutId: 1 })
    useUIStore.setState({ widgetPopup: { kind: 'tab', tabId: 'n' } })
    await jumpToReview(AISHA)
    expect(useUIStore.getState().widgetPopup).toBeNull()
    useUIStore.setState({ widgetPopup: { kind: 'tab', tabId: 'rv' } })
    await jumpToReview(AISHA)
    expect(useUIStore.getState().widgetPopup).toEqual({ kind: 'tab', tabId: 'rv' })
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

  it('carries the source’s lens switch to the widget’s (F4): written only when it differs, the filter kept without it', async () => {
    const withLens = (ignoreLens: boolean | undefined) => layout(1, grid([[cell('a', [
      { ...createTab('review', 'rv'), ...(ignoreLens == null ? {} : { viewState: { ignoreLens } }) },
    ])]]))
    const open = withLens(undefined)
    useWorkspaceStore.setState({ working: open, saved: open, layouts: [open], activeLayoutId: 1 })
    // A list that ignores the top bar's lens: the widget ignores it too, so it shows the tasks the button counted.
    await jumpToReview({ ...AISHA, ignoreLens: true })
    expect(patchTabViewState).toHaveBeenCalledTimes(1)
    expect(patchTabViewState).toHaveBeenCalledWith('rv', 'review', { ignoreLens: true })
    expect(useListWidgetStore.getState().reviewFilters.rv).toEqual(AISHA)
    // The widget ignores it already: nothing written.
    const ignoring = withLens(true)
    useWorkspaceStore.setState({ working: ignoring, saved: ignoring, layouts: [ignoring] })
    await jumpToReview({ ...AISHA, ignoreLens: true })
    expect(patchTabViewState).toHaveBeenCalledTimes(1)
    // A source that follows the lens puts the widget back on it.
    await jumpToReview({ ...AISHA, ignoreLens: false })
    expect(patchTabViewState).toHaveBeenLastCalledWith('rv', 'review', { ignoreLens: false })
    expect(patchTabViewState).toHaveBeenCalledTimes(2)
    // A source with no switch of its own (a person's menu) leaves the widget's as it is.
    await jumpToReview(AISHA)
    expect(patchTabViewState).toHaveBeenCalledTimes(2)
    expect(patchTabConfig).not.toHaveBeenCalled()
  })

  it('the popup review takes the source’s lens switch in memory (F4)', async () => {
    const open = layout(1, grid([[cell('a', [notes('n')])]]))
    useWorkspaceStore.setState({ working: open, saved: open, layouts: [open], activeLayoutId: 1 })
    await jumpToReview({ ...AISHA, ignoreLens: true })
    expect(useUIStore.getState().popupReviewView).toMatchObject({ ignoreLens: true })
    expect(useListWidgetStore.getState().reviewFilters[REVIEW_POPUP_TAB_ID]).toEqual(AISHA)
    await jumpToReview(AISHA)
    expect(useUIStore.getState().popupReviewView).toMatchObject({ ignoreLens: true })
    await jumpToReview({ ...AISHA, ignoreLens: false })
    expect(useUIStore.getState().popupReviewView).toMatchObject({ ignoreLens: false })
    expect(patchTabViewState).not.toHaveBeenCalled()
  })

  it('no Review widget anywhere: the popup review, the task dialog closed', async () => {
    const open = layout(1, grid([[cell('a', [notes('n')])]]))
    useWorkspaceStore.setState({ working: open, saved: open, layouts: [open], activeLayoutId: 1 })
    useUIStore.setState({ taskDialog: { title: 'Aisha', glyph: 'people', description: '', source: { kind: 'todos', todoIds: [] } } })
    expect(await jumpToReview(AISHA)).toBe(true)
    expect(useUIStore.getState().widgetPopup).toEqual({ kind: 'review' })
    expect(useUIStore.getState().taskDialog).toBeNull()
    expect(patchTabViewState).not.toHaveBeenCalled()
  })
})

describe('focusReviewWidget', () => {
  it('waits for its widget on a timer that a reset drops, so it never outlives its test', () => {
    vi.useFakeTimers()
    try {
      // No such widget on the page: it keeps looking.
      focusReviewWidget('nowhere')
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersByTime(200)
      expect(vi.getTimerCount()).toBe(1)
      // A later call takes its place: still one wait.
      focusReviewWidget('elsewhere')
      expect(vi.getTimerCount()).toBe(1)
      resetModuleState()
      expect(vi.getTimerCount()).toBe(0)
      // Left alone it gives up by itself.
      focusReviewWidget('nowhere')
      vi.advanceTimersByTime(2000)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('finds its widget by a tab id that holds a quote or a backslash (S5: the id is escaped in the selector)', () => {
    vi.useFakeTimers()
    const tabId = 'rv"\\]x'
    const host = document.createElement('div')
    host.setAttribute('data-review-widget', tabId)
    const update = document.createElement('input')
    update.setAttribute('data-review-update', '')
    host.append(update)
    document.body.append(host)
    try {
      focusReviewWidget(tabId)
      expect(() => vi.advanceTimersByTime(100)).not.toThrow()
      expect(update).toHaveFocus()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      host.remove()
      vi.useRealTimers()
    }
  })

  it('gives up quietly when the page is gone by the time it looks', () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', undefined)
    try {
      focusReviewWidget('nowhere')
      expect(() => vi.advanceTimersByTime(100)).not.toThrow()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})
