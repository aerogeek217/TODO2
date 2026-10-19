import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, within, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { WorkspaceCell } from '../../../components/workspace/WorkspaceCell'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useUIStore } from '../../../stores/ui-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import type { LayoutCell, PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { emptyPredicate } from '../../../models'
import { resetEntityStores } from '../../helpers'

/**
 * The workspace's Eisenhower entries are shortcuts into Settings › Tasks ›
 * Eisenhower (the one editor): the tab menu's first line names the source
 * (no Show ›), its Customize panes… and the cell menu's open Settings there;
 * Edit list… stays while the source is a list; no Customize panes dialog.
 */

const AT = new Date(2026, 0, 1)
const CELL: LayoutCell = { id: 'k', weight: 1, tabs: [{ id: 'eis', kind: 'eisenhower', config: {} }] }

beforeEach(() => {
  resetEntityStores()
  useUIStore.setState(useUIStore.getInitialState(), true)
  const layout: PersistedWorkspaceLayout = { id: 1, name: 'Main', createdAt: AT, modifiedAt: AT, columns: [{ id: 'c', weight: 1, cells: [CELL] }] }
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, isDirty: false, hydrated: true })
  useListDefinitionStore.setState({
    listDefinitions: [{ id: 8, name: 'Team', sortOrder: 0, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() } }],
  })
  useSettingsStore.setState({ eisenhowerListId: null })
})

afterEach(cleanup)

function openTabMenu(): HTMLElement {
  render(<DndContext><WorkspaceCell cell={CELL} /></DndContext>)
  fireEvent.contextMenu(document.querySelector('[data-ws-tab="eis"]')!)
  return screen.getByRole('menu', { name: 'Change widget' })
}

describe('Eisenhower entry points', () => {
  it('the tab menu: the source as a line (no Show ›), then Customize panes… → Settings › Tasks › Eisenhower', () => {
    const menu = openTabMenu()
    expect(menu).toHaveTextContent('Shows all tasks')
    expect(within(menu).queryByRole('menuitem', { name: /^Show/ })).toBeNull()
    expect(within(menu).queryByRole('menuitem', { name: 'Edit list…' })).toBeNull()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Customize panes…' }))
    expect(useUIStore.getState()).toMatchObject({ settingsOpen: true, settingsSection: 'tasks', settingsPart: 'eisenhower', settingsFocus: null })
    expect(screen.queryByRole('dialog', { name: 'Customize panes' })).toBeNull()
  })

  it('on a list: the line names it and Edit list… is there', () => {
    useSettingsStore.setState({ eisenhowerListId: 8 })
    const menu = openTabMenu()
    expect(menu).toHaveTextContent('Shows “Team”')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit list…' }))
    expect(useUIStore.getState().listEditor).toMatchObject({ listDefinitionId: 8, tabId: 'eis' })
  })

  it('a deleted source list: the line says so, no Edit list…', () => {
    useSettingsStore.setState({ eisenhowerListId: 99 })
    const menu = openTabMenu()
    expect(menu).toHaveTextContent('Shows “(Deleted list)”')
    expect(within(menu).queryByRole('menuitem', { name: 'Edit list…' })).toBeNull()
  })

  it('the cell menu’s Customize panes… opens Settings there too', () => {
    render(<DndContext><WorkspaceCell cell={CELL} /></DndContext>)
    fireEvent.click(screen.getByRole('button', { name: 'Cell options' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Cell options' })).getByRole('menuitem', { name: 'Customize panes…' }))
    expect(useUIStore.getState()).toMatchObject({ settingsOpen: true, settingsPart: 'eisenhower' })
  })
})
