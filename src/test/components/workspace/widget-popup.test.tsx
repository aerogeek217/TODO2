import { useLayoutEffect } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, within, screen, act } from '@testing-library/react'
import { DndContext, useDndContext } from '@dnd-kit/core'
import { WorkspaceCell } from '../../../components/workspace/WorkspaceCell'
import { WidgetPopupHost } from '../../../components/workspace/WidgetPopup'
import { backupScheduler } from '../../../data/backup-scheduler'
import { emptyPredicate } from '../../../models'
import { createTab, type LayoutBody, type LayoutCell, type NumbersTab, type PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import type { NumberItem } from '../../../models/glance-widgets'
import { replaceData } from '../../../services/replace-data'
import { openNumberList, openReviewPopup, openWidgetLarger } from '../../../services/widget-popup'
import { listTabZoom } from '../../../services/list-zoom'
import { registerOpenEditor } from '../../../stores/editor-leave'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { makeTodo, resetEntityStores } from '../../helpers'
import { cell, grid, single, type CellSpec, freshNumberTab, numberItem, numbersTab, numberWidgetId } from '../../helpers/layout-builders'

/**
 * The widget popup (Open larger): its host follows the open layout's tab, its
 * header's ⋯ holds only the widget's own entries, a Number offers it only
 * where its large face adds something, and the popup review stands alone.
 */

const AT = new Date(2026, 0, 1)
const listTab = { id: 'l', kind: 'lens' as const, config: { listDefinitionId: 7 } }

function open(body: LayoutBody): void {
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'Main', createdAt: AT, modifiedAt: AT, ...body }
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, writeFailed: false, hydrated: true })
}

function placed(spec: CellSpec): LayoutCell {
  const c = useWorkspaceStore.getState().working?.cells.find((x) => x.id === spec.id)
  if (!c) throw new Error(`no cell ${spec.id}`)
  return c
}

function renderCell(c: CellSpec) {
  return render(
    <DndContext>
      <WorkspaceCell cell={placed(c)} rowTrackIds={['r1']} collapsed={false} />
      <WidgetPopupHost />
    </DndContext>,
  )
}

const popup = () => document.querySelector<HTMLElement>('[data-testid="widget-popup"]')
const labels = (menu: HTMLElement) => Array.from(menu.querySelectorAll('[role^="menuitem"]')).map((el) => el.getAttribute('data-menu-label'))

function stubSize(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height)
}

beforeEach(() => {
  resetEntityStores()
  useListDefinitionStore.setState({
    listDefinitions: [{
      id: 7, name: 'Team', sortOrder: 0, owner: { layoutId: 1 },
      membership: { kind: 'custom', predicate: emptyPredicate() }, sort: 'manual', grouping: 'none',
    }],
  })
  useTodoStore.setState({ todos: [makeTodo({ id: 1, title: 'One', sortOrder: 1 })] })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the widget popup', () => {
  it('shows the tab at its large face, named by its title; its ⋯ holds the widget’s own entries only', () => {
    stubSize(400, 400)
    const k = cell('k', [listTab])
    open(single(k))
    renderCell(k)
    act(() => { void openWidgetLarger('l') })
    const dialog = popup()!
    expect(dialog.getAttribute('aria-label')).toBe('Team')
    expect(dialog.getAttribute('role')).toBe('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Widget options' }))
    const items = labels(screen.getByRole('menu', { name: 'Widget options' }))
    expect(items).toContain('Edit list…')
    expect(items).not.toContain('Open larger')
    expect(items).not.toContain('Change widget')
    expect(items).not.toContain('Add widget…')
    expect(items).not.toContain('Split cell')
  })

  it('a layout switch (the tab gone) closes it', () => {
    stubSize(400, 400)
    const k = cell('k', [listTab])
    open(single(k))
    renderCell(k)
    act(() => { void openWidgetLarger('l') })
    expect(popup()).not.toBeNull()
    act(() => { open(grid([[cell('z', [createTab('notes', 'other')])]])) })
    expect(popup()).toBeNull()
  })
})

// ── One live widget per tab (cr34 H1 / T1) ──

/** dnd-kit's registry, as the page's one `DndContext` holds it. */
let dnd: ReturnType<typeof useDndContext> | null = null
function DndProbe() {
  const context = useDndContext()
  useLayoutEffect(() => { dnd = context })
  return null
}
const draggableIds = () => [...(dnd?.draggableNodes.keys() ?? [])].map(String).sort()
const rowIds = () => draggableIds().filter((id) => id.startsWith('lw|'))
const dayTargetIds = () => (dnd?.droppableContainers.toArray() ?? []).map((c) => String(c.id)).filter((id) => id.startsWith('calday-'))

/** The cells (side by side) and the popup's host in one `DndContext`, as on the workspace page. */
function renderCells(...cells: CellSpec[]) {
  open(grid([cells]))
  return render(
    <DndContext>
      <DndProbe />
      {cells.map((c) => <WorkspaceCell key={c.id} cell={placed(c)} rowTrackIds={['r1']} collapsed={false} />)}
      <WidgetPopupHost />
    </DndContext>,
  )
}

const cellEl = (id: string) => document.querySelector<HTMLElement>(`[data-ws-cell="${id}"]`)!
const bodyOf = (id: string) => document.querySelector<HTMLElement>(`[data-ws-cell-body="${id}"]`)!
const placeholderIn = (id: string) => cellEl(id).querySelector<HTMLElement>('[data-open-larger-placeholder]')
const closePopup = () => act(() => { useUIStore.getState().closeWidgetPopup() })

describe('closing the popup over an editor opened from it that holds changes', () => {
  function openList() {
    const k = cell('k', [listTab])
    open(single(k))
    renderCell(k)
    act(() => { void openWidgetLarger('l') })
  }
  const WAYS: Array<[name: string, close: () => void]> = [
    ['its ×', () => fireEvent.click(within(popup()!).getByRole('button', { name: 'Close' }))],
    ['Esc', () => fireEvent.keyDown(popup()!, { key: 'Escape' })],
    ['a press on its scrim', () => {
      const scrim = document.querySelector('[data-modal-backdrop]')!
      fireEvent.mouseDown(scrim)
      fireEvent.mouseUp(scrim)
      fireEvent.click(scrim)
    }],
  ]

  it.each(WAYS)('%s asks first: Keep editing keeps the popup, Save or Discard then closes it', async (_name, close) => {
    openList()
    let answer = false
    let changed = true
    const ask = vi.fn(() => { if (answer) changed = false; return Promise.resolve(answer) })
    const unregister = registerOpenEditor({ changed: () => changed, ask })
    close()
    await act(async () => {})
    expect(ask).toHaveBeenCalledTimes(1)
    expect(popup()).not.toBeNull()
    answer = true
    close()
    await act(async () => {})
    expect(ask).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(popup()).toBeNull())
    unregister()
  })

  it.each(WAYS)('%s with no editor holding changes closes it in the same tick, asking nothing', (_name, close) => {
    openList()
    const ask = vi.fn(() => Promise.resolve(false))
    const unregister = registerOpenEditor({ changed: () => false, ask })
    close()
    expect(useUIStore.getState().widgetPopup).toBeNull()
    expect(ask).not.toHaveBeenCalled()
    unregister()
  })
})

describe('one live widget per tab: the cell shows a placeholder while its tab is open larger', () => {
  beforeEach(() => { useSettingsStore.setState({ showWidgetNames: true }) })

  it('a list: its rows are in the popup only, the cell names it as open larger; closed, the cell’s list is back', () => {
    renderCells(cell('k', [listTab]))
    expect(document.querySelectorAll('[data-list-host="l"]')).toHaveLength(1)
    act(() => { void openWidgetLarger('l') })
    const lists = document.querySelectorAll('[data-list-host="l"]')
    expect(lists).toHaveLength(1)
    expect(popup()!.contains(lists[0]!)).toBe(true)
    expect(placeholderIn('k')?.getAttribute('data-open-larger-placeholder')).toBe('l')
    expect(placeholderIn('k')?.textContent).toContain('“Team” is open larger')
    // Alone in its cell, the placeholder keeps a top line: the tab's name and the cell's controls.
    expect(cellEl('k').querySelector('[data-widget-top-line][data-ws-tab="l"]')?.textContent).toContain('Team')
    expect(cellEl('k').querySelector('[data-cell-controls] button[aria-label="Cell options"]')).not.toBeNull()
    closePopup()
    expect(popup()).toBeNull()
    expect(placeholderIn('k')).toBeNull()
    expect(cellEl('k').querySelectorAll('[data-list-host="l"]')).toHaveLength(1)
  })

  it('a list’s rows are registered draggables again after the popup closes (the dead drag)', () => {
    renderCells(cell('k', [listTab]))
    expect(rowIds()).toEqual(['lw|l|all|1'])
    // No grip outside the layout edit mode (E4): nothing drags the cell.
    expect(draggableIds()).not.toContain('ws-panel:k')
    act(() => { void openWidgetLarger('l') })
    expect(rowIds()).toEqual(['lw|l|all|1'])
    // The registered node is the popup's row, not one left behind by the cell.
    expect(popup()!.contains(dnd!.draggableNodes.get('lw|l|all|1')!.node.current)).toBe(true)
    closePopup()
    expect(rowIds()).toEqual(['lw|l|all|1'])
    expect(cellEl('k').contains(dnd!.draggableNodes.get('lw|l|all|1')!.node.current)).toBe(true)
  })

  it('a calendar’s days are drop targets and its entries draggables again after the popup closes', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 14, 10))
    try {
      useTodoStore.setState({ todos: [makeTodo({ id: 1, title: 'One', dueDate: new Date(2026, 9, 16), sortOrder: 1 })] })
      const cal = { ...createTab('calendar', 'cal'), viewState: { titles: true } }
      renderCells(cell('k', [cal]))
      const days = dayTargetIds().length
      expect(days).toBeGreaterThan(27)
      expect(draggableIds()).toContain('cw|cal|due|1')
      act(() => { void openWidgetLarger('cal') })
      expect(dayTargetIds()).toHaveLength(days)
      expect(document.querySelectorAll('[data-calendar-widget="cal"]')).toHaveLength(1)
      closePopup()
      expect(dayTargetIds()).toHaveLength(days)
      expect(draggableIds()).toContain('cw|cal|due|1')
      expect(cellEl('k').querySelectorAll('[data-calendar-widget="cal"]')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  const kinds = ['lens', 'calendar', 'notes', 'review', 'neglect', 'numbers', 'trend', 'breakdown', 'pivot'] as const
  it.each(kinds)('a %s tab: only the placeholder in the cell’s body while it is open larger', (kind) => {
    // A Number opens larger under its own id (the widget holds it).
    const tab = kind === 'lens' ? listTab : kind === 'numbers' ? numbersTab('nw', [numberItem('w', 'open', { breakdown: 'people' })]) : createTab(kind, 'w')
    const id = kind === 'numbers' ? 'w' : tab.id
    renderCells(cell('k', [tab]))
    const before = bodyOf('k').innerHTML
    expect(placeholderIn('k')).toBeNull()
    act(() => { void openWidgetLarger(id) })
    expect(popup()).not.toBeNull()
    const shown = [...bodyOf('k').children].filter((el) => !el.hasAttribute('data-face-opener'))
    expect(shown).toHaveLength(1)
    expect(shown[0]?.getAttribute('data-open-larger-placeholder')).toBe(id)
    closePopup()
    expect(placeholderIn('k')).toBeNull()
    expect(bodyOf('k').innerHTML).toBe(before)
  })

  it('in a cell of several widgets the strip names it: the placeholder has no top line', () => {
    renderCells(cell('k', [listTab, createTab('notes', 'n')], { activeTabId: 'l' }))
    act(() => { void openWidgetLarger('l') })
    expect(placeholderIn('k')?.textContent).toBe('“Team” is open larger')
    expect(placeholderIn('k')?.querySelector('[data-widget-top-line]')).toBeNull()
    expect(cellEl('k').querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('Team')
  })

  it('a tab out of sight (not its cell’s active one) open larger: the cell keeps its active widget', () => {
    renderCells(cell('k', [listTab, createTab('notes', 'n')], { activeTabId: 'n' }))
    act(() => { void openWidgetLarger('l') })
    expect(popup()!.querySelector('[data-list-host="l"]')).not.toBeNull()
    expect(placeholderIn('k')).toBeNull()
  })

  it('the placeholder tells the cell its face as it resizes, so the cell’s face follows while its widget is away', () => {
    const resized: Array<(entries: unknown[]) => void> = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: (entries: unknown[]) => void) { resized.push(callback) }
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    try {
      let width = 140
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => 600)
      renderCells(cell('k', [listTab]))
      // 140px wide: the small face, with its keyboard opener.
      expect(cellEl('k').getAttribute('data-face')).toBe('small')
      act(() => { void openWidgetLarger('l') })
      expect(cellEl('k').getAttribute('data-face')).toBe('small')
      // Small: one line, no top line of its own.
      expect(placeholderIn('k')?.querySelector('[data-widget-top-line]')).toBeNull()
      width = 400
      act(() => { for (const notify of resized) notify([]) })
      expect(cellEl('k').getAttribute('data-face')).toBe('large')
      expect(placeholderIn('k')?.querySelector('[data-widget-top-line]')).not.toBeNull()
      expect(cellEl('k').querySelector('[data-face-opener]')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('the popup review has no cell: every cell keeps its widget', async () => {
    renderCells(cell('k', [listTab]), cell('r', [createTab('review', 'rv')]))
    await act(async () => { await openReviewPopup(null) })
    expect(popup()).not.toBeNull()
    expect(placeholderIn('k')).toBeNull()
    expect(placeholderIn('r')).toBeNull()
    expect(draggableIds()).toContain('lw|l|all|1')
  })

  it('a data replace with the popup open closes it, and the cell’s widget is back', async () => {
    vi.spyOn(backupScheduler, 'snapshotBeforeDestructive').mockResolvedValue(undefined as never)
    renderCells(cell('k', [listTab]))
    act(() => { void openWidgetLarger('l') })
    expect(placeholderIn('k')).not.toBeNull()
    await act(async () => { await replaceData('audit-cleanup', { backup: 'best-effort', write: async () => {} }) })
    expect(useUIStore.getState().widgetPopup).toBeNull()
    expect(popup()).toBeNull()
    expect(placeholderIn('k')).toBeNull()
  })
})

describe('the list a Number follows, open larger (the popup’s `list` kind)', () => {
  const following = (): NumbersTab => numbersTab(numberWidgetId('num'), [{ ...freshNumberTab('num').config.items[0]!, show: 'list', list: { listDefinitionId: 7 } }])

  it('shows the list as a list tab of the Number’s id; the Number’s cell keeps its Number', async () => {
    renderCells(cell('k', [following()]))
    await act(async () => { await openNumberList('num') })
    const dialog = popup()!
    expect(dialog.getAttribute('aria-label')).toBe('Team')
    expect(dialog.querySelector('[data-list-host="num"]')).not.toBeNull()
    expect(within(dialog).getByText('One')).toBeInTheDocument()
    expect(placeholderIn('k')).toBeNull()
    expect(cellEl('k').querySelector('[data-glance]')).not.toBeNull()
  })

  it('beside that list’s own tab: two widgets under two tab ids, so the tab’s rows stay registered after the popup closes', async () => {
    renderCells(cell('k', [following()]), cell('m', [listTab]))
    expect(rowIds()).toEqual(['lw|l|all|1'])
    await act(async () => { await openNumberList('num') })
    // The same list twice, each row under its own widget's tab id.
    expect(rowIds()).toEqual(['lw|l|all|1', 'lw|num|all|1'])
    expect(placeholderIn('m')).toBeNull()
    closePopup()
    expect(rowIds()).toEqual(['lw|l|all|1'])
    expect(cellEl('m').contains(dnd!.draggableNodes.get('lw|l|all|1')!.node.current)).toBe(true)
  })

  // cr34 U3: the list's view state can't be written to the layout's tab of that id — it is a Number.
  const popupList = () => popup()!.querySelector<HTMLElement>('[data-list-host="num"]')!
  const zoomMenu = () => {
    fireEvent.click(within(popup()!).getByRole('button', { name: 'Widget options' }))
    return screen.getByRole('menu', { name: 'Widget options' })
  }
  const ctrlWheel = (el: Element, deltaY: number) => act(() => {
    el.dispatchEvent(new WheelEvent('wheel', { deltaY, ctrlKey: true, cancelable: true, bubbles: true }))
  })

  it('its ⋯ menu’s Zoom − / + step the level the list shows, and the stepper follows', async () => {
    renderCells(cell('k', [following()]))
    await act(async () => { await openNumberList('num') })
    expect(popupList().getAttribute('data-zoom')).toBe('rows')
    const menu = zoomMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Zoom out' }))
    expect(popupList().getAttribute('data-zoom')).toBe('lines')
    // The menu stays open on the new level: Lines is the end, so − is off.
    expect(within(menu).getByText('Lines')).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Zoom out' })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Zoom in' }))
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Zoom in' }))
    expect(popupList().getAttribute('data-zoom')).toBe('stacked')
    // Nothing was written to the layout: the Number's tab is as it was.
    expect(useWorkspaceStore.getState().working?.cells[0]?.tabs[0]).toEqual(following())
  })

  it('Ctrl + wheel over the list steps its zoom', async () => {
    renderCells(cell('k', [following()]))
    await act(async () => { await openNumberList('num') })
    ctrlWheel(popupList(), 100)
    expect(popupList().getAttribute('data-zoom')).toBe('lines')
    ctrlWheel(popupList(), -100)
    expect(popupList().getAttribute('data-zoom')).toBe('rows')
  })

  it('the row details divider moves; the width and the level last while the workspace is open', async () => {
    // A task with a due date: a list whose tasks use no detail field has no columns and no divider (flair P8).
    useTodoStore.setState({ todos: [makeTodo({ id: 1, title: 'One', dueDate: new Date(2026, 9, 16), sortOrder: 1 })] })
    renderCells(cell('k', [following()]))
    await act(async () => { await openNumberList('num') })
    const divider = () => within(popup()!).getByRole('separator', { name: 'Resize task names and details' })
    const before = Number(divider().getAttribute('aria-valuenow'))
    fireEvent.keyDown(divider(), { key: 'ArrowLeft' })
    const after = Number(divider().getAttribute('aria-valuenow'))
    expect(after).toBeGreaterThan(before)
    // Closed and opened again: the same list at the same width.
    closePopup()
    await act(async () => { await openNumberList('num') })
    expect(Number(divider().getAttribute('aria-valuenow'))).toBe(after)
    // A data replace drops what was held (another data set's tab could share the id).
    vi.spyOn(backupScheduler, 'snapshotBeforeDestructive').mockResolvedValue(undefined as never)
    await act(async () => { await replaceData('audit-cleanup', { backup: 'best-effort', write: async () => {} }) })
    expect(popup()).toBeNull()
  })

  it('a list tab’s own popup still writes its zoom to the tab (view state)', () => {
    renderCells(cell('k', [listTab]))
    act(() => { void openWidgetLarger('l') })
    ctrlWheel(popup()!.querySelector('[data-list-host="l"]')!, 100)
    expect(useWorkspaceStore.getState().working?.cells[0]?.tabs[0]).toMatchObject({ id: 'l', viewState: { zoom: 'lines' } })
  })
})

describe('the level a list shows, for the zoom controls (cr34 U4)', () => {
  /** A cell 300px wide (Auto: Stacked), the popup 1200px (Auto: Rows). */
  function stubWidths() {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const width = this.closest('[data-testid="widget-popup"]') ? 1200 : 300
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 400, width, height: 400, toJSON: () => ({}) }
    })
  }

  it('is the cell’s again once the popup closes: the next step starts from the level on screen', () => {
    useSettingsStore.setState({ listZoom: 'auto' })
    stubWidths()
    renderCells(cell('k', [listTab]))
    const shown = () => useListWidgetStore.getState().zoom.l
    expect(shown()).toBe('stacked')
    act(() => { void openWidgetLarger('l') })
    // The popup's list is the tab's one widget: the level is the popup's.
    expect(shown()).toBe('rows')
    closePopup()
    expect(shown()).toBe('stacked')
    expect(cellEl('k').querySelector('[data-list-host="l"]')?.getAttribute('data-zoom')).toBe('stacked')
    expect(listTabZoom(listTab)).toBe('stacked')
  })
})

describe('a Number’s Open larger', () => {
  const number = (config: Partial<NumberItem>): NumbersTab => numbersTab(numberWidgetId('num'), [{ ...freshNumberTab('num').config.items[0]!, ...config }])
  const slotButtons = () => Array.from(document.querySelectorAll('[data-cell-controls] button')).map((b) => b.getAttribute('aria-label'))

  it('a plain count has none', () => {
    stubSize(400, 120)
    const k = cell('k', [number({})])
    open(single(k))
    renderCell(k)
    expect(slotButtons()).not.toContain('Open larger')
  })

  it('a count with a breakdown has it at its medium face', () => {
    stubSize(400, 120)
    const k = cell('k', [number({ breakdown: 'people' })])
    open(single(k))
    renderCell(k)
    expect(slotButtons()).toContain('Open larger')
  })
})

describe('the popup review', () => {
  it('a Review widget tied to no layout tab, named Review', async () => {
    open(single(cell('k', [createTab('notes', 'n')])))
    render(<DndContext><WidgetPopupHost /></DndContext>)
    await act(async () => { await openReviewPopup(null) })
    const dialog = popup()!
    expect(dialog.getAttribute('aria-label')).toBe('Review')
    expect(within(dialog).getByText('Pick who or what to review')).toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(useUIStore.getState().widgetPopup).toBeNull()
  })
})
