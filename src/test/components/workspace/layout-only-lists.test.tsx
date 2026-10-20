import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, within, screen, waitFor } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { WorkspaceCell } from '../../../components/workspace/WorkspaceCell'
import { createListThenEdit } from '../../../components/workspace/widget-hooks'
import { deleteLayoutMessage } from '../../../components/workspace/delete-layout-message'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useUIStore } from '../../../stores/ui-store'
import type { LayoutCell, PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import type { PersistedListDefinition } from '../../../models/list-definition'
import { emptyPredicate } from '../../../models'
import { db } from '../../../data/database'
import { resetDb, resetEntityStores } from '../../helpers'

/**
 * A layout's lists in the workspace: Create new list makes one owned by the
 * open layout; Change list offers only the layout's own lists; the tab menu
 * has no Save to my lists; the delete confirm says they go with the layout.
 */

const AT = new Date(2026, 0, 1)
const CELL: LayoutCell = { id: 'k', weight: 1, tabs: [{ id: 'mine', kind: 'lens', config: { listDefinitionId: 2 } }] }

const def = (id: number, name: string, extra: Partial<PersistedListDefinition> = {}): PersistedListDefinition => ({
  id, name, sortOrder: id, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() }, ...extra,
})

beforeEach(async () => {
  await resetDb()
  resetEntityStores()
  useUIStore.setState(useUIStore.getInitialState(), true)
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'Main', createdAt: AT, modifiedAt: AT, columns: [{ id: 'c', weight: 1, cells: [CELL] }] }
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, isDirty: false, hydrated: true })
  const lists = [def(1, 'Other', { owner: { layoutId: 1 } }), def(2, 'Mine', { owner: { layoutId: 1 } }), def(3, 'Theirs', { owner: { layoutId: 9 } }), def(4, 'No owner')]
  await db.listDefinitions.bulkAdd(lists)
  useListDefinitionStore.setState({ listDefinitions: lists, loaded: true })
})

afterEach(cleanup)

function openTabMenu(): HTMLElement {
  render(<DndContext><WorkspaceCell cell={CELL} /></DndContext>)
  fireEvent.contextMenu(document.querySelector('[data-ws-tab="mine"]')!)
  return screen.getByRole('menu', { name: 'Change widget' })
}

describe('a layout’s lists in the workspace', () => {
  it('Create new list: the new list belongs to the open layout, shown in a tab with Edit list beside it', async () => {
    let shown: number | null = null
    createListThenEdit((id) => {
      shown = id
      return 'mine'
    }, 1)
    await waitFor(() => expect(shown).not.toBeNull())
    expect((await db.listDefinitions.get(shown!))?.owner).toEqual({ layoutId: 1 })
    expect(useUIStore.getState().listEditor).toEqual({ listDefinitionId: shown, tabId: 'mine' })
  })

  it('the new list’s name is free in its layout (another layout’s names don’t count)', async () => {
    useListDefinitionStore.setState({ listDefinitions: [def(1, 'New list', { owner: { layoutId: 9 } }), def(2, 'New list', { owner: { layoutId: 1 } })] })
    let shown: number | null = null
    createListThenEdit((id) => {
      shown = id
      return null
    }, 1)
    await waitFor(() => expect(shown).not.toBeNull())
    expect((await db.listDefinitions.get(shown!))?.name).toBe('New list 2')
  })

  it('the tab menu has no Save to my lists', () => {
    const menu = openTabMenu()
    expect(within(menu).queryByRole('menuitem', { name: 'Save to my lists' })).toBeNull()
  })

  it('Change list offers only this layout’s own lists', () => {
    const menu = openTabMenu()
    const row = within(menu).getByRole('menuitem', { name: /Change list/ })
    row.focus()
    fireEvent.keyDown(row, { key: 'ArrowRight' })
    const sub = screen.getByRole('menu', { name: 'Change list' })
    expect(Array.from(sub.querySelectorAll('[role="menuitem"]')).map((el) => el.getAttribute('data-menu-label'))).toEqual(['Other', 'Mine'])
  })

  it('the delete confirm says the layout’s own lists go with it', () => {
    expect(deleteLayoutMessage(0)).toBe('The layout is removed. Your tasks and notes are not affected.')
    expect(deleteLayoutMessage(1)).toBe('The layout and its list are removed. This can’t be undone. Your tasks and notes are not affected.')
    expect(deleteLayoutMessage(3)).toContain('The layout and its 3 lists are removed.')
  })
})
