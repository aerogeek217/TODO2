import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, within, screen, waitFor } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { WorkspaceCell } from '../../../components/workspace/WorkspaceCell'
import { AddWidgetButtons } from '../../../components/workspace/AddWidgetFlow'
import { createListThenEdit } from '../../../components/workspace/widget-hooks'
import { deleteLayoutMessage } from '../../../components/workspace/delete-layout-message'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useUIStore } from '../../../stores/ui-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { useSettingsStore } from '../../../stores/settings-store'
import type { LayoutCell, PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import type { PersistedListDefinition } from '../../../models/list-definition'
import { emptyPredicate } from '../../../models'
import { db } from '../../../data/database'
import { resetDb, resetEntityStores } from '../../helpers'

/**
 * A layout's lists in the workspace: a new list widget makes a blank list
 * owned by the open layout (Edit list opens on it, no picker); Change list
 * offers only the layout's own lists; the delete confirm says they go with
 * the layout.
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
  it('a new list belongs to the open layout, shown in a tab with Edit list beside it', async () => {
    let shown: number | null = null
    createListThenEdit((id) => {
      shown = id
      return 'mine'
    }, 1)
    await waitFor(() => expect(shown).not.toBeNull())
    expect((await db.listDefinitions.get(shown!))?.owner).toEqual({ layoutId: 1 })
    expect(useUIStore.getState().listEditor).toEqual({ listDefinitionId: shown, tabId: 'mine' })
  })

  it('a new list sorts and groups as Settings’ new-list defaults say', async () => {
    useSettingsStore.setState({ newListSort: 'followup', newListSortDirection: 'desc', newListGroup: 'priority' })
    let shown: number | null = null
    createListThenEdit((id) => {
      shown = id
      return null
    }, 1)
    await waitFor(() => expect(shown).not.toBeNull())
    expect(await db.listDefinitions.get(shown!)).toMatchObject({ sort: 'followup', sortDirection: 'desc', grouping: 'priority' })
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

  /** The new list tab's list (the only tab not seeded), once the add has landed. */
  async function addedListTab(): Promise<{ tabId: string; listId: number }> {
    let found: { tabId: string; listId: number } | null = null
    await waitFor(() => {
      const tabs = useWorkspaceStore.getState().working!.columns.flatMap((c) => c.cells.flatMap((k) => k.tabs))
      const tab = tabs.find((t) => t.id !== 'mine')
      expect(tab?.kind).toBe('lens')
      const listId = tab?.kind === 'lens' ? tab.config.listDefinitionId : undefined
      expect(listId).toBeDefined()
      found = { tabId: tab!.id, listId: listId! }
    })
    return found!
  }

  it('the add-tab + › List: a new blank list of the layout in a new tab, its Edit list open — no list picker', async () => {
    render(<DndContext><WorkspaceCell cell={CELL} /></DndContext>)
    fireEvent.click(screen.getByRole('button', { name: 'Add widget as tab' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Add widget' })).getByRole('menuitem', { name: /^List/ }))
    expect(screen.queryByText('Add list')).toBeNull()
    const { tabId, listId } = await addedListTab()
    expect(listId).not.toBe(2)
    expect(await db.listDefinitions.get(listId)).toMatchObject({ name: 'New list', owner: { layoutId: 1 } })
    expect(useUIStore.getState().listEditor).toEqual({ listDefinitionId: listId, tabId })
    expect(useWorkspaceStore.getState().isDirty).toBe(true)
  })

  it('an empty layout’s List tile does the same; a layout not stored yet offers it disabled, saying why', async () => {
    const { unmount } = render(<AddWidgetButtons target={{ kind: 'layout' }} buttonClassName={undefined} iconClassName={undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    const { tabId, listId } = await addedListTab()
    expect(useUIStore.getState().listEditor).toEqual({ listDefinitionId: listId, tabId })
    unmount()

    useWorkspaceStore.setState({ saved: null })
    render(<AddWidgetButtons target={{ kind: 'layout' }} buttonClassName={undefined} iconClassName={undefined} />)
    const list = screen.getByRole('button', { name: 'List' })
    expect(list).toBeDisabled()
    expect(list).toHaveAttribute('title', 'Save the layout first to add lists.')
    expect(screen.getByRole('button', { name: 'Notes' })).toBeEnabled()
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
    const tabs = useWorkspaceStore.getState().working!.columns.flatMap((c) => c.cells.flatMap((k) => k.tabs))
    expect(tabs.filter((t) => t.id !== 'mine')).toHaveLength(1)
  })

  it('an Eisenhower tab switched to List while the Eisenhower’s list is unsaved asks first; Cancel changes nothing', async () => {
    const eisenhowerList = def(5, 'Eisenhower', { owner: { eisenhower: true } })
    await db.listDefinitions.add(eisenhowerList)
    useListDefinitionStore.setState({ listDefinitions: [...useListDefinitionStore.getState().listDefinitions, eisenhowerList] })
    useSettingsStore.setState({ eisenhowerListId: 5 })
    const cell: LayoutCell = { id: 'k', weight: 1, tabs: [{ id: 'eis', kind: 'eisenhower', config: {} }] }
    const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'Main', createdAt: AT, modifiedAt: AT, columns: [{ id: 'c', weight: 1, cells: [cell] }] }
    useWorkspaceStore.setState({ layouts: [layout], working: layout, saved: layout })
    useListDraftStore.getState().edit(5, (d) => ({ ...d, membership: { kind: 'custom', predicate: { ...emptyPredicate(), searchText: 'q4' } } }))

    render(<DndContext><WorkspaceCell cell={cell} /></DndContext>)
    fireEvent.contextMenu(document.querySelector('[data-ws-tab="eis"]')!)
    fireEvent.click(within(screen.getByRole('menu', { name: 'Change widget' })).getByRole('menuitemradio', { name: /^List/ }))
    const prompt = await screen.findByRole('dialog', { name: 'Save changes to list “Eisenhower”?' })
    fireEvent.click(within(prompt).getByRole('button', { name: /^Cancel/ }))

    expect(screen.queryByRole('dialog', { name: /^Save changes to list/ })).toBeNull()
    const tabs = useWorkspaceStore.getState().working!.columns.flatMap((c) => c.cells.flatMap((k) => k.tabs))
    expect(tabs.map((t) => [t.id, t.kind])).toEqual([['eis', 'eisenhower']])
    expect((await db.listDefinitions.toArray()).filter((d) => d.name.startsWith('New list'))).toEqual([])
    expect(useListDraftStore.getState().drafts[5]).toBeDefined()
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
