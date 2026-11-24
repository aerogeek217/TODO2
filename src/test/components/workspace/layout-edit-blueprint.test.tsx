import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { WorkspaceView } from '../../../components/workspace/WorkspaceView'
import { createTab, type LayoutBody, type PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { resetEntityStores } from '../../helpers'
import { cell, grid } from '../../helpers/layout-builders'

/**
 * The layout edit mode's cards: each a blueprint (its widget's icon, name
 * and kind) unless the mode bar's Content toggle shows the widgets. Around
 * the selection, its edge tabs, its neighbours' merge buttons and its
 * toolbar draw an edit before it is made (`structurePreview`) — the new
 * empty cells, the cells that stretch, a merged cell — and make it.
 */

const AT = new Date(2026, 0, 1)

function open(body: LayoutBody): void {
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'Main', createdAt: AT, modifiedAt: AT, ...body }
  useWorkspaceStore.setState({
    layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, writeFailed: false, hydrated: true,
    editing: { layoutId: 1, selectedCellId: null, undo: [], redo: [], createdLists: [] },
  })
}

function view() {
  const layout = useWorkspaceStore.getState().working!
  return render(<DndContext><WorkspaceView layout={layout as PersistedWorkspaceLayout} /></DndContext>)
}

/** Renders again with the store's working layout (the page passes it). */
function rerenderWith(r: ReturnType<typeof view>): void {
  const layout = useWorkspaceStore.getState().working!
  r.rerender(<DndContext><WorkspaceView layout={layout as PersistedWorkspaceLayout} /></DndContext>)
}

/** Selects cell `id` and draws the table again. */
function select(r: ReturnType<typeof view>, id: string): void {
  act(() => useWorkspaceStore.getState().selectEditCell(id))
  rerenderWith(r)
}

beforeEach(() => {
  resetEntityStores()
  // a | b
  // a | c
  const a = cell('a', [createTab('notes', 'ta')])
  const b = cell('b', [createTab('calendar', 'tb')])
  const c = cell('c', [createTab('trend', 'tc')])
  open(grid([[a, b], [a, c]]))
})

afterEach(() => cleanup())

describe('the layout edit mode’s blueprint cards', () => {
  it('names each card by its widget and kind, its content hidden — until Content shows it', () => {
    const r = view()
    const card = document.querySelector('[data-ws-cell="a"]')!
    expect(card).toHaveAttribute('data-blueprint')
    expect(card.querySelector('[data-edit-blueprint]')).toHaveTextContent('Notes')
    act(() => useWorkspaceStore.getState().setEditContent(true))
    rerenderWith(r)
    expect(document.querySelector('[data-ws-cell="a"]')).not.toHaveAttribute('data-blueprint')
    expect(document.querySelector('[data-edit-blueprint]')).toBeNull()
  })
})

describe('the headers', () => {
  it('a header per track, the selected card’s lit', () => {
    const r = view()
    expect(document.querySelectorAll('[data-ruler]')).toHaveLength(4)
    expect(document.querySelectorAll('[data-lit]')).toHaveLength(0)
    select(r, 'a')
    // a: column A, rows 1 and 2.
    expect([...document.querySelectorAll<HTMLElement>('[data-lit]')].map((el) => el.dataset.ruler)).toEqual(['columns:0', 'rows:0', 'rows:1'])
    // No "+" anywhere.
    expect(screen.queryByRole('button', { name: /^Insert (row|column) here$/ })).toBeNull()
  })
})

describe('the selection’s edge tabs', () => {
  it('four around the selection, a slot’s too; none without a selection', () => {
    const r = view()
    expect(document.querySelectorAll('[data-edge-tab]')).toHaveLength(0)
    select(r, 'c')
    expect(['Insert row above', 'Insert row below', 'Insert column left', 'Insert column right'].map((name) => screen.getByRole('button', { name }).textContent))
      .toEqual(['+Row above', '+Row below', '+Column left', '+Column right'])
    act(() => { useWorkspaceStore.getState().removeWidget('tc') })
    rerenderWith(r)
    expect(useWorkspaceStore.getState().editing?.selectedCellId).toBe('c')
    expect(document.querySelectorAll('[data-edge-tab]')).toHaveLength(4)
    // A slot has no toolbar and offers no merge.
    expect(document.querySelector('[data-edit-toolbar]')).toBeNull()
    expect(document.querySelectorAll('[data-merge-button]')).toHaveLength(0)
  })

  it('follow the selected card in the Tab order', () => {
    const r = view()
    select(r, 'b')
    const order = [...document.querySelectorAll<HTMLElement>('[data-edit-surface], [data-edge-tab], [data-merge-button]')]
      .map((el) => el.dataset.editSurface ?? el.dataset.edgeTab ?? `merge:${el.dataset.mergeButton}`)
    expect(order).toEqual(['a', 'b', 'top', 'bottom', 'left', 'right', 'merge:c', 'c'])
  })

  it('hovered, one draws the new row’s slot and the card that stretches; leaving puts the table back; a click inserts and selects the new slot', () => {
    const r = view()
    select(r, 'b')
    const below = screen.getByRole('button', { name: 'Insert row below' })
    // Only on a move: an edge tab appearing under a resting pointer draws nothing.
    fireEvent.mouseEnter(below)
    expect(useWorkspaceStore.getState().structurePreview).toBeNull()
    fireEvent.mouseMove(below)
    const preview = useWorkspaceStore.getState().structurePreview
    expect(preview?.grewCellIds).toEqual(['a'])
    expect(preview?.hint).toMatch(/^Row between 1 and 2 · Notes stretches across it/)
    expect(document.querySelectorAll('[data-preview-new]')).toHaveLength(1)
    expect(document.querySelector('[data-preview-grew="a"]')).toHaveTextContent('stretches')
    // The others fade while it draws.
    expect(document.querySelector('[data-edit-selection]')).toHaveAttribute('data-previewing')
    expect(below).toHaveAttribute('data-hot')
    fireEvent.mouseLeave(below)
    expect(useWorkspaceStore.getState().structurePreview).toBeNull()
    expect(document.querySelector('[data-preview-new]')).toBeNull()
    fireEvent.click(below)
    const { working, editing } = useWorkspaceStore.getState()
    expect(working?.grid.rows).toHaveLength(3)
    const slot = working?.cells.find((c) => c.tabs.length === 0)
    expect(editing?.selectedCellId).toBe(slot?.id)
    expect(editing?.undo).toHaveLength(1)
  })
})

describe('merge buttons', () => {
  it('on each neighbour that makes a rectangle: hovered it draws the merged cell, clicked it merges and keeps the card selected', () => {
    const r = view()
    select(r, 'b')
    // b’s neighbours: c below (a whole edge); a, on its left, spans two rows (no rectangle).
    const buttons = document.querySelectorAll<HTMLElement>('[data-merge-button]')
    expect([...buttons].map((b) => b.dataset.mergeButton)).toEqual(['c'])
    const button = buttons[0]!
    // Unmeasured, the neighbour is narrow: the short words, the whole merge its description.
    expect(button).toHaveTextContent('↓Merge as tabs')
    expect(button).toHaveAccessibleDescription('Merge as tabs with Created vs completed')
    fireEvent.mouseMove(button)
    const preview = useWorkspaceStore.getState().structurePreview
    expect(preview?.hint).toBe('Merge Calendar with Created vs completed · one cell, 2 tabs · click to merge')
    expect(preview?.grewCellIds).toEqual(['b'])
    // The merged cell outlined, no words on it; c hidden under it, still mounted; b’s strip holds both tabs.
    expect(document.querySelector('[data-preview-grew="b"]')?.textContent).toBe('')
    expect(document.querySelector<HTMLElement>('[data-ws-cell="c"]')?.style.visibility).toBe('hidden')
    expect(document.querySelectorAll('[data-ws-cell="b"] [role="tab"]')).toHaveLength(2)
    fireEvent.mouseLeave(button)
    expect(useWorkspaceStore.getState().structurePreview).toBeNull()
    expect(document.querySelector<HTMLElement>('[data-ws-cell="c"]')?.style.visibility).toBe('')
    fireEvent.click(button)
    const { working, editing } = useWorkspaceStore.getState()
    expect(working?.cells.find((c) => c.id === 'b')?.tabs.map((t) => t.id)).toEqual(['tb', 'tc'])
    expect(working?.cells.some((c) => c.id === 'c')).toBe(false)
    expect(editing?.selectedCellId).toBe('b')
    expect(editing?.undo).toHaveLength(1)
  })
})

describe('the selected card’s toolbar', () => {
  it('sits in the card: it previews a split on hover and makes it on click; its ⋯ stands in for the card’s', () => {
    const r = view()
    select(r, 'b')
    const toolbar = screen.getByRole('toolbar', { name: 'Calendar card' })
    expect(document.querySelector('[data-ws-cell="b"]')!.contains(toolbar)).toBe(true)
    // The card's corner ⋯ gives way to the toolbar's; no Swap in it (the card menu has Swap with).
    expect(document.querySelectorAll('[data-ws-cell="b"] [aria-label="Cell layout"]')).toHaveLength(1)
    expect(toolbar.querySelector('[aria-label="Cell layout"]')).not.toBeNull()
    expect(toolbar).not.toHaveTextContent('Swap')
    // Unmeasured, the card is under 330px: icons only, each named.
    expect(toolbar).toHaveAttribute('data-compact')
    expect(toolbar).not.toHaveTextContent('Split →')
    expect(screen.getByRole('button', { name: 'Remove widget' })).not.toHaveTextContent('Remove')
    const [right] = toolbar.querySelectorAll('button')
    fireEvent.mouseMove(right!)
    expect(useWorkspaceStore.getState().structurePreview?.newCellIds).toHaveLength(1)
    fireEvent.mouseLeave(right!)
    expect(useWorkspaceStore.getState().structurePreview).toBeNull()
    fireEvent.click(right!)
    expect(useWorkspaceStore.getState().working?.cells).toHaveLength(4)
    expect(useWorkspaceStore.getState().editing?.undo).toHaveLength(1)
  })

  it('its Merge ▾ lists the same neighbours, worded from the card, each drawn while hovered', () => {
    const r = view()
    select(r, 'c')
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    const item = screen.getByRole('menuitem', { name: 'As tabs with Calendar (above)' })
    fireEvent.pointerMove(item)
    expect(useWorkspaceStore.getState().structurePreview?.grewCellIds).toEqual(['c'])
    fireEvent.pointerLeave(item)
    expect(useWorkspaceStore.getState().structurePreview).toBeNull()
    fireEvent.click(item)
    expect(useWorkspaceStore.getState().working?.cells.find((x) => x.id === 'c')?.tabs.map((t) => t.id)).toEqual(['tc', 'tb'])
  })
})

describe('previews of an edit not yet made', () => {
  it('an edit clears a preview; outside the mode none is set', () => {
    const r = view()
    select(r, 'b')
    fireEvent.mouseMove(screen.getByRole('button', { name: 'Insert row below' }))
    expect(useWorkspaceStore.getState().structurePreview).not.toBeNull()
    act(() => { useWorkspaceStore.getState().splitCell('b', 'right') })
    expect(useWorkspaceStore.getState().structurePreview).toBeNull()
    act(() => useWorkspaceStore.setState({ editing: null }))
    useWorkspaceStore.getState().setStructurePreview({ layoutId: 1, body: useWorkspaceStore.getState().working!, newCellIds: [], grewCellIds: [], hint: '' })
    expect(useWorkspaceStore.getState().structurePreview).toBeNull()
  })
})
