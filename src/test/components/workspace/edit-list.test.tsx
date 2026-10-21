import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, act, within } from '@testing-library/react'
import { EditListHost } from '../../../components/workspace/list/EditList'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useSettingsStore } from '../../../stores/settings-store'
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
      <div data-list-host="t1"><button type="button">A row</button></div>
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
  id: 1, sortOrder: 0, name: 'Default', createdAt: new Date(), modifiedAt: new Date(),
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
    // Priority carries its rule as a note (no "new feature" tag); Manual explains itself.
    const priority = screen.getByRole('menuitemradio', { name: /^Priority/ })
    expect(priority).not.toHaveTextContent('NEW')
    expect(priority).toHaveTextContent('Focus first, then Urgent + Important, Urgent, Important, the rest · ties by due date')
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

  it('Save list writes the draft and closes it', async () => {
    const dialog = open()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Sort by/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Name' }))
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save list' })) })
    expect(draft()).toBeUndefined()
    expect(useListDefinitionStore.getState().listDefinitions[0]!.sort).toBe('name')
    expect(screen.queryByRole('dialog', { name: 'Edit list Waiting on' })).not.toBeInTheDocument()
    expect(useUIStore.getState().listEditor).toBeNull()
  })

  it('Revert drops the draft, closes it and offers Undo', () => {
    const dialog = open()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Sort by/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Name' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revert' }))
    expect(draft()).toBeUndefined()
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'List changes reverted' })
    expect(screen.queryByRole('dialog', { name: 'Edit list Waiting on' })).not.toBeInTheDocument()
  })

  it('an empty name can’t be saved', () => {
    const dialog = open()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: ' ' } })
    expect(within(dialog).getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByRole('button', { name: 'Save list' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Revert' })).toBeEnabled()
  })

  it('Esc closes a list with no unsaved changes at once; an Esc that closes a menu inside only closes the menu', () => {
    const dialog = open()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Sort by/ }))
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Sort by' }), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(useUIStore.getState().listEditor).not.toBeNull()

    fireEvent.keyDown(within(dialog).getByLabelText('Name'), { key: 'Escape' })
    expect(useUIStore.getState().listEditor).toBeNull()
    expect(screen.queryByRole('dialog', { name: /Edit list/ })).toBeNull()
  })

  it.each([
    ['Esc', (dialog: HTMLElement) => fireEvent.keyDown(within(dialog).getByLabelText('Name'), { key: 'Escape' })],
    ['×', (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: 'Close Edit list' }))],
  ])('%s on an unsaved list closes it at once, nothing asked: the edits stay as the list’s draft', (_key, close) => {
    const dialog = open()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Group by/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Status' }))
    close(dialog)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useUIStore.getState().listEditor).toBeNull()
    expect(draft()).toMatchObject({ grouping: 'status' })
    expect(useListDefinitionStore.getState().listDefinitions[0]!.grouping).toBe('people')
  })

  it('× on a list with no unsaved changes closes it at once', () => {
    const dialog = open()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Edit list' }))
    expect(useUIStore.getState().listEditor).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a press in the previewed list closes a list with no unsaved changes, and the press reaches the list', () => {
    open()
    const row = screen.getByRole('button', { name: 'A row' })
    expect(fireEvent.pointerDown(row)).toBe(true)
    expect(useUIStore.getState().listEditor).toBeNull()
  })

  it('a press elsewhere on an unsaved list closes it at once, and the press reaches what it pressed; the draft stays', () => {
    const dialog = open()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Waiting' } })
    const row = screen.getByRole('button', { name: 'A row' })
    let clicked = 0
    row.addEventListener('click', () => { clicked++ })
    expect(fireEvent.pointerDown(row)).toBe(true)
    expect(fireEvent.mouseDown(row)).toBe(true)
    fireEvent.click(row)
    expect(clicked).toBe(1)
    expect(useUIStore.getState().listEditor).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(draft()).toMatchObject({ name: 'Waiting' })
  })

  it('a press on its own list’s Revert · Save or summary toggle is not a press elsewhere', () => {
    render(<><Cell /><button type="button" data-edit-list-keep="7">Save</button><button type="button" data-edit-list-keep="8">Other list</button><EditListHost /></>)
    act(() => useUIStore.getState().openListEditor(7, 't1'))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Save' }))
    expect(useUIStore.getState().listEditor).not.toBeNull()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Other list' }))
    expect(useUIStore.getState().listEditor).toBeNull()
  })

  it('opening Settings closes it at once while the list is unsaved; the draft stays', () => {
    const dialog = open()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Waiting' } })
    act(() => useUIStore.getState().openSettings())
    expect(useUIStore.getState().listEditor).toBeNull()
    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(draft()).toMatchObject({ name: 'Waiting' })
  })

  it('closes when its tab shows another list now (Change list by keyboard): the list left the screen', () => {
    open()
    const switched: PersistedWorkspaceLayout = {
      ...layout,
      columns: [{ id: 'col', weight: 1, cells: [{ id: 'c1', weight: 1, tabs: [{ id: 't1', kind: 'lens', config: { listDefinitionId: 9 } }] }] }],
    }
    act(() => useWorkspaceStore.setState({ working: switched }))
    expect(useUIStore.getState().listEditor).toBeNull()
  })

  it('closes when its list is deleted', () => {
    open()
    act(() => useListDefinitionStore.setState({ listDefinitions: [] }))
    expect(useUIStore.getState().listEditor).toBeNull()
  })
})

describe('Edit list › Copy from…', () => {
  const other: PersistedWorkspaceLayout = { ...layout, id: 2, sortOrder: 1, name: 'Second', columns: [] }
  const calls: PersistedListDefinition = {
    id: 8, name: 'Calls', sortOrder: 1, owner: { layoutId: 2 },
    membership: { kind: 'custom', predicate: { ...emptyPredicate(), searchText: 'call' } },
    sort: 'created', sortDirection: 'desc', grouping: 'status', runtimeFilter: { field: 'tag' }, showFilterLine: false,
  }
  const sibling: PersistedListDefinition = { ...saved, id: 9, name: 'Sibling', sortOrder: 2, owner: { layoutId: 1 }, sort: 'manual', grouping: 'none' }
  const eisenhower: PersistedListDefinition = { ...saved, id: 10, name: 'Eisenhower', sortOrder: 3, owner: { eisenhower: true }, sort: 'manual', grouping: 'none' }

  beforeEach(() => {
    useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout, other] })
    useListDefinitionStore.setState({ listDefinitions: [{ ...saved, owner: { layoutId: 1 } }, calls, sibling, eisenhower] })
    useSettingsStore.setState({ eisenhowerListId: 10 })
  })

  /** The open menu's headings and items, in order. */
  const outline = (menu: HTMLElement) => Array.from(menu.children).flatMap((c) =>
    c.getAttribute('role') === 'presentation' ? [`# ${c.textContent}`] : c.getAttribute('data-menu-label') != null ? [c.getAttribute('data-menu-label')] : [])

  it('offers every list but this one, by layout — this layout first —, then the Eisenhower’s, each with its filters in words', () => {
    const dialog = open()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy from…' }))
    const menu = screen.getByRole('menu', { name: 'Copy from' })
    expect(outline(menu)).toEqual(['# Default · this layout', 'Sibling', '# Second', 'Calls', '# Eisenhower', 'Eisenhower'])
    expect(within(menu).getByRole('menuitem', { name: /^Calls/ })).toHaveTextContent('Text: “call”')
    expect(within(menu).getByRole('menuitem', { name: /^Sibling/ })).toHaveTextContent('All tasks')
  })

  it('a pick copies the source’s parts into the draft — the name kept — as an unsaved edit; Revert drops it', () => {
    const dialog = open()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy from…' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Copy from' })).getByRole('menuitem', { name: /^Calls/ }))
    expect(draft()).toEqual({
      ...saved, owner: { layoutId: 1 },
      membership: { kind: 'custom', predicate: { ...emptyPredicate(), searchText: 'call' } },
      sort: 'created', sortDirection: 'desc', grouping: 'status', runtimeFilter: { field: 'tag' }, showFilterLine: false,
    })
    expect(within(dialog).getByRole('status')).toHaveTextContent('Copied from “Calls” · unsaved')
    expect(Array.from(dialog.querySelectorAll('[data-changed]')).map((el) => el.textContent)).toEqual(['Filters', 'Group by', 'Sort by', 'Prompt for', 'Filter line'])
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Waiting on')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revert' }))
    expect(draft()).toBeUndefined()
  })

  it('a press in the chooser isn’t a press elsewhere: an unsaved list stays open', () => {
    const dialog = open()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Waiting' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy from…' }))
    const item = within(screen.getByRole('menu', { name: 'Copy from' })).getByRole('menuitem', { name: /^Sibling/ })
    fireEvent.pointerDown(item)
    fireEvent.mouseDown(item)
    fireEvent.click(item)
    expect(useUIStore.getState().listEditor).not.toBeNull()
    // The edited name stays; Sibling's parts came in.
    expect(draft()).toMatchObject({ name: 'Waiting', sort: 'manual', grouping: 'none' })
  })
})
