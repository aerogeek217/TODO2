import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { LensesSection } from '../../../components/settings/sections/LensesSection'
import { SettingsLayerContext } from '../../../components/settings/sections/settings-layer'
import { emptyFilterClauses, emptyPredicate } from '../../../models/filter-predicate'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTodoStore } from '../../../stores/todo-store'
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
    // × removes the clause: every open task again.
    fireEvent.click(within(chips).getByRole('button', { name: 'Remove filter' }))
    await waitFor(() => expect(useSettingsStore.getState().lenses[0]!.predicate.statusIds).toBeNull())
    expect(screen.getByTestId('lens-keeps')).toHaveTextContent('Keeps 2 of 2 open tasks')
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
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(layers).toBe(0))
    expect(useSettingsStore.getState().lenses.map((l) => l.name)).toEqual(['Alpha', 'Beta'])
  })
})
