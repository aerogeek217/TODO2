import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { WorkspaceView } from '../../../components/workspace/WorkspaceView'
import { createTab, type LayoutBody, type PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { resetEntityStores } from '../../helpers'
import { cell, grid } from '../../helpers/layout-builders'

/**
 * Layout editor round two (concept A): in the layout edit mode each card is
 * a blueprint (its widget's icon, name and kind) unless the mode bar's
 * Content toggle shows the widgets; a "+" hovered and the selected card's
 * Split hovered draw the edit before it is made (`structurePreview`): the
 * new empty cells, the cells that stretch; the toolbar's Split makes it.
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

beforeEach(() => {
  resetEntityStores()
  // a | b
  // a | c
  const a = cell('a', [createTab('notes', 'ta')])
  const b = cell('b', [createTab('calendar', 'tb')])
  const c = cell('c', [createTab('calendar', 'tc')])
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

describe('previews of an edit not yet made', () => {
  it('a ruler "+" hovered draws the new row’s slot and the card that stretches; leaving puts the table back', () => {
    view()
    fireEvent.mouseMove(document.querySelector('[data-ruler-plus="rows:1"]')!)
    const preview = useWorkspaceStore.getState().structurePreview
    expect(preview?.grewCellIds).toEqual(['a'])
    expect(preview?.hint).toMatch(/^Row between 1 and 2 · Notes stretches across it/)
    expect(document.querySelectorAll('[data-preview-new]')).toHaveLength(1)
    expect(document.querySelector('[data-preview-grew="a"]')).not.toBeNull()
    // While it shows, the pinned "+" takes the pointer; leaving it ends the preview.
    fireEvent.mouseLeave(document.querySelector('[data-pinned]')!)
    expect(useWorkspaceStore.getState().structurePreview).toBeNull()
    expect(document.querySelector('[data-preview-new]')).toBeNull()
  })

  it('the selected card’s toolbar previews a split on hover and makes it on click', () => {
    const r = view()
    act(() => useWorkspaceStore.getState().selectEditCell('b'))
    rerenderWith(r)
    const toolbar = screen.getByRole('toolbar', { name: 'Calendar card' })
    const [right] = toolbar.querySelectorAll('button')
    fireEvent.mouseMove(right!)
    expect(useWorkspaceStore.getState().structurePreview?.newCellIds).toHaveLength(1)
    fireEvent.mouseLeave(right!)
    expect(useWorkspaceStore.getState().structurePreview).toBeNull()
    fireEvent.click(right!)
    expect(useWorkspaceStore.getState().working?.cells).toHaveLength(4)
    expect(useWorkspaceStore.getState().editing?.undo).toHaveLength(1)
  })

  it('an edit clears a preview; outside the mode none is set', () => {
    view()
    fireEvent.mouseMove(document.querySelector('[data-ruler-plus="rows:1"]')!)
    expect(useWorkspaceStore.getState().structurePreview).not.toBeNull()
    act(() => { useWorkspaceStore.getState().splitCell('b', 'right') })
    expect(useWorkspaceStore.getState().structurePreview).toBeNull()
    act(() => useWorkspaceStore.setState({ editing: null }))
    useWorkspaceStore.getState().setStructurePreview({ layoutId: 1, body: useWorkspaceStore.getState().working!, newCellIds: [], grewCellIds: [], hint: '' })
    expect(useWorkspaceStore.getState().structurePreview).toBeNull()
  })
})
