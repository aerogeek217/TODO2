import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { LensesSection } from '../../../components/settings/sections/LensesSection'
import { emptyPredicate } from '../../../models/filter-predicate'
import type { PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { makeTodo, resetDb } from '../../helpers'

const layout = (id: number, name: string, lensId?: string): PersistedWorkspaceLayout => ({
  id, name, sortOrder: id, columns: [], createdAt: new Date(0), modifiedAt: new Date(0), ...(lensId ? { lensId } : {}),
})

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

  it('a row says which layouts use the lens; open, it edits with the filter chips and says what it keeps now', async () => {
    useSettingsStore.setState({
      lensPresetsSeeded: true,
      lenses: [{ id: 'lens-w', name: 'Not waiting', predicate: { ...emptyPredicate(), statusIds: [3], negate: { statusIds: true } } }],
    })
    useWorkspaceStore.setState({ layouts: [layout(1, 'Default', 'lens-w'), layout(2, 'Planning', 'lens-w')], working: layout(1, 'Default', 'lens-w') })
    render(<LensesSection />)
    const [row] = rows()
    expect(row).toHaveTextContent('Not waiting')
    expect(row).toHaveTextContent('Default, Planning')
    fireEvent.click(row!)
    expect(screen.getByTestId('lens-keeps')).toHaveTextContent('Keeps 1 of 2 open tasks right now · used by Default, Planning')
    const chips = screen.getByTestId('lens-filter')
    expect(within(chips).getByTestId('list-filter-chip')).toHaveTextContent('Statusnot Waiting')
    // × removes the clause: every open task again.
    fireEvent.click(within(chips).getByRole('button', { name: 'Remove filter' }))
    await waitFor(() => expect(useSettingsStore.getState().lenses[0]!.predicate.statusIds).toBeNull())
    expect(screen.getByTestId('lens-keeps')).toHaveTextContent('Keeps 2 of 2 open tasks')
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
})
