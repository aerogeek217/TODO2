import { describe, expect, it, vi } from 'vitest'
import { REVIEW_POPUP_TAB_ID } from '../../models/review'
import { createTab, type PersistedWorkspaceLayout } from '../../models/workspace-layout'
import { setTabIgnoresLens } from '../../hooks/use-widget-lens'
import { closeWidgetPopup, openNumberList, openReviewPopup, openWidgetLarger } from '../../services/widget-popup'
import { registerOpenEditor } from '../../stores/editor-leave'
import { useListWidgetStore, type ReviewFilter } from '../../stores/list-widget-store'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { cell, grid } from '../helpers/layout-builders'

/** The widget popup's state (`ui-store.widgetPopup`) and its openings (`services/widget-popup`). */

const AISHA: ReviewFilter = { expression: { kind: 'person', id: 1 }, showCompleted: false }
const T0 = new Date('2026-11-01T09:00:00Z')

function openLayout(): void {
  const layout: PersistedWorkspaceLayout = { id: 1, name: 'Main', sortOrder: 0, createdAt: T0, modifiedAt: T0, ...grid([[cell('a', [createTab('notes', 'n')])]]) }
  useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout], activeLayoutId: 1 })
}

describe('the widget popup', () => {
  it('opens a tab; another opening replaces it; close empties it', async () => {
    expect(await openWidgetLarger('a')).toBe(true)
    expect(useUIStore.getState().widgetPopup).toEqual({ kind: 'tab', tabId: 'a' })
    await openNumberList('n1')
    expect(useUIStore.getState().widgetPopup).toEqual({ kind: 'list', tabId: 'n1' })
    closeWidgetPopup()
    expect(useUIStore.getState().widgetPopup).toBeNull()
  })

  it('an editor with changes asks first: Keep editing opens nothing, Save / Discard opens it', async () => {
    let answer = false
    let changed = true
    const ask = vi.fn(() => { if (answer) changed = false; return Promise.resolve(answer) })
    const unregister = registerOpenEditor({ changed: () => changed, ask })
    expect(await openWidgetLarger('a')).toBe(false)
    expect(useUIStore.getState().widgetPopup).toBeNull()
    answer = true
    expect(await openWidgetLarger('a')).toBe(true)
    expect(ask).toHaveBeenCalledTimes(2)
    expect(useUIStore.getState().widgetPopup).toEqual({ kind: 'tab', tabId: 'a' })
    unregister()
  })

  it('an unchanged editor closes, as Settings closes it', async () => {
    useUIStore.setState({ listEditor: { listDefinitionId: 3, tabId: 'l' }, numberEditorTabId: 'm' })
    await openWidgetLarger('a')
    expect(useUIStore.getState().listEditor).toBeNull()
    expect(useUIStore.getState().numberEditorTabId).toBeNull()
  })
})

describe('the popup review', () => {
  it('takes the filter under its own id; closing keeps it for the next opening', async () => {
    openLayout()
    await openReviewPopup(AISHA)
    expect(useUIStore.getState().widgetPopup).toEqual({ kind: 'review' })
    expect(useListWidgetStore.getState().reviewFilters[REVIEW_POPUP_TAB_ID]).toEqual(AISHA)
    closeWidgetPopup()
    // Another tab's filter set prunes the tabs in no layout — never the popup review's.
    useListWidgetStore.getState().setReviewFilter('gone', AISHA)
    expect(useListWidgetStore.getState().reviewFilters[REVIEW_POPUP_TAB_ID]).toEqual(AISHA)
  })

  it('its lens switch and sort are kept in memory, never written to a layout', () => {
    const patchTabViewState = vi.fn()
    useWorkspaceStore.setState({ patchTabViewState: patchTabViewState as never })
    setTabIgnoresLens({ id: REVIEW_POPUP_TAB_ID, kind: 'review', config: {} }, true)
    expect(useUIStore.getState().popupReviewView).toEqual({ ignoreLens: true })
    useUIStore.getState().patchPopupReviewView({ sort: 'due' })
    expect(useUIStore.getState().popupReviewView).toEqual({ ignoreLens: true, sort: 'due' })
    expect(patchTabViewState).not.toHaveBeenCalled()
  })
})
