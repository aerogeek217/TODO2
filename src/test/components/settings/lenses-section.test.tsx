import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react'
import { ConfirmPromptHost } from '../../../components/overlays/ConfirmPromptHost'
import { SettingsModal } from '../../../components/settings/SettingsModal'
import { LensesSection } from '../../../components/settings/sections/LensesSection'
import { SettingsLayerContext } from '../../../components/settings/sections/settings-layer'
import { emptyFilterClauses, emptyPredicate } from '../../../models/filter-predicate'
import { useLensDraftStore } from '../../../stores/lens-draft-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import { makeTodo, resetDb } from '../../helpers'

beforeEach(async () => {
  await resetDb()
  useStatusStore.setState({ statuses: [{ id: 3, name: 'Waiting', color: '#aa0', sortOrder: 0 }], loaded: true })
  useTodoStore.setState({ todos: [
    makeTodo({ id: 1, title: 'Waits', statusId: 3 }),
    makeTodo({ id: 2, title: 'Goes' }),
    makeTodo({ id: 3, title: 'Done', isCompleted: true }),
  ] })
})

afterEach(cleanup)

const rows = () => within(screen.getByTestId('lens-list')).getAllByRole('button', { expanded: false })

describe('Settings › Tasks › Lenses', () => {
  it('the first open seeds the presets — Not waiting with a Waiting status — once', async () => {
    render(<LensesSection />)
    await waitFor(() => expect(useSettingsStore.getState().lenses.map((l) => l.name)).toEqual(['This month', 'Not waiting', 'Has a person', 'Fresh']))
    expect(useSettingsStore.getState().lensPresetsSeeded).toBe(true)
    expect(screen.getByText('Status not Waiting')).toBeInTheDocument()
    expect(screen.getByText('People not Unassigned')).toBeInTheDocument()
  })

  it('the top bar’s pick says In use; open, a row edits with the filter chips and says what it keeps now', async () => {
    useSettingsStore.setState({
      lensPresetsSeeded: true,
      lenses: [
        { id: 'lens-w', name: 'Not waiting', predicate: { ...emptyPredicate(), statusIds: [3], negate: { statusIds: true } } },
        { id: 'lens-x', name: 'Every task', predicate: emptyPredicate() },
      ],
      activeLensId: 'lens-w',
    })
    render(<LensesSection />)
    const [row, other] = rows()
    expect(row).toHaveTextContent('Not waiting')
    expect(row).toHaveTextContent('In use')
    expect(other).not.toHaveTextContent('In use')
    expect(screen.getByTestId('lens-list')).not.toHaveTextContent(/used by/i)
    fireEvent.click(row!)
    expect(screen.getByTestId('lens-keeps')).toHaveTextContent(/^Keeps 1 of 2 open tasks right now$/)
    const chips = screen.getByTestId('lens-filter')
    expect(within(chips).getByTestId('list-filter-chip')).toHaveTextContent('Statusnot Waiting')
    // × removes the clause — a draft: the editor shows every open task, the lens is unchanged until Save.
    fireEvent.click(within(chips).getByRole('button', { name: 'Remove filter' }))
    expect(screen.getByTestId('lens-keeps')).toHaveTextContent('Keeps 2 of 2 open tasks')
    expect(useSettingsStore.getState().lenses[0]!.predicate.statusIds).toEqual([3])
    fireEvent.click(screen.getByRole('button', { name: 'Save lens Not waiting' }))
    await waitFor(() => expect(useSettingsStore.getState().lenses[0]!.predicate.statusIds).toBeNull())
    expect(screen.queryByTestId('save-lens')).toBeNull()
  })

  it('a lens whose only filter is a group reads the group in words and keeps what any of its filters keeps', () => {
    useTodoStore.setState({ todos: [...useTodoStore.getState().todos, makeTodo({ id: 4, title: 'Other' })] })
    useSettingsStore.setState({
      lensPresetsSeeded: true,
      lenses: [{ id: 'lens-g', name: 'Either', predicate: { ...emptyPredicate(), orGroups: [{ ...emptyFilterClauses(), statusIds: [3], searchText: 'goes' }] } }],
    })
    render(<LensesSection />)
    const [row] = rows()
    expect(row).toHaveTextContent('Status Waiting or Text “goes”')
    fireEvent.click(row!)
    expect(screen.queryByText('No filter — every task')).toBeNull()
    expect(screen.getByTestId('lens-keeps')).toHaveTextContent('Keeps 2 of 3 open tasks right now')
  })

  it('Rename in place (Esc cancels), Duplicate after it, + New lens opens a new one to name', async () => {
    useSettingsStore.setState({ lensPresetsSeeded: true, lenses: [{ id: 'lens-a', name: 'Fresh', predicate: emptyPredicate() }] })
    render(<LensesSection />)
    fireEvent.click(rows()[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const field = screen.getByRole('textbox', { name: 'Lens name' })
    fireEvent.change(field, { target: { value: 'Recent' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() => expect(useSettingsStore.getState().lenses[0]!.name).toBe('Recent'))

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    await waitFor(() => expect(useSettingsStore.getState().lenses.map((l) => l.name)).toEqual(['Recent', 'Recent 2']))

    fireEvent.click(screen.getByRole('button', { name: /New lens/ }))
    const name = await screen.findByRole('textbox', { name: 'Lens name' })
    expect(name).toHaveValue('New lens')
    fireEvent.keyDown(name, { key: 'Escape' })
    expect(useSettingsStore.getState().lenses.map((l) => l.name)).toEqual(['Recent', 'Recent 2', 'New lens'])
  })

  it('each row has a grip named for its lens; a move reorders the rows and an open lens stays open', async () => {
    useSettingsStore.setState({
      lensPresetsSeeded: true,
      lenses: [
        { id: 'lens-a', name: 'Alpha', predicate: emptyPredicate() },
        { id: 'lens-b', name: 'Beta', predicate: emptyPredicate() },
        { id: 'lens-c', name: 'Gamma', predicate: emptyPredicate() },
      ],
    })
    render(<LensesSection />)
    const list = screen.getByTestId('lens-list')
    const grips = () => within(list).getAllByRole('button', { name: /^Move / }).map((g) => g.getAttribute('aria-label'))
    expect(grips()).toEqual(['Move Alpha', 'Move Beta', 'Move Gamma'])
    // The grip isn't the head: pressing it doesn't open the lens.
    fireEvent.click(within(list).getByRole('button', { name: 'Move Alpha' }))
    expect(screen.queryByTestId('lens-filter')).toBeNull()

    fireEvent.click(within(list).getByRole('button', { name: /^Alpha/, expanded: false }))
    expect(screen.getByTestId('lens-filter')).toBeInTheDocument()
    await useSettingsStore.getState().moveLens(0, 2)
    await waitFor(() => expect(grips()).toEqual(['Move Beta', 'Move Gamma', 'Move Alpha']))
    expect(within(list).getByRole('button', { name: /^Alpha/, expanded: true })).toBeInTheDocument()
    expect(screen.getByTestId('lens-filter').closest('[data-lens-id]')).toHaveAttribute('data-lens-id', 'lens-a')
  })

  it('while a lens is held it is a Settings layer (Esc cancels the drag, not Settings)', async () => {
    useSettingsStore.setState({
      lensPresetsSeeded: true,
      lenses: [
        { id: 'lens-a', name: 'Alpha', predicate: emptyPredicate() },
        { id: 'lens-b', name: 'Beta', predicate: emptyPredicate() },
      ],
    })
    let layers = 0
    render(
      <SettingsLayerContext.Provider value={(delta) => { layers += delta }}>
        <LensesSection />
      </SettingsLayerContext.Provider>,
    )
    const grip = screen.getByRole('button', { name: 'Move Alpha' })
    grip.focus()
    fireEvent.keyDown(grip, { key: ' ', code: 'Space' })
    await waitFor(() => expect(layers).toBe(1))
    // The sensor listens on the document from the next tick.
    await new Promise((r) => setTimeout(r, 0))
    fireEvent.keyDown(grip, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(layers).toBe(0))
    expect(useSettingsStore.getState().lenses.map((l) => l.name)).toEqual(['Alpha', 'Beta'])
  })

  it('in the Settings modal, Esc from the held grip (inside the panel) cancels the drag and Settings stays; then Esc closes it', async () => {
    useSettingsStore.setState({
      lensPresetsSeeded: true,
      lenses: [
        { id: 'lens-a', name: 'Alpha', predicate: emptyPredicate() },
        { id: 'lens-b', name: 'Beta', predicate: emptyPredicate() },
      ],
    })
    render(<SettingsModal />)
    act(() => useUIStore.getState().openSettings('lenses'))
    const panel = screen.getByRole('dialog', { name: 'Settings' })
    const grip = within(panel).getByRole('button', { name: 'Move Alpha' })
    grip.focus()
    fireEvent.keyDown(grip, { key: ' ', code: 'Space' })
    await new Promise((r) => setTimeout(r, 0))
    await waitFor(() => expect(grip).toHaveAttribute('aria-pressed', 'true'))

    fireEvent.keyDown(grip, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(grip).not.toHaveAttribute('aria-pressed', 'true'))
    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useSettingsStore.getState().lenses.map((l) => l.name)).toEqual(['Alpha', 'Beta'])

    fireEvent.keyDown(grip, { key: 'Escape', code: 'Escape' })
    expect(useUIStore.getState().settingsOpen).toBe(false)
  })
})

describe('Settings › Tasks › Lenses — filter edits are saved or reverted', () => {
  const twoLenses = () => useSettingsStore.setState({
    lensPresetsSeeded: true,
    lenses: [
      { id: 'lens-w', name: 'Not waiting', predicate: { ...emptyPredicate(), statusIds: [3], negate: { statusIds: true } } },
      { id: 'lens-x', name: 'Every task', predicate: emptyPredicate() },
    ],
    activeLensId: 'lens-w',
  })
  const saved = () => useSettingsStore.getState().lenses.find((l) => l.id === 'lens-w')!.predicate
  // The head button (the grips are `Move <name>`).
  const head = (name: RegExp) => within(screen.getByTestId('lens-list')).getByRole('button', { name })
  const promptDialog = () => screen.getByRole('dialog', { name: 'Save changes to lens “Not waiting”?' })

  /** Opens Not waiting and removes its filter: a draft. */
  function draftIt() {
    render(<><LensesSection /><ConfirmPromptHost /></>)
    fireEvent.click(head(/^Not waiting/))
    fireEvent.click(within(screen.getByTestId('lens-filter')).getByRole('button', { name: 'Remove filter' }))
  }

  beforeEach(twoLenses)

  it('while drafting the row, chips and Keeps show the draft, marked Unsaved; the saved lens (the top bar’s) is unchanged', () => {
    draftIt()
    const row = head(/^Not waiting/)
    expect(row).toHaveTextContent('Unsaved')
    expect(row).not.toHaveTextContent('Status not Waiting')
    expect(screen.getByText('No filter — every task')).toBeInTheDocument()
    expect(screen.getByTestId('lens-keeps')).toHaveTextContent('Keeps 2 of 2 open tasks')
    expect(saved().statusIds).toEqual([3])
    expect(useSettingsStore.getState().activeLensId).toBe('lens-w')
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Revert lens changes' })).toBeInTheDocument()
  })

  it('Revert puts the saved filter back; Undo in the snackbar brings the draft back', async () => {
    // Undo brings it back only where Settings shows it (Tasks).
    useUIStore.setState({ settingsOpen: true, settingsSection: 'tasks' })
    draftIt()
    fireEvent.click(screen.getByRole('button', { name: 'Revert lens changes' }))
    expect(head(/^Not waiting/)).not.toHaveTextContent('Unsaved')
    expect(screen.getByTestId('lens-keeps')).toHaveTextContent('Keeps 1 of 2 open tasks')
    await act(() => useUndoStore.getState().undo())
    expect(head(/^Not waiting/)).toHaveTextContent('Unsaved')
    expect(saved().statusIds).toEqual([3])
  })

  it('collapsing it asks: Keep editing stays open with the draft; Discard collapses it unsaved', async () => {
    draftIt()
    fireEvent.click(head(/^Not waiting/))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Keep editing/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(head(/^Not waiting/)).toHaveAttribute('aria-expanded', 'true')
    expect(head(/^Not waiting/)).toHaveTextContent('Unsaved')

    fireEvent.click(head(/^Not waiting/))
    fireEvent.click(within(promptDialog()).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(head(/^Not waiting/)).toHaveAttribute('aria-expanded', 'false'))
    expect(head(/^Not waiting/)).not.toHaveTextContent('Unsaved')
    expect(saved().statusIds).toEqual([3])
  })

  it('opening another lens asks; Save lens saves (one undo step) and opens it', async () => {
    draftIt()
    fireEvent.click(head(/^Every task/))
    expect(head(/^Every task/)).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(within(promptDialog()).getByRole('button', { name: 'Save lens' }))
    await waitFor(() => expect(head(/^Every task/)).toHaveAttribute('aria-expanded', 'true'))
    expect(saved().statusIds).toBeNull()
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Changed lens “Not waiting”'])
  })

  it('+ New lens and Duplicate ask first; Keep editing does neither', async () => {
    draftIt()
    fireEvent.click(screen.getByRole('button', { name: /New lens/ }))
    fireEvent.click(within(promptDialog()).getByRole('button', { name: /Keep editing/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Keep editing/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(useSettingsStore.getState().lenses.map((l) => l.name)).toEqual(['Not waiting', 'Every task'])

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    fireEvent.click(within(promptDialog()).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(useSettingsStore.getState().lenses.map((l) => l.name)).toEqual(['Not waiting', 'Not waiting 2', 'Every task']))
    // The copy is of the saved lens.
    expect(useSettingsStore.getState().lenses[1]!.predicate.statusIds).toEqual([3])
    // Shown at once, saved after: the test ends once the save's undo step is in.
    await waitFor(() => expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Duplicated lens “Not waiting”']))
  })

  it('Rename keeps the draft; Delete drops it without asking', async () => {
    draftIt()
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const field = screen.getByRole('textbox', { name: 'Lens name' })
    fireEvent.change(field, { target: { value: 'Quiet' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() => expect(head(/^Quiet/)).toHaveTextContent('Unsaved'))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(useSettingsStore.getState().lenses.map((l) => l.name)).toEqual(['Every task']))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(useLensDraftStore.getState().draft).toBeNull())
  })
})
