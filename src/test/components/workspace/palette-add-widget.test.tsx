import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { addWidgetAt, addWidgetFromPalette } from '../../../components/workspace/widget-hooks'
import { createTab, WIDGET_KIND_SPECS, WIDGET_KINDS, type LayoutBody, type PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { useChartWidgetsStore } from '../../../stores/chart-widgets-store'
import { registerOpenEditor } from '../../../stores/editor-leave'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { cell, emptyBody, grid } from '../../helpers/layout-builders'

/**
 * The palette's Add Widget › kind (J18; layout edit mode E4): the widget
 * added as a tab of the cell last used, made its active tab — no Where
 * step; in an empty layout, the widget added as the empty layout's tiles
 * add it.
 */

function open(body: LayoutBody) {
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'L', createdAt: new Date(), modifiedAt: new Date(), ...body }
  useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout], activeLayoutId: 1 })
}

const two = () => grid([[cell('left', [createTab('notes', 'n1')]), cell('right', [createTab('notes', 'n2')])]])
const ws = () => useWorkspaceStore.getState().working!
const kinds = (cellId: string) => ws().cells.find((c) => c.id === cellId)?.tabs.map((t) => t.kind)
const activeKind = (cellId: string) => {
  const c = ws().cells.find((x) => x.id === cellId)
  return c?.tabs.find((t) => t.id === c.activeTabId)?.kind
}

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('addWidgetFromPalette', () => {
  it('adds the kind as a tab of the cell holding the focus, made its active tab — the cells stay as they were', () => {
    open(two())
    const right = document.createElement('section')
    right.setAttribute('data-ws-cell', 'right')
    const inside = document.createElement('button')
    right.append(inside)
    document.body.append(right)
    inside.focus()
    addWidgetFromPalette('calendar')
    expect(ws().cells.map((c) => c.id)).toEqual(['left', 'right'])
    expect(kinds('right')).toEqual(['notes', 'calendar'])
    expect(activeKind('right')).toBe('calendar')
    expect(kinds('left')).toEqual(['notes'])
  })

  it('without a focused cell: the layout’s first cell in reading order', () => {
    open(two())
    addWidgetFromPalette('notes')
    expect(kinds('left')).toEqual(['notes', 'notes'])
  })

  it('a Breakdown is a Custom one; no editor opens', () => {
    open(two())
    addWidgetFromPalette('breakdown')
    expect(activeKind('left')).toBe('breakdown')
    expect(useChartWidgetsStore.getState().editorTabId).toBeNull()
  })

  it('in an empty layout: added at once as the tiles add it (a Breakdown a Custom one; no editor opens)', () => {
    open(emptyBody())
    addWidgetFromPalette('notes')
    expect(ws().cells.flatMap((c) => c.tabs.map((t) => t.kind))).toEqual(['notes'])
    open(emptyBody())
    addWidgetFromPalette('breakdown')
    const added = ws().cells[0]?.tabs[0]
    expect(added?.kind).toBe('breakdown')
    expect(useChartWidgetsStore.getState().editorTabId).toBeNull()
  })

  it('an open editor with changes is asked first: Keep editing adds nothing, Save or Discard adds it', async () => {
    open(two())
    let answer = false
    let changed = true
    const ask = vi.fn(() => { if (answer) changed = false; return Promise.resolve(answer) })
    const unregister = registerOpenEditor({ changed: () => changed, ask })
    addWidgetFromPalette('notes')
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1))
    expect(ws().cells.flatMap((c) => c.tabs)).toHaveLength(2)
    answer = true
    addWidgetFromPalette('notes')
    await vi.waitFor(() => expect(ws().cells.flatMap((c) => c.tabs)).toHaveLength(3))
    unregister()
  })

  it('in the layout edit mode: added to the draft — nothing written until Done', async () => {
    open(two())
    expect(await useWorkspaceStore.getState().enterEdit()).toBe(true)
    addWidgetFromPalette('calendar')
    expect(kinds('left')).toEqual(['notes', 'calendar'])
    expect(useWorkspaceStore.getState().saved?.cells.find((c) => c.id === 'left')?.tabs).toHaveLength(1)
    expect(useWorkspaceStore.getState().editing?.undo).toHaveLength(1)
  })
})

describe('addWidgetAt: no editor opens on add (decision 8)', () => {
  it.each(WIDGET_KINDS.filter((k) => !WIDGET_KIND_SPECS[k].showsList))('%s is added and opens no editor', (kind) => {
    open(two())
    const id = addWidgetAt(kind, { kind: 'cell', cellId: 'left' })
    expect(ws().cells.flatMap((c) => c.tabs).find((t) => t.id === id)?.kind).toBe(kind)
    expect(useUIStore.getState()).toMatchObject({ numberEditorTabId: null, listEditor: null })
    expect(useChartWidgetsStore.getState()).toMatchObject({ editorTabId: null, trendEditorTabId: null })
  })
})
