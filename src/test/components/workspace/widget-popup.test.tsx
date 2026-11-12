import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, within, screen, act } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { WorkspaceCell } from '../../../components/workspace/WorkspaceCell'
import { WidgetPopupHost } from '../../../components/workspace/WidgetPopup'
import { emptyPredicate } from '../../../models'
import { createTab, type LayoutBody, type LayoutCell, type NumberTab, type PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { openReviewPopup, openWidgetLarger } from '../../../services/widget-popup'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { makeTodo, resetEntityStores } from '../../helpers'
import { cell, grid, single, type CellSpec } from '../../helpers/layout-builders'

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

describe('a Number’s Open larger', () => {
  const number = (config: Partial<NumberTab['config']>): NumberTab => {
    const tab = createTab('number', 'num')
    return { ...tab, config: { ...tab.config, ...config } }
  }
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
