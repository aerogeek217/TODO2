import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, within, screen, waitFor } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { WorkspaceCell } from '../../../components/workspace/WorkspaceCell'
import { AddWidgetButtons } from '../../../components/workspace/AddWidgetFlow'
import { createListAndTab } from '../../../components/workspace/widget-hooks'
import { deleteLayoutMessage } from '../../../components/workspace/delete-layout-message'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useUIStore } from '../../../stores/ui-store'
import { useSettingsStore } from '../../../stores/settings-store'
import type { LayoutCell, PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import type { PersistedListDefinition } from '../../../models/list-definition'
import { emptyPredicate } from '../../../models'
import { db } from '../../../data/database'
import { resetDb, resetEntityStores } from '../../helpers'
import { single } from '../../helpers/layout-builders'
import { layoutSteps } from '../../helpers/layout-steps'

/**
 * A layout's lists in the workspace: a new list widget makes a blank list
 * owned by the open layout (no editor opens, no picker); a list tab
 * is never pointed at another list (no Change list); the delete confirm says
 * they go with the layout.
 */

const AT = new Date(2026, 0, 1)
const CELL: LayoutCell = { id: 'k', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [{ id: 'mine', kind: 'lens', config: { listDefinitionId: 2 } }] }

const def = (id: number, name: string, extra: Partial<PersistedListDefinition> = {}): PersistedListDefinition => ({
  id, name, sortOrder: id, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() }, ...extra,
})

beforeEach(async () => {
  await resetDb()
  resetEntityStores()
  useUIStore.setState(useUIStore.getInitialState(), true)
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'Main', createdAt: AT, modifiedAt: AT, ...single(CELL) }
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, writeFailed: false, hydrated: true })
  const lists = [def(1, 'Other', { owner: { layoutId: 1 } }), def(2, 'Mine', { owner: { layoutId: 1 } }), def(3, 'Theirs', { owner: { layoutId: 9 } }), def(4, 'No owner')]
  await db.listDefinitions.bulkAdd(lists)
  useListDefinitionStore.setState({ listDefinitions: lists, loaded: true })
})

afterEach(cleanup)

function openTabMenu(): HTMLElement {
  render(<DndContext><WorkspaceCell cell={CELL} rowTrackIds={['r1']} collapsed={false} /></DndContext>)
  fireEvent.contextMenu(document.querySelector('[data-ws-tab="mine"]')!)
  return screen.getByRole('menu', { name: 'Cell options' })
}

describe('a layout’s lists in the workspace', () => {
  it('a new list belongs to the open layout, named New list, shows every open task, and opens no editor', async () => {
    let shown: number | null = null
    void createListAndTab((id) => {
      shown = id
    }, 1)
    await waitFor(() => expect(shown).not.toBeNull())
    const stored = await db.listDefinitions.get(shown!)
    expect(stored?.owner).toEqual({ layoutId: 1 })
    expect(stored?.name).toBe('New list')
    expect(stored?.membership).toEqual({ kind: 'custom', predicate: emptyPredicate() })
    expect(useUIStore.getState().listEditor).toBeNull()
  })

  it('a new list sorts and groups as Settings’ new-list defaults say', async () => {
    useSettingsStore.setState({ newListSort: 'followup', newListSortDirection: 'desc', newListGroup: 'priority' })
    let shown: number | null = null
    void createListAndTab((id) => {
      shown = id
    }, 1)
    await waitFor(() => expect(shown).not.toBeNull())
    expect(await db.listDefinitions.get(shown!)).toMatchObject({ sort: 'followup', sortDirection: 'desc', grouping: 'priority' })
  })

  it('the new list’s name is free in its layout (another layout’s names don’t count)', async () => {
    useListDefinitionStore.setState({ listDefinitions: [def(1, 'New list', { owner: { layoutId: 9 } }), def(2, 'New list', { owner: { layoutId: 1 } })] })
    let shown: number | null = null
    void createListAndTab((id) => {
      shown = id
    }, 1)
    await waitFor(() => expect(shown).not.toBeNull())
    expect((await db.listDefinitions.get(shown!))?.name).toBe('New list 2')
  })

  /** The new list tab's list (the only tab not seeded), once the add has landed. */
  async function addedListTab(): Promise<{ tabId: string; listId: number }> {
    let found: { tabId: string; listId: number } | null = null
    await waitFor(() => {
      const tabs = useWorkspaceStore.getState().working!.cells.flatMap((k) => k.tabs)
      const tab = tabs.find((t) => t.id !== 'mine')
      expect(tab?.kind).toBe('lens')
      const listId = tab?.kind === 'lens' ? tab.config.listDefinitionId : undefined
      expect(listId).toBeDefined()
      found = { tabId: tab!.id, listId: listId! }
    })
    return found!
  }

  it('⋯ › Add widget… › List: a new blank list of the layout in a new tab, no editor open — no list picker', async () => {
    render(<DndContext><WorkspaceCell cell={CELL} rowTrackIds={['r1']} collapsed={false} /></DndContext>)
    fireEvent.click(screen.getByRole('button', { name: 'Cell options' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Cell options' })).getByRole('menuitem', { name: 'Add widget…' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Add widget' })).getByRole('menuitem', { name: /^List/ }))
    expect(screen.queryByText('Add list')).toBeNull()
    const { listId } = await addedListTab()
    expect(listId).not.toBe(2)
    expect(await db.listDefinitions.get(listId)).toMatchObject({ name: 'New list', owner: { layoutId: 1 } })
    expect(useUIStore.getState().listEditor).toBeNull()
    expect(layoutSteps()).not.toEqual([])
  })

  it('an empty layout’s List tile does the same', async () => {
    render(<AddWidgetButtons target={{ kind: 'layout' }} buttonClassName={undefined} iconClassName={undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    const { listId } = await addedListTab()
    expect(await db.listDefinitions.get(listId)).toMatchObject({ name: 'New list', owner: { layoutId: 1 } })
    expect(useUIStore.getState().listEditor).toBeNull()
  })

  it('a double-click on the List tile makes one list and one tab', async () => {
    render(<AddWidgetButtons target={{ kind: 'layout' }} buttonClassName={undefined} iconClassName={undefined} />)
    const list = screen.getByRole('button', { name: 'List' })
    fireEvent.click(list)
    fireEvent.click(list)
    const { listId } = await addedListTab()
    // A read after every list write the clicks started.
    const stored = await db.listDefinitions.toArray()
    expect(stored.filter((d) => d.name.startsWith('New list')).map((d) => d.id)).toEqual([listId])
    const tabs = useWorkspaceStore.getState().working!.cells.flatMap((k) => k.tabs)
    expect(tabs.filter((t) => t.id !== 'mine')).toHaveLength(1)
  })

  it('an Eisenhower tab switched to List switches at once, asking nothing (the Eisenhower’s list is saved as it is)', async () => {
    const eisenhowerList = def(5, 'Eisenhower', { owner: { eisenhower: true } })
    await db.listDefinitions.add(eisenhowerList)
    useListDefinitionStore.setState({ listDefinitions: [...useListDefinitionStore.getState().listDefinitions, eisenhowerList] })
    useSettingsStore.setState({ eisenhowerListId: 5 })
    const cell: LayoutCell = { id: 'k', area: { col: 0, row: 0, colSpan: 1, rowSpan: 1 }, tabs: [{ id: 'eis', kind: 'eisenhower', config: {} }] }
    const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'Main', createdAt: AT, modifiedAt: AT, ...single(cell) }
    useWorkspaceStore.setState({ layouts: [layout], working: layout, saved: layout })

    render(<DndContext><WorkspaceCell cell={cell} rowTrackIds={['r1']} collapsed={false} /></DndContext>)
    fireEvent.contextMenu(document.querySelector('[data-ws-tab="eis"]')!)
    fireEvent.click(within(screen.getByRole('menu', { name: 'Cell options' })).getByRole('menuitem', { name: /^Change widget/ }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Change widget' })).getByRole('menuitemradio', { name: /^List/ }))
    await waitFor(() => expect(useWorkspaceStore.getState().working!.cells.flatMap((k) => k.tabs).map((t) => [t.id, t.kind])).toEqual([['eis', 'lens']]))
    expect(screen.queryByRole('dialog', { name: /^Save changes to list/ })).toBeNull()
    // The Eisenhower's own list stays (no tab shows it, but it is the Eisenhower's, not the layout's).
    expect(await db.listDefinitions.get(5)).toBeDefined()
  })

  it('a list tab’s menu offers no Change list (UX cleanup 4A, decision 11): Edit list… leads it', () => {
    const menu = openTabMenu()
    expect(within(menu).queryByRole('menuitem', { name: /Change list/ })).toBeNull()
    expect(within(menu).getAllByRole('menuitem')[0]).toHaveAttribute('data-menu-label', 'Edit list…')
  })

  it('the delete confirm says the layout’s own lists go with it', () => {
    expect(deleteLayoutMessage(0)).toBe('The layout is removed. Your tasks and notes are not affected.')
    expect(deleteLayoutMessage(1)).toBe('The layout and its list are removed. This can’t be undone. Your tasks and notes are not affected.')
    expect(deleteLayoutMessage(3)).toContain('The layout and its 3 lists are removed.')
  })
})
