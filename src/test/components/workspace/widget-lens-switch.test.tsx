import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { WidgetBody } from '../../../components/workspace/WidgetBody'
import { LensSwitch } from '../../../components/shared/LensSwitch'
import { useWidgetMenuContent } from '../../../components/workspace/cell-menu'
import { CellControlsContext, type CellControlsValue } from '../../../components/workspace/cell-controls'
import { checkLayoutBody } from '../../../data/layout-shape'
import { rowFixes, sanitizeRow, validateRow } from '../../../data/import-validation'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import {
  createTab,
  LENS_SWITCH_KINDS,
  tabIgnoresLens,
  type LayoutTab,
  type LensSwitchTab,
  type PersistedWorkspaceLayout,
  type WorkspaceLayout,
} from '../../../models/workspace-layout'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { clearFilterStore, resetEntityStores } from '../../helpers'
import { single } from '../../helpers/layout-builders'
import { ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, Q4, SAMPLE_TASKS, STATUSES, TAGS } from '../../fixtures/glance-sample'
import { layoutSteps } from '../../helpers/layout-steps'

/**
 * One lens switch on every widget the top bar's filter reaches (G3, board
 * BD): stored as the tab's view state (never an unsaved edit), validated
 * in the layout read, drawn at the end of the widget's header, offered in
 * its ⋯ as `Apply lens “X” here`, and its widget's data following it.
 */

const LENS = { id: 'lens-q4', name: 'Q4', predicate: { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: [Q4] } }
const DATE = '2026-09-01T09:00:00.000Z'

function layoutOf(tab: LayoutTab): PersistedWorkspaceLayout {
  return { id: 1, sortOrder: 0, name: 'L', createdAt: new Date(), modifiedAt: new Date(), ...single({ id: 'c', tabs: [tab] }) }
}

function inLayout(tab: LayoutTab) {
  const layout = layoutOf(tab)
  useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout], writeFailed: false, hydrated: true })
}

const live = () => useWorkspaceStore.getState().working!.cells[0]!.tabs[0] as LensSwitchTab

/** The tab as the open layout holds it, drawn by `WidgetBody` at its large face (as a cell does). */
function Live() {
  const tab = useWorkspaceStore((s) => s.working!.cells[0]!.tabs[0])!
  return (
    <WidgetFaceContext.Provider value={{ forced: 'large' }}>
      <WidgetBody tab={tab} />
    </WidgetFaceContext.Provider>
  )
}

/** Alone in its cell: the cell lends its controls (the top line ends with them). */
const CONTROLS: CellControlsValue = {
  cellId: 'c', tabs: [], tabId: 't', title: 'T', touch: false, setMoreButton: () => undefined, menuOpen: false,
  onMore: () => {}, collapsed: false, onExpand: () => {}, claim: () => () => {},
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 10, 10))
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ urgentDueWithinDays: 3, weekStartsOn: 0, lenses: [LENS], activeLensId: null })
  useTodoStore.setState({ todos: SAMPLE_TASKS })
  usePersonStore.setState({ people: PEOPLE, assignedPeopleMap: ASSIGNED_PEOPLE })
  useTagStore.setState({ tags: TAGS, assignedTagsMap: ASSIGNED_TAGS })
  useStatusStore.setState({ statuses: STATUSES })
  useUIStore.setState({ selectedTodoIds: new Set(), selectionScope: null, taskDialog: null, lensLifted: false })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the lens switch in a stored layout (view state)', () => {
  const row = (tab: Record<string, unknown>) => ({ id: 1, name: 'L', sortOrder: 0, createdAt: DATE, modifiedAt: DATE, ...single({ id: 'k', tabs: [tab as unknown as LayoutTab] }) })
  const tabOf = (r: Record<string, unknown>) => (sanitizeRow('layouts', r) as WorkspaceLayout).cells[0]!.tabs[0]!

  it.each(LENS_SWITCH_KINDS)('a %s keeps its ignoreLens; one that is no boolean is dropped (a fix)', (kind) => {
    const fresh = createTab(kind, 't') as unknown as Record<string, unknown>
    const viewState = { ...(fresh.viewState as Record<string, unknown> | undefined), ignoreLens: true }
    const kept = { ...fresh, viewState }
    expect(validateRow('layouts', row(kept))).toBe(true)
    expect(rowFixes('layouts', row(kept))).toEqual([])
    expect(tabOf(row(kept)).viewState).toMatchObject({ ignoreLens: true })
    const bad = row({ ...fresh, viewState: { ignoreLens: 'yes' } })
    expect(checkLayoutBody(bad)).toBe('cells[0].tabs[0].viewState.ignoreLens')
    expect((tabOf(bad).viewState as { ignoreLens?: unknown } | undefined)?.ignoreLens).toBeUndefined()
  })

  it('a Number without its own switch reads its config’s old ignoreLens; its switch wins', () => {
    const fresh = createTab('number', 'n')
    if (fresh.kind !== 'number') throw new Error('a Number')
    const number = { ...fresh, config: { ...fresh.config, ignoreLens: true as const } }
    expect(tabIgnoresLens(fresh)).toBe(false)
    expect(tabIgnoresLens(number)).toBe(true)
    expect(tabIgnoresLens({ ...number, viewState: { ignoreLens: false } })).toBe(false)
    expect(tabIgnoresLens(createTab('calendar', 'c') as LensSwitchTab)).toBe(false)
  })
})

describe('a Breakdown’s switch', () => {
  it('absent with no lens; with one that hides some there, shown at rest with −N at the end of its header; a click ignores the lens there and the rows follow', () => {
    inLayout(createTab('breakdown', 'b', { breakdown: { name: 'People' } }))
    render(<DndContext><CellControlsContext.Provider value={CONTROLS}><Live /></CellControlsContext.Provider></DndContext>)
    expect(screen.queryByTestId('lens-switch')).toBeNull()
    const count = () => screen.getByTestId('glance-section-count').textContent
    const all = count()
    act(() => { useSettingsStore.setState({ activeLensId: LENS.id }) })
    const lensed = count()
    expect(lensed).not.toBe(all)
    const sw = screen.getByTestId('lens-switch')
    // It has an effect here: shown at rest with its `−N` (2A, as restated).
    const hidden = Number.parseInt(all!) - Number.parseInt(lensed!)
    expect(sw).toHaveTextContent(`−${hidden}`)
    expect(sw).not.toHaveAttribute('data-quiet')
    expect(sw).toHaveAttribute('data-lens-hides', String(hidden))
    // At the header's end, just before the cell's controls.
    expect(sw.closest('[data-widget-top-line]')!.lastElementChild?.previousElementSibling?.contains(sw)).toBe(true)
    fireEvent.click(sw)
    expect(live().viewState).toEqual({ ignoreLens: true })
    expect(layoutSteps()).toEqual([])
    expect(count()).toBe(all)
    expect(screen.getByTestId('lens-switch')).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('the calendar’s, the Pivot’s and Project pulse’s', () => {
  it.each([
    ['calendar', createTab('calendar', 'w')],
    ['pivot', createTab('pivot', 'w')],
    ['pulse', createTab('pulse', 'w', { tagIds: [Q4] })],
  ] as const)('a %s shows the switch with a lens and writes its view state', (_kind, tab) => {
    useSettingsStore.setState({ activeLensId: LENS.id })
    inLayout(tab)
    render(<DndContext><Live /></DndContext>)
    // Pulse follows only #q4, which the lens keeps: nothing hidden there — the switch in place, hidden at rest.
    const sw = screen.queryByTestId('lens-switch')
    if (tab.kind === 'pulse') {
      expect(sw).toHaveAttribute('data-quiet')
      expect(sw).toHaveAttribute('data-lens-hides', '0')
      return
    }
    expect(sw).not.toHaveAttribute('data-quiet')
    expect(sw).not.toBeNull()
    expect(sw!.getAttribute('data-lens-hides')).toMatch(/^[1-9]\d*$/)
    fireEvent.click(sw!)
    expect(live().viewState).toMatchObject({ ignoreLens: true })
  })
})

describe('the ⋯ menu’s Apply lens “X” here', () => {
  const actions = (tab: LayoutTab) => renderHook(() => useWidgetMenuContent(tab, { sections: [] })).result.current?.widgetActions ?? []

  it('offered on every lens-switch kind while a lens applies; a click writes the switch', () => {
    for (const kind of LENS_SWITCH_KINDS) {
      const tab = createTab(kind, 't')
      inLayout(tab)
      expect(actions(tab).find((a) => a.label.startsWith('Apply lens'))).toBeUndefined()
      act(() => { useSettingsStore.setState({ activeLensId: LENS.id }) })
      const item = actions(tab).find((a) => a.label === 'Apply lens “Q4” here')
      expect(item?.checked).toBe(true)
      act(() => { item!.onSelect() })
      expect(live().viewState).toMatchObject({ ignoreLens: true })
      expect(actions(live()).find((a) => a.label === 'Apply lens “Q4” here')?.checked).toBe(false)
      act(() => { useSettingsStore.setState({ activeLensId: null }) })
    }
  })

  it('not on Created vs completed, nor a Number following a list (the list’s switch rules there)', () => {
    useSettingsStore.setState({ activeLensId: LENS.id })
    const trend = createTab('trend', 't')
    inLayout(trend)
    expect(actions(trend).find((a) => a.label.startsWith('Apply lens'))).toBeUndefined()
    const fresh = createTab('number', 'n')
    if (fresh.kind !== 'number') throw new Error('a Number')
    const follows: LayoutTab = { ...fresh, config: { ...fresh.config, show: 'list' } }
    inLayout(follows)
    expect(actions(follows).find((a) => a.label.startsWith('Apply lens'))).toBeUndefined()
  })
})

describe('the Eisenhower’s and the Neglect map’s', () => {
  it('alone in their cell, on their name line; in a cell of several, the Neglect map’s floats over its corner', () => {
    useSettingsStore.setState({ activeLensId: LENS.id })
    inLayout(createTab('neglect', 'w'))
    const { unmount } = render(<DndContext><CellControlsContext.Provider value={CONTROLS}><Live /></CellControlsContext.Provider></DndContext>)
    const line = screen.getByTestId('neglect-line-slipping').closest('[data-widget-top-line]') as HTMLElement
    expect(within(line).getByTestId('lens-switch')).not.toBeNull()
    unmount()
    render(<DndContext><Live /></DndContext>)
    expect(screen.getByTestId('lens-switch').closest('[data-neglect-map]')).not.toBeNull()
  })
})

describe('the quiet switch (UX cleanup 2A)', () => {
  const on = { name: 'Mine', ignored: false, hides: 4 }
  it('quiet, following the lens and hiding some here: shown at rest with its −N (it has an effect)', () => {
    render(<LensSwitch lens={on} onToggle={() => {}} quiet />)
    const sw = screen.getByTestId('lens-switch')
    expect(sw).toHaveTextContent('−4')
    expect(sw).not.toHaveAttribute('data-quiet')
    expect(sw).toHaveAttribute('data-lens-hides', '4')
  })

  it('quiet, following the lens and hiding nothing here: hidden at rest, its −0 kept for its room', () => {
    render(<LensSwitch lens={{ ...on, hides: 0 }} onToggle={() => {}} quiet />)
    const sw = screen.getByTestId('lens-switch')
    expect(sw).toHaveAttribute('data-quiet')
    expect(sw).toHaveTextContent('−0')
  })

  it('quiet but ignoring the lens: never hidden (the slashed glasses are the exception it flags)', () => {
    render(<LensSwitch lens={{ ...on, ignored: true, hides: 0 }} onToggle={() => {}} quiet />)
    expect(screen.getByTestId('lens-switch')).not.toHaveAttribute('data-quiet')
  })

  it('not quiet (the review deck, an editor, the phone): its −N on it, always shown', () => {
    render(<LensSwitch lens={on} onToggle={() => {}} />)
    const sw = screen.getByTestId('lens-switch')
    expect(sw).toHaveTextContent('−4')
    expect(sw).not.toHaveAttribute('data-quiet')
  })
})