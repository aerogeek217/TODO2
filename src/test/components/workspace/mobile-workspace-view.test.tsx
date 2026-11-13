import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { MobileWorkspaceView } from '../../../components/workspace/MobileWorkspaceView'
import { WidgetPopupHost } from '../../../components/workspace/WidgetPopup'
import { emptyPredicate } from '../../../models'
import type { LayoutBody, PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { openWidgetLarger } from '../../../services/widget-popup'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { makeTodo, resetEntityStores } from '../../helpers'
import { cell, grid } from '../../helpers/layout-builders'

/**
 * The phone's cells (`MobileWorkspaceView`): a tab open larger leaves a
 * placeholder in its cell (cr34 H1).
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
