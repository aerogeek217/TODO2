import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, act, within } from '@testing-library/react'
import { EditListHost } from '../../../components/workspace/list/EditList'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { emptyPredicate } from '../../../models'
import type { PersistedListDefinition } from '../../../models/list-definition'

const saved: PersistedListDefinition = {
  id: 7, name: 'Waiting on', sortOrder: 0,
  membership: { kind: 'custom', predicate: emptyPredicate() },
  sort: 'deadline', grouping: 'people',
}

/** A list tab's cell, as the workspace renders it (the popover sits beside it). */
function Cell() {
  return (
    <section data-ws-cell="c1">
      <div data-ws-cell-header="c1"><button type="button" data-ws-tab="t1">Waiting on</button></div>
      <div data-list-widget="t1"><button type="button">A row</button></div>
    </section>
  )
}

function open() {
  render(<><Cell /><EditListHost /></>)
  act(() => useUIStore.getState().openListEditor(7, 't1'))
  return screen.getByRole('dialog', { name: 'Edit list Waiting on' })
}

const draft = () => useListDraftStore.getState().drafts[7]

const layout: PersistedWorkspaceLayout = {
  id: 1, name: 'Default', createdAt: new Date(), modifiedAt: new Date(),
  columns: [{ id: 'col', weight: 1, cells: [{ id: 'c1', weight: 1, tabs: [{ id: 't1', kind: 'lens', config: { listDefinitionId: 7 } }] }] }],
}

beforeEach(() => {
  useWorkspaceStore.setState({ working: layout, layouts: [layout] })
  useListDefinitionStore.setState({ listDefinitions: [saved] })
  useListDraftStore.setState({ drafts: {} })
})

afterEach(() => cleanup())

describe('Edit list', () => {
  it('opens on the list as saved: focus in Name, Revert and Save list disabled, nothing marked changed', () => {
    const dialog = open()
    expect(dialog).not.toHaveAttribute('aria-modal')
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Waiting on')
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Name'))
    expect(within(dialog).getByRole('button', { name: 'Revert' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Save list' })).toBeDisabled()
    expect(dialog.querySelectorAll('[data-changed]')).toHaveLength(0)
    expect(within(dialog).getByRole('button', { name: /^Group by/ })).toHaveTextContent('People')
    expect(within(dialog).getByRole('button', { name: /^Sort by/ })).toHaveTextContent('Due date')
    expect(within(dialog).getByRole('button', { name: /^Prompt for/ })).toHaveTextContent('Nothing')
    expect(dialog).toHaveTextContent('In 1 widget')
    // No Max tasks any more.
    expect(dialog).not.toHaveTextContent('Max tasks:')
  })

  it('every control edits the shared draft at once, and the changed rows are marked', () => {
    const dialog = open()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Group by/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Status' }))
    expect(draft()).toMatchObject({ grouping: 'status', sort: 'deadline' })

    fireEvent.click(within(dialog).getByRole('button', { name: /^Sort by/ }))
    // Priority is new, with its rule as a note; Manual explains itself.
    const priority = screen.getByRole('menuitemradio', { name: /^Priority/ })
    expect(priority).toHaveTextContent('NEW')
    expect(priority).toHaveTextContent('Focus first, then Urgent + Important, Urgent, Important, none · ties by due date')
    expect(screen.getByRole('menuitemradio', { name: /^Manual/ })).toHaveTextContent('Your drag order (per list)')
    fireEvent.click(priority)
    expect(draft()).toMatchObject({ grouping: 'status', sort: 'priority' })

    fireEvent.click(within(dialog).getByLabelText('Show completed tasks'))
    expect(draft()!.membership.predicate.showCompleted).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Waiting' } })
    expect(draft()!.name).toBe('Waiting')

    const marked = Array.from(dialog.querySelectorAll('[data-changed]')).map((el) => el.textContent)
    expect(marked).toEqual(['Name', 'Filters', 'Group by', 'Sort by'])
    expect(within(dialog).getByRole('button', { name: 'Save list' })).toBeEnabled()
  })

  it('an edit back to the saved value drops the draft (and the marks)', () => {
    const dialog = open()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Group by/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Status' }))
    fireEvent.click(within(dialog).getByRole('button', { name: /^Group by/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'People' }))
    expect(draft()).toBeUndefined()
    expect(dialog.querySelectorAll('[data-changed]')).toHaveLength(0)
  })

  it('Save list writes the draft and stays open, now clean', async () => {
    const dialog = open()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Sort by/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Name' }))
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save list' })) })
    expect(draft()).toBeUndefined()
    expect(useListDefinitionStore.getState().listDefinitions[0]!.sort).toBe('name')
    expect(screen.getByRole('dialog', { name: 'Edit list Waiting on' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save list' })).toBeDisabled()
  })

  it('Revert drops the draft, stays open and offers Undo', () => {
    const dialog = open()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Sort by/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Name' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revert' }))
    expect(draft()).toBeUndefined()
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'List changes reverted' })
    expect(within(dialog).getByRole('button', { name: /^Sort by/ })).toHaveTextContent('Due date')
  })

  it('an empty name can’t be saved', () => {
    const dialog = open()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: ' ' } })
    expect(within(dialog).getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByRole('button', { name: 'Save list' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Revert' })).toBeEnabled()
  })

  it('Esc closes it and keeps the draft; an Esc that closes a menu inside only closes the menu', () => {
    const dialog = open()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Group by/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Status' }))
    fireEvent.click(within(dialog).getByRole('button', { name: /^Sort by/ }))
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Sort by' }), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(useUIStore.getState().listEditor).not.toBeNull()

    fireEvent.keyDown(within(dialog).getByLabelText('Name'), { key: 'Escape' })
    expect(useUIStore.getState().listEditor).toBeNull()
    expect(screen.queryByRole('dialog', { name: /Edit list/ })).toBeNull()
    expect(draft()).toMatchObject({ grouping: 'status' })
  })

  it('× closes it and keeps the draft', () => {
    const dialog = open()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Waiting' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close (changes stay unsaved)' }))
    expect(useUIStore.getState().listEditor).toBeNull()
    expect(draft()!.name).toBe('Waiting')
  })

  it('a press in the previewed list keeps it open', () => {
    open()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'A row' }))
    expect(useUIStore.getState().listEditor).not.toBeNull()
  })

  it('closes when its list is deleted', () => {
    open()
    act(() => useListDefinitionStore.setState({ listDefinitions: [] }))
    expect(useUIStore.getState().listEditor).toBeNull()
  })
})
