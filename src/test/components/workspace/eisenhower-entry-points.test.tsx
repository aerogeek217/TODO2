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
 * Eisenhower (the one editor): the tab menu's Edit list… (the Eisenhower's
 * own list) and Customize panes…, and the cell menu's, open Settings there;
 * no Customize panes dialog.
 */

const AT = new Date(2026, 0, 1)
const CELL: LayoutCell = { id: 'k', weight: 1, tabs: [{ id: 'eis', kind: 'eisenhower', config: {} }] }

beforeEach(() => {
  resetEntityStores()
  useUIStore.setState(useUIStore.getInitialState(), true)
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'Main', createdAt: AT, modifiedAt: AT, columns: [{ id: 'c', weight: 1, cells: [CELL] }] }
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, isDirty: false, hydrated: true })
  useListDefinitionStore.setState({
    listDefinitions: [
      { id: 8, name: 'Eisenhower', sortOrder: 0, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() }, owner: { eisenhower: true } },
    ],
  })
  useSettingsStore.setState({ eisenhowerListId: 8 })
})

afterEach(cleanup)

function openTabMenu(): HTMLElement {
  render(<DndContext><WorkspaceCell cell={CELL} /></DndContext>)
  fireEvent.contextMenu(document.querySelector('[data-ws-tab="eis"]')!)
  return screen.getByRole('menu', { name: 'Change widget' })
}

describe('Eisenhower entry points', () => {
  it('the tab menu: Edit list… (its own list), Customize panes… → Settings › Tasks › Eisenhower; no source line, no Show ›', () => {
    const menu = openTabMenu()
    expect(menu).not.toHaveTextContent('Shows')
    expect(within(menu).queryByRole('menuitem', { name: /^Show/ })).toBeNull()
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]')).slice(0, 2).map((el) => el.getAttribute('data-menu-label')))
      .toEqual(['Edit list…', 'Customize panes…'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Customize panes…' }))
    expect(useUIStore.getState()).toMatchObject({ settingsOpen: true, settingsSection: 'tasks', settingsPart: 'eisenhower', settingsFocus: null })
    expect(screen.queryByRole('dialog', { name: 'Customize panes' })).toBeNull()
  })

  it('Edit list… opens Edit list on the Eisenhower’s list beside the tab', () => {
    const menu = openTabMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit list…' }))
    expect(useUIStore.getState().listEditor).toMatchObject({ listDefinitionId: 8, tabId: 'eis' })
  })

  it('switched to List: picks a list (the Eisenhower’s own is never a list tab’s)', () => {
    const menu = openTabMenu()
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /^List/ }))
    const picker = screen.getByText('Show list').parentElement!
    // No saved list yet: only Create new list….
    expect(within(picker).getAllByRole('button').map((b) => b.textContent)).toEqual(['+ Create new list…'])
    expect(useWorkspaceStore.getState().working?.columns[0]?.cells[0]?.tabs[0]?.kind).toBe('eisenhower')
  })

  it('the cell menu’s Customize panes… opens Settings there too', () => {
    render(<DndContext><WorkspaceCell cell={CELL} /></DndContext>)
    fireEvent.click(screen.getByRole('button', { name: 'Cell options' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Cell options' })).getByRole('menuitem', { name: 'Customize panes…' }))
    expect(useUIStore.getState()).toMatchObject({ settingsOpen: true, settingsPart: 'eisenhower' })
  })
})
