import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, within, act } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { MobileWorkspaceView } from '../../../components/workspace/MobileWorkspaceView'
import { WidgetPopupHost } from '../../../components/workspace/WidgetPopup'
import { emptyPredicate } from '../../../models'
import { createTab, type LayoutBody, type PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { openWidgetLarger } from '../../../services/widget-popup'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { makeTodo, resetEntityStores } from '../../helpers'
import { cell, grid } from '../../helpers/layout-builders'

/**
 * The phone's cells (`MobileWorkspaceView`): a collapsed cell always has a
 * way to expand (cr34 W5), and a tab open larger leaves a placeholder in its
 * cell (cr34 H1).
 */

const AT = new Date(2026, 0, 1)

function Shown() {
  const layout = useWorkspaceStore((s) => s.working)
  return layout ? (
    <DndContext>
      <MobileWorkspaceView layout={layout} />
      <WidgetPopupHost />
    </DndContext>
  ) : null
}

function show(body: LayoutBody) {
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'Main', createdAt: AT, modifiedAt: AT, ...body }
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, writeFailed: false, hydrated: true })
  return render(<Shown />)
}

const cellEl = (id: string) => document.querySelector<HTMLElement>(`[data-ws-cell="${id}"]`)!

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

afterEach(cleanup)

const expandButtons = (id: string) => within(cellEl(id)).queryAllByRole('button', { name: 'Expand row', hidden: true })
const rowCollapsed = (trackId: string) => useWorkspaceStore.getState().working?.grid.rows.find((t) => t.id === trackId)?.collapsed === true

// cr34 W5: a Number's top line can't hold the cell's controls, and the phone draws no floating ones.
describe('a collapsed cell on the phone always has Expand row', () => {
  it('a collapsed Number: the cell’s own Expand row button; pressed, the row expands and the button goes', () => {
    show(grid([[cell('n', [createTab('number', 'num')])], [cell('k', [createTab('notes', 'notes')])]], { rows: [{ weight: 1000, collapsed: true }, 1000] }))
    expect(expandButtons('n')).toHaveLength(1)
    // The cell that isn't collapsed: none.
    expect(expandButtons('k')).toHaveLength(0)
    expect(rowCollapsed('r1')).toBe(true)
    act(() => { fireEvent.click(expandButtons('n')[0]!) })
    expect(rowCollapsed('r1')).toBe(false)
    expect(expandButtons('n')).toHaveLength(0)
  })

  it('two collapsed Numbers side by side: one each', () => {
    show(grid([[cell('n1', [createTab('number', 'a')]), cell('n2', [createTab('number', 'b')])]], { rows: [{ weight: 1000, collapsed: true }] }))
    expect(expandButtons('n1')).toHaveLength(1)
    expect(expandButtons('n2')).toHaveLength(1)
  })

  it('a collapsed Notes cell keeps the one Expand of its top line', () => {
    show(grid([[cell('k', [createTab('notes', 'notes')])]], { rows: [{ weight: 1000, collapsed: true }] }))
    expect(expandButtons('k')).toHaveLength(1)
    expect(expandButtons('k')[0]!.closest('[data-cell-controls]')).not.toBeNull()
  })

  it('a collapsed cell of two widgets keeps the one Expand of its strip’s header', () => {
    show(grid([[cell('k', [createTab('number', 'a'), createTab('notes', 'b')])]], { rows: [{ weight: 1000, collapsed: true }] }))
    expect(expandButtons('k')).toHaveLength(1)
    expect(expandButtons('k')[0]!.closest('[data-ws-cell-header]')).not.toBeNull()
  })

  it('a Number that isn’t collapsed has none', () => {
    show(grid([[cell('n', [createTab('number', 'num')])]]))
    expect(expandButtons('n')).toHaveLength(0)
  })
})

describe('a tab open larger on the phone', () => {
  it('its cell shows the placeholder, and its widget again once the popup closes', () => {
    show(grid([[cell('k', [{ id: 'l', kind: 'lens', config: { listDefinitionId: 7 } }])]]))
    expect(document.querySelectorAll('[data-list-host="l"]')).toHaveLength(1)
    act(() => { void openWidgetLarger('l') })
    expect(document.querySelectorAll('[data-list-host="l"]')).toHaveLength(1)
    expect(cellEl('k').querySelector('[data-open-larger-placeholder="l"]')?.textContent).toContain('“Team” is open larger')
    expect(cellEl('k').querySelector('[data-list-host]')).toBeNull()
    act(() => { useUIStore.getState().closeWidgetPopup() })
    expect(cellEl('k').querySelector('[data-open-larger-placeholder]')).toBeNull()
    expect(cellEl('k').querySelectorAll('[data-list-host="l"]')).toHaveLength(1)
  })
})
