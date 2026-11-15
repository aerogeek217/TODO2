import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { AddWidgetRequestHost } from '../../../components/workspace/AddWidgetFlow'
import { addWidgetAt, addWidgetFromPalette } from '../../../components/workspace/widget-hooks'
import { createTab, WIDGET_KIND_SPECS, WIDGET_KINDS, type LayoutBody, type PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { useChartWidgetsStore } from '../../../stores/chart-widgets-store'
import { registerOpenEditor } from '../../../stores/editor-leave'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { cell, emptyBody, grid } from '../../helpers/layout-builders'

/**
 * The palette's Add Widget › kind (J18): the existing Where picker on the
 * cell last used, the kind chosen; in an empty layout, the widget added as
 * the empty layout's tiles add it.
 */

function open(body: LayoutBody) {
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'L', createdAt: new Date(), modifiedAt: new Date(), ...body }
  useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout], activeLayoutId: 1 })
}

const two = () => grid([[cell('left', [createTab('notes', 'n1')]), cell('right', [createTab('notes', 'n2')])]])
const ws = () => useWorkspaceStore.getState().working!

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('addWidgetFromPalette', () => {
  it('asks for the Where picker of the cell holding the focus, the kind chosen', () => {
    open(two())
    const right = document.createElement('section')
    right.setAttribute('data-ws-cell', 'right')
    const inside = document.createElement('button')
    right.append(inside)
    document.body.append(right)
    inside.focus()
    addWidgetFromPalette('calendar')
    expect(useUIStore.getState().addWidgetRequest).toMatchObject({ cellId: 'right', kind: 'calendar' })
  })

  it('without a focused cell: the layout’s first cell in reading order', () => {
    open(two())
    addWidgetFromPalette('notes')
    expect(useUIStore.getState().addWidgetRequest).toMatchObject({ cellId: 'left', kind: 'notes' })
  })

  it('in an empty layout: added at once as the tiles add it (a Breakdown a Custom one; no editor opens)', () => {
    open(emptyBody())
    addWidgetFromPalette('notes')
    expect(useUIStore.getState().addWidgetRequest).toBeNull()
    expect(ws().cells.flatMap((c) => c.tabs.map((t) => t.kind))).toEqual(['notes'])
    open(emptyBody())
    addWidgetFromPalette('breakdown')
    const added = ws().cells[0]?.tabs[0]
    expect(added?.kind).toBe('breakdown')
    expect(useChartWidgetsStore.getState().editorTabId).toBeNull()
  })
})

describe('addWidgetAt: no editor opens on add (decision 8)', () => {
  it.each(WIDGET_KINDS.filter((k) => !WIDGET_KIND_SPECS[k].showsList))('%s is added and opens no editor', (kind) => {
    open(two())
    const id = addWidgetAt(kind, { kind: 'cell', cellId: 'left' })
    expect(ws().cells.flatMap((c) => c.tabs).find((t) => t.id === id)?.kind).toBe(kind)
    expect(useUIStore.getState()).toMatchObject({ numberEditorTabId: null, listEditor: null })
    expect(useChartWidgetsStore.getState()).toMatchObject({ editorTabId: null, pulseEditorTabId: null })
  })
})

describe('AddWidgetRequestHost', () => {
  it('the Where picker, then Add <kind>: it goes where the picture says', () => {
    open(two())
    render(<AddWidgetRequestHost />)
    act(() => useUIStore.getState().requestAddWidget({ cellId: 'left', kind: 'notes', anchor: { x: 10, y: 10 } }))
    const menu = screen.getByRole('menu', { name: 'Add widget' })
    expect(within(menu).getByRole('group', { name: 'Where' })).toBeInTheDocument()
    // No kinds to pick from: only the chosen one.
    expect(within(menu).queryByRole('menuitem', { name: /Calendar/ })).toBeNull()
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Split · right/ }))
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Add Notes' }))
    expect(ws().cells).toHaveLength(3)
    expect(useUIStore.getState().addWidgetRequest).toBeNull()
    expect(screen.queryByRole('menu', { name: 'Add widget' })).toBeNull()
  })

  it('a Breakdown offers its presets', () => {
    open(two())
    render(<AddWidgetRequestHost />)
    act(() => useUIStore.getState().requestAddWidget({ cellId: 'left', kind: 'breakdown', anchor: { x: 10, y: 10 } }))
    const menu = screen.getByRole('menu', { name: 'Add widget' })
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent?.trim())).toEqual(['People', 'Tags', 'Status', 'Custom'])
  })

  it('an open editor with changes is asked before the widget is added: Keep editing adds nothing, Save or Discard adds it (answer 17)', async () => {
    open(two())
    render(<AddWidgetRequestHost />)
    let answer = false
    let changed = true
    const ask = vi.fn(() => { if (answer) changed = false; return Promise.resolve(answer) })
    const unregister = registerOpenEditor({ changed: () => changed, ask })
    const add = async (item: string) => {
      act(() => useUIStore.getState().requestAddWidget({ cellId: 'left', kind: item === 'Add Notes' ? 'notes' : 'breakdown', anchor: { x: 10, y: 10 } }))
      await act(async () => { fireEvent.click(within(screen.getByRole('menu', { name: 'Add widget' })).getByRole('menuitem', { name: item })) })
    }
    // Keep editing: nothing is added, the editor stays as it was.
    await add('Add Notes')
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ws().cells.flatMap((c) => c.tabs)).toHaveLength(2)
    // A Breakdown's preset asks the same way.
    await add('People')
    expect(ask).toHaveBeenCalledTimes(2)
    expect(ws().cells.flatMap((c) => c.tabs)).toHaveLength(2)
    // Save or Discard: the widget is added once the editor was left.
    answer = true
    await add('Add Notes')
    expect(ask).toHaveBeenCalledTimes(3)
    await vi.waitFor(() => expect(ws().cells.flatMap((c) => c.tabs).map((t) => t.kind)).toEqual(['notes', 'notes', 'notes']))
    // No editor holding changes: added at once, nothing asked.
    await add('People')
    expect(ask).toHaveBeenCalledTimes(3)
    expect(ws().cells.flatMap((c) => c.tabs)).toHaveLength(4)
    unregister()
  })

  it('nothing for a cell no longer in the open layout', () => {
    open(two())
    render(<AddWidgetRequestHost />)
    act(() => useUIStore.getState().requestAddWidget({ cellId: 'gone', kind: 'notes', anchor: { x: 10, y: 10 } }))
    expect(screen.queryByRole('menu', { name: 'Add widget' })).toBeNull()
  })
})
