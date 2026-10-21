import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { db } from '../../../data/database'
import { ListDefinitionPickerPopup } from '../../../components/overlays/ListDefinitionPickerPopup'
import { copyListThenEdit } from '../../../components/workspace/widget-hooks'
import { emptyPredicate } from '../../../models'
import type { PersistedListDefinition } from '../../../models/list-definition'
import type { PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { useListOrderStore } from '../../../stores/list-order-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'

const main: PersistedWorkspaceLayout = {
  id: 1, sortOrder: 0, name: 'Main', createdAt: new Date(), modifiedAt: new Date(),
  columns: [{ id: 'col', weight: 1, cells: [{ id: 'c1', weight: 1, tabs: [{ id: 't1', kind: 'notes', config: {} }] }] }],
}
const second: PersistedWorkspaceLayout = { ...main, id: 2, sortOrder: 1, name: 'Second', columns: [] }

const def = (id: number, name: string, layoutId: number, extra: Partial<PersistedListDefinition> = {}): PersistedListDefinition => ({
  id, name, sortOrder: id, owner: { layoutId },
  membership: { kind: 'custom', predicate: emptyPredicate() },
  sort: 'manual', grouping: 'none', ...extra,
})

beforeEach(async () => {
  await db.delete()
  await db.open()
  useWorkspaceStore.setState({ working: main, saved: main, layouts: [main, second] })
  useListDraftStore.setState({ drafts: {} })
})

afterEach(() => cleanup())

describe('a list picker’s Copy of ›', () => {
  it('opens Copy from’s chooser beside it; a pick hands the list as it shows over and closes the picker', () => {
    const mine = def(1, 'Mine', 1)
    const calls = def(2, 'Calls', 2, { sort: 'deadline' })
    useListDefinitionStore.setState({ listDefinitions: [mine, calls] })
    // Calls has an unsaved edit: the copy takes it as it shows.
    useListDraftStore.setState({ drafts: { 2: { ...calls, name: 'Calls (edited)', grouping: 'status' } } })
    const onCopyOf = vi.fn()
    const onClose = vi.fn()
    render(<ListDefinitionPickerPopup x={0} y={0} layoutId={1} onSelect={vi.fn()} onCreateNew={vi.fn()} onCopyOf={onCopyOf} onClose={onClose} />)
    const button = screen.getByRole('button', { name: 'Copy of' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    const menu = screen.getByRole('menu', { name: 'Copy of' })
    expect(within(menu).getAllByRole('menuitem').map((m) => m.getAttribute('data-menu-label'))).toEqual(['Mine', 'Calls (edited)'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Calls/ }))
    expect(onCopyOf).toHaveBeenCalledTimes(1)
    expect(onCopyOf.mock.calls[0]?.[0]).toMatchObject({ id: 2, name: 'Calls (edited)', def: { grouping: 'status', sort: 'deadline' } })
    expect(onClose).toHaveBeenCalled()
  })

  it('no Copy of › without a handler (a layout not stored yet)', () => {
    useListDefinitionStore.setState({ listDefinitions: [def(1, 'Mine', 1)] })
    render(<ListDefinitionPickerPopup x={0} y={0} layoutId={undefined} onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Copy of' })).not.toBeInTheDocument()
  })
})

describe('copyListThenEdit', () => {
  it('saves a copy for the layout — named uniquely within it, with the source’s parts (not Settings’ defaults) and manual order — then opens Edit list on its tab', async () => {
    useSettingsStore.setState({ newListSort: 'name', newListSortDirection: 'desc', newListGroup: 'people' })
    const store = useListDefinitionStore.getState()
    await store.add({ owner: { layoutId: 1 }, name: 'calls', sort: 'manual', grouping: 'none' })
    const source = await store.add({
      owner: { layoutId: 2 }, name: 'Calls', sort: 'manual', grouping: 'none',
      membership: { kind: 'custom', predicate: { ...emptyPredicate(), searchText: 'call' } },
    })
    await db.listOrders.bulkAdd([{ listDefinitionId: source, todoId: 3, rank: 10 }, { listDefinitionId: source, todoId: 4, rank: 5 }])
    const sourceDef = useListDefinitionStore.getState().listDefinitions.find((d) => d.id === source)!
    const show = vi.fn<(listId: number) => string | null>(() => 't1')

    copyListThenEdit(sourceDef, show, 1)

    await waitFor(() => expect(show).toHaveBeenCalled())
    const id = show.mock.calls[0]![0]
    expect(await db.listDefinitions.get(id)).toMatchObject({
      name: 'Calls 2', owner: { layoutId: 1 }, sort: 'manual', grouping: 'none',
      membership: { predicate: { searchText: 'call' } },
    })
    expect((await db.listDefinitions.get(id))).not.toHaveProperty('sortDirection')
    expect([...(useListOrderStore.getState().ranks.get(id) ?? [])].sort()).toEqual([[3, 10], [4, 5]])
    expect(useUIStore.getState().listEditor).toMatchObject({ listDefinitionId: id, tabId: 't1' })
  })
})
