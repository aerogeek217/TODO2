import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { WorkspaceCell } from '../../../components/workspace/WorkspaceCell'
import { createTab, type LayoutBody, type LayoutCell, type PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { resetEntityStores } from '../../helpers'
import { cell, single, type CellSpec, freshNumberTab } from '../../helpers/layout-builders'

/**
 * A cell of only Numbers draws them as one strip (flair P10): side by side,
 * no tab strip, each with its own ⋯ and ×; a + adds one. A Number beside
 * another kind keeps the tab strip.
 */

const AT = new Date(2026, 0, 1)

function open(body: LayoutBody): void {
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'Main', createdAt: AT, modifiedAt: AT, ...body }
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, writeFailed: false, hydrated: true })
}

const placed = (id: string): LayoutCell => useWorkspaceStore.getState().working!.cells.find((c) => c.id === id)!

function show(spec: CellSpec) {
  open(single(spec))
  const view = render(<DndContext><WorkspaceCell cell={placed(spec.id)} rowTrackIds={['r1']} collapsed={false} /></DndContext>)
  // Rendered again from the store after an edit.
  const refresh = () => view.rerender(<DndContext><WorkspaceCell cell={placed(spec.id)} rowTrackIds={['r1']} collapsed={false} /></DndContext>)
  return { refresh }
}

const slots = () => [...document.querySelectorAll<HTMLElement>('[data-number-slot]')]
/** The Numbers cell `id` holds as stored, in order (v90: in its Numbers widgets). */
const numberIds = (id: string) => placed(id).tabs.flatMap((t) => (t.kind === 'numbers' ? t.config.items.map((item) => item.id) : []))

beforeEach(() => resetEntityStores())
afterEach(cleanup)

describe('a Numbers strip', () => {
  it('two Numbers: one strip of two slots, no tab strip', () => {
    show(cell('k', [freshNumberTab('a'), freshNumberTab('b')]))
    expect(document.querySelector('[data-number-strip="k"]')).not.toBeNull()
    expect(slots().map((s) => s.dataset.numberSlot)).toEqual(['a', 'b'])
    expect(document.querySelector('[data-ws-cell-header]')).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('a Number beside another kind keeps the tab strip', () => {
    show(cell('k', [freshNumberTab('a'), createTab('notes', 'n')]))
    expect(document.querySelector('[data-number-strip]')).toBeNull()
    expect(document.querySelector('[data-ws-cell-header]')).not.toBeNull()
  })

  it('+ adds a Number at the end; a slot’s × closes its own tab', () => {
    const { refresh } = show(cell('k', [freshNumberTab('a'), freshNumberTab('b')]))
    fireEvent.click(screen.getByRole('button', { name: 'Add number' }))
    refresh()
    // One Numbers widget of the three.
    expect(placed('k').tabs.map((t) => t.kind)).toEqual(['numbers'])
    expect(numberIds('k')).toHaveLength(3)
    expect(slots()).toHaveLength(3)
    const first = slots()[0]!
    fireEvent.click(within(first).getByRole('button', { name: /^Remove/ }))
    refresh()
    expect(numberIds('k')).not.toContain('a')
    expect(slots()).toHaveLength(2)
  })

  it('each slot’s ⋯ opens that Number’s own menu', () => {
    show(cell('k', [freshNumberTab('a'), freshNumberTab('b')]))
    fireEvent.click(within(slots()[1]!).getByRole('button', { name: 'Cell options' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: /Edit number/ })).toBeInTheDocument()
  })

  it('a Number’s ⋯ has no Add number beside (the strip’s + adds one)', () => {
    show(cell('k', [freshNumberTab('a')]))
    fireEvent.click(screen.getByRole('button', { name: 'Cell options' }))
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: /Add number beside/ })).toBeNull()
  })

  it('no card ⋯ outside the layout edit mode; the + stays', () => {
    show(cell('k', [freshNumberTab('a'), freshNumberTab('b')]))
    expect(screen.queryByRole('button', { name: 'Cell layout' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add number' })).toBeInTheDocument()
  })

  it('in the mode the strip is a card: one card ⋯ (not a Number’s), its surface, its Numbers still draggable slots; no grip', () => {
    useWorkspaceStore.setState({ editing: { layoutId: 1, selectedCellId: null, undo: [], redo: [], createdLists: [] } })
    show(cell('k', [freshNumberTab('a'), freshNumberTab('b')]))
    const more = screen.getByRole('button', { name: 'Cell layout' })
    expect(more.closest('[data-number-slot]')).toBeNull()
    expect(document.querySelector('[data-edit-surface="k"]')).not.toBeNull()
    expect(slots()).toHaveLength(2)
    expect(screen.queryByTestId('ws-cell-grip')).toBeNull()
  })

  it('a strip’s Number’s ⋯ Remove widget closes that Number alone', () => {
    const { refresh } = show(cell('k', [freshNumberTab('a'), freshNumberTab('b'), freshNumberTab('c')]))
    fireEvent.click(within(slots()[1]!).getByRole('button', { name: 'Cell options' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Remove widget' }))
    refresh()
    expect(numberIds('k')).toEqual(['a', 'c'])

  })
})
