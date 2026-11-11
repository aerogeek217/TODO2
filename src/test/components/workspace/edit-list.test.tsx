import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, act, within } from '@testing-library/react'
import { EditListHost } from '../../../components/workspace/list/EditList'
import { ConfirmPromptHost } from '../../../components/overlays/ConfirmPromptHost'
import { openEditList } from '../../../components/workspace/widget-hooks'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useSettingsStore } from '../../../stores/settings-store'
import type { PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { emptyPredicate } from '../../../models'
import type { PersistedListDefinition } from '../../../models/list-definition'
import { emptyBody, single } from '../../helpers/layout-builders'

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
  render(<><Cell /><EditListHost /><ConfirmPromptHost /></>)
  act(() => useUIStore.getState().openListEditor(7, 't1'))
  return screen.getByRole('dialog', { name: 'Edit list Waiting on' })
}

const QUESTION = 'Save changes to list “Waiting on”?'
const question = () => screen.getByRole('dialog', { name: QUESTION })
/** Answers the close question; its follow-up (a write, the close) lands after. */
async function answer(label: 'Save' | 'Discard' | 'Keep editing') {
  await act(async () => { fireEvent.click(within(question()).getByRole('button', { name: label })) })
}
const editorOpen = () => screen.queryByRole('dialog', { name: /^Edit list/ }) != null

const draft = () => useListDraftStore.getState().drafts[7]

const layout: PersistedWorkspaceLayout = {
  id: 1, sortOrder: 0, name: 'Default', createdAt: new Date(), modifiedAt: new Date(),
  ...single({ id: 'c1', tabs: [{ id: 't1', kind: 'lens', config: { listDefinitionId: 7 } }] }),
}

beforeEach(() => {
  useWorkspaceStore.setState({ working: layout, layouts: [layout] })
  useListDefinitionStore.setState({ listDefinitions: [saved] })
  useListDraftStore.setState({ drafts: {} })
})

afterEach(() => cleanup())

describe('Edit list', () => {
  it('opens on the list as saved: focus in Name, Save disabled, nothing marked changed', () => {
    const dialog = open()
    expect(dialog).not.toHaveAttribute('aria-modal')
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Waiting on')
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Name'))
    expect(within(dialog).getByRole('button', { name: 'Discard' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(dialog.querySelectorAll('[data-changed]')).toHaveLength(0)
    expect(within(dialog).getByRole('button', { name: /^Group by/ })).toHaveTextContent('People')
    expect(within(dialog).getByRole('button', { name: /^Sort by/ })).toHaveTextContent('Due date')
    expect(within(dialog).getByRole('button', { name: /^Prompt for/ })).toHaveTextContent('Nothing')
    expect(dialog).toHaveTextContent('In 1 widget')
    // No Max tasks any more.
    expect(dialog).not.toHaveTextContent('Max tasks:')
  })

  it('every control edits the draft at once (the list’s widgets draw it), nothing is written, and the changed rows are marked', () => {
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
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(useListDefinitionStore.getState().listDefinitions[0]).toBe(saved)
    expect(localStorage.getItem('todo2-unsaved-lists')).toBeNull()
  })

  it('typing in the form measures the list’s panel no more; a resize measures it again', () => {
    const dialog = open()
    const cell = document.querySelector('[data-ws-cell="c1"]')!
    let measured = 0
    const real = cell.getBoundingClientRect.bind(cell)
    cell.getBoundingClientRect = () => { measured++; return real() }
    const name = within(dialog).getByLabelText('Name')
    for (const value of ['W', 'Wa', 'Wai', 'Wait']) fireEvent.change(name, { target: { value } })
    expect(draft()!.name).toBe('Wait')
    expect(measured).toBe(0)
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(measured).toBeGreaterThan(0)
    expect(screen.getByRole('dialog', { name: 'Edit list Wait' })).toBeInTheDocument()
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

  it('Save writes the draft for good as one undo step, and closes it', async () => {
    const dialog = open()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Sort by/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Name' }))
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save' })) })
    expect(draft()).toBeUndefined()
    expect(useListDefinitionStore.getState().listDefinitions[0]!.sort).toBe('name')
    expect(editorOpen()).toBe(false)
    expect(useUIStore.getState().listEditor).toBeNull()
    await vi.waitFor(() => expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Edited list “Waiting on”']))
    await act(() => useUndoStore.getState().undo())
    expect(useListDefinitionStore.getState().listDefinitions[0]!.sort).toBe('deadline')
  })

  it('Save writes only what the draft changed: a lens switch written meanwhile stays', async () => {
    const dialog = open()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Waiting' } })
    await act(() => useListDefinitionStore.getState().setIgnoreLens(7, true))
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save' })) })
    expect(useListDefinitionStore.getState().listDefinitions[0]).toMatchObject({ name: 'Waiting', ignoreLens: true, sort: 'deadline' })
  })

  it('Discard drops the draft and closes it, writing nothing', () => {
    const dialog = open()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Sort by/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Name' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }))
    expect(draft()).toBeUndefined()
    expect(editorOpen()).toBe(false)
    expect(useListDefinitionStore.getState().listDefinitions[0]).toBe(saved)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('an empty name can’t be saved', () => {
    const dialog = open()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: ' ' } })
    expect(within(dialog).getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toHaveAttribute('title', 'Name the list to save it')
  })

  it('Esc closes a list with no changes at once; an Esc that closes a menu inside only closes the menu', () => {
    const dialog = open()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Sort by/ }))
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Sort by' }), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(useUIStore.getState().listEditor).not.toBeNull()

    fireEvent.keyDown(within(dialog).getByLabelText('Name'), { key: 'Escape' })
    expect(useUIStore.getState().listEditor).toBeNull()
    expect(editorOpen()).toBe(false)
    expect(useUIStore.getState().confirmPrompts).toHaveLength(0)
  })

  it.each([
    ['Esc', (dialog: HTMLElement) => fireEvent.keyDown(within(dialog).getByLabelText('Name'), { key: 'Escape' })],
    ['×', (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: 'Close Edit list' }))],
  ])('%s with changes asks Save / Discard / Keep editing: Keep editing keeps them, Discard drops them', async (_key, close) => {
    const dialog = open()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Group by/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Status' }))
    close(dialog)
    await answer('Keep editing')
    expect(editorOpen()).toBe(true)
    expect(draft()).toMatchObject({ grouping: 'status' })
    close(screen.getByRole('dialog', { name: 'Edit list Waiting on' }))
    await answer('Discard')
    expect(editorOpen()).toBe(false)
    expect(draft()).toBeUndefined()
    expect(useListDefinitionStore.getState().listDefinitions[0]!.grouping).toBe('people')
  })

  it('the question’s Save writes the edits and closes', async () => {
    const dialog = open()
    fireEvent.click(within(dialog).getByRole('button', { name: /^Group by/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Status' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Edit list' }))
    await answer('Save')
    expect(editorOpen()).toBe(false)
    expect(useListDefinitionStore.getState().listDefinitions[0]!.grouping).toBe('status')
  })

  it('× on a list with no changes closes it at once', () => {
    const dialog = open()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Edit list' }))
    expect(useUIStore.getState().listEditor).toBeNull()
    expect(editorOpen()).toBe(false)
  })

  it('a press in the previewed list closes a list with no changes, and the press reaches the list', () => {
    open()
    const row = screen.getByRole('button', { name: 'A row' })
    expect(fireEvent.pointerDown(row)).toBe(true)
    expect(useUIStore.getState().listEditor).toBeNull()
  })

  it('a press elsewhere with changes asks, and goes no further', async () => {
    const dialog = open()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Waiting' } })
    const row = screen.getByRole('button', { name: 'A row' })
    let clicked = 0
    row.addEventListener('click', () => { clicked++ })
    fireEvent.pointerDown(row)
    fireEvent.mouseDown(row)
    fireEvent.click(row)
    expect(clicked).toBe(0)
    expect(question()).toBeInTheDocument()
    expect(editorOpen()).toBe(true)
    await answer('Keep editing')
    expect(draft()).toMatchObject({ name: 'Waiting' })
  })

  it('a press on a control acting on its own list (the line’s words or summary) is not a press elsewhere', () => {
    render(<><Cell /><button type="button" data-edit-list-keep="7">Words</button><button type="button" data-edit-list-keep="8">Other list</button><EditListHost /></>)
    act(() => useUIStore.getState().openListEditor(7, 't1'))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Words' }))
    expect(useUIStore.getState().listEditor).not.toBeNull()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Other list' }))
    expect(useUIStore.getState().listEditor).toBeNull()
  })

  it('Edit list asked for another list while this one has changes asks first; Save or Discard, then the other opens', async () => {
    const other: PersistedListDefinition = { ...saved, id: 9, name: 'Other', sortOrder: 1 }
    useListDefinitionStore.setState({ listDefinitions: [saved, other] })
    const dialog = open()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Waiting' } })
    act(() => openEditList('t2', 9))
    expect(question()).toBeInTheDocument()
    expect(useUIStore.getState().listEditor).toEqual({ listDefinitionId: 7, tabId: 't1' })
    // Keep editing: everything as it was.
    await answer('Keep editing')
    expect(useUIStore.getState().listEditor).toEqual({ listDefinitionId: 7, tabId: 't1' })
    expect(draft()).toMatchObject({ name: 'Waiting' })
    // Save: written, then the other list's Edit list opens.
    act(() => openEditList('t2', 9))
    await answer('Save')
    expect(useUIStore.getState().listEditor).toEqual({ listDefinitionId: 9, tabId: 't2' })
    await vi.waitFor(() => expect(useListDefinitionStore.getState().listDefinitions.find((d) => d.id === 7)?.name).toBe('Waiting'))
    // Unchanged, it gives way at once; the same target again changes nothing.
    act(() => openEditList('t1', 7))
    expect(useUIStore.getState().confirmPrompts).toHaveLength(0)
    expect(useUIStore.getState().listEditor).toEqual({ listDefinitionId: 7, tabId: 't1' })
    act(() => openEditList('t1', 7))
    expect(useUIStore.getState().listEditor).toEqual({ listDefinitionId: 7, tabId: 't1' })
  })

  it('opening Settings with changes asks: Keep editing stays; Discard drops the draft, then Settings opens', async () => {
    const dialog = open()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Waiting' } })
    act(() => useUIStore.getState().openSettings('lenses'))
    expect(question()).toBeInTheDocument()
    expect(useUIStore.getState().settingsOpen).toBe(false)
    await answer('Keep editing')
    expect(useUIStore.getState().settingsOpen).toBe(false)
    expect(editorOpen()).toBe(true)
    act(() => useUIStore.getState().openSettings('lenses'))
    await answer('Discard')
    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().listEditor).toBeNull()
    expect(draft()).toBeUndefined()
    expect(useListDefinitionStore.getState().listDefinitions[0]).toBe(saved)
  })

  it('opening Settings with no changes closes it at once', () => {
    open()
    act(() => useUIStore.getState().openSettings())
    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(editorOpen()).toBe(false)
    expect(useUIStore.getState().confirmPrompts).toHaveLength(0)
  })

  it('a layout switch with changes asks first; Save writes the list, then the layout opens', async () => {
    const loadSpy = vi.spyOn(useWorkspaceStore.getState(), 'load')
    const dialog = open()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Waiting' } })
    let switched: Promise<void> | undefined
    act(() => { switched = useWorkspaceStore.getState().load(2) })
    expect(question()).toBeInTheDocument()
    await answer('Save')
    await act(async () => { await switched })
    expect(loadSpy).toHaveBeenCalled()
    await vi.waitFor(() => expect(useListDefinitionStore.getState().listDefinitions[0]?.name).toBe('Waiting'))
    expect(editorOpen()).toBe(false)
  })

  it('closed from outside with changes (a data replace, its list gone) says its changes weren’t saved', () => {
    const dialog = open()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Waiting' } })
    act(() => {
      useUIStore.getState().closeListEditor()
      useListDraftStore.setState({ drafts: {} })
    })
    expect(editorOpen()).toBe(false)
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'Edit list closed: its changes to “Waiting on” weren’t saved.' })
  })

  it('closes when its tab shows another list now (an undo, a kind change): the list left the screen', () => {
    open()
    const switched: PersistedWorkspaceLayout = {
      ...layout,
      ...single({ id: 'c1', tabs: [{ id: 't1', kind: 'lens', config: { listDefinitionId: 9 } }] }),
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
  const other: PersistedWorkspaceLayout = { ...layout, id: 2, sortOrder: 1, name: 'Second', ...emptyBody() }
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

  it('a pick copies the source’s parts into the draft — the name kept — as an unsaved edit; Discard drops it', () => {
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
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }))
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
