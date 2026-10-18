import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { ListEditorBody } from '../../../components/shared/ListEditorBody'
import { emptyPredicate } from '../../../models'
import { useStatusStore } from '../../../stores/status-store'
import type { PersistedListDefinition } from '../../../models'

function makeDraft(overrides: Partial<PersistedListDefinition> = {}): PersistedListDefinition {
  return {
    id: 1,
    name: 'Test list',
    sortOrder: 0,
    membership: { kind: 'custom', predicate: emptyPredicate() },
    sort: 'manual',
    grouping: 'none',
    ...overrides,
  }
}

function last(onChange: ReturnType<typeof vi.fn>): PersistedListDefinition {
  return onChange.mock.calls.at(-1)![0] as PersistedListDefinition
}

/** Opens a select-button's radio menu (`Group by` / `Sort by` / `Prompt for`). */
function openChoices(row: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${row}`) }))
}

/** The labels of the open radio menu's choices. */
const choiceLabels = () => screen.getAllByRole('menuitemradio').map((el) => el.getAttribute('data-menu-label'))

describe('<ListEditorBody>', () => {
  afterEach(() => { cleanup() })

  it('renders the name input bound to the draft', () => {
    const onChange = vi.fn()
    render(<ListEditorBody draft={makeDraft({ name: 'My list' })} onChange={onChange} />)
    const input = screen.getByPlaceholderText('List name') as HTMLInputElement
    expect(input.value).toBe('My list')
    fireEvent.change(input, { target: { value: 'Renamed' } })
    expect(last(onChange).name).toBe('Renamed')
  })

  it('sets the sort and grouping as flat values, keeping the rest', () => {
    const onChange = vi.fn()
    render(<ListEditorBody draft={makeDraft()} onChange={onChange} />)
    openChoices('Sort by')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Due date' }))
    expect(last(onChange)).toMatchObject({ sort: 'deadline', grouping: 'none', name: 'Test list' })
    openChoices('Group by')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'People' }))
    expect(last(onChange).grouping).toBe('people')
  })

  it('offers the list choices, plus a stored sort no longer offered', () => {
    render(<ListEditorBody draft={makeDraft({ sort: 'status', grouping: 'tag' })} onChange={vi.fn()} />)
    openChoices('Sort by')
    expect(choiceLabels()).toEqual(['Manual', 'Priority', 'Due date', 'Follow-up date', 'Name', 'Created', 'Status'])
    expect(screen.getByRole('menuitemradio', { name: /^Status/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Sort by' }), { key: 'Escape' })
    openChoices('Group by')
    expect(choiceLabels()).toEqual(['No grouping', 'Due date', 'Follow-up date', 'People', 'Status', 'Tag'])
  })

  it('an unset Group by is a blank field with a muted "Group by…" placeholder — no "None" text', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ListEditorBody draft={makeDraft()} onChange={onChange} />)
    const group = screen.getByRole('button', { name: 'Group by' })
    expect(group).toHaveTextContent('Group by…')
    expect(group.querySelector('[data-placeholder]')).toHaveTextContent('Group by…')
    expect(document.body).not.toHaveTextContent(/\bNone\b/)
    // The menu's way back to no groups.
    rerender(<ListEditorBody draft={makeDraft({ grouping: 'people' })} onChange={onChange} />)
    expect(screen.getByRole('button', { name: /^Group by/ })).toHaveTextContent('People')
    openChoices('Group by')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'No grouping' }))
    expect(last(onChange).grouping).toBe('none')
  })

  it('phone sheet: an unset Group by row shows no value', () => {
    render(<ListEditorBody draft={makeDraft()} onChange={vi.fn()} variant="sheet" />)
    const row = screen.getByRole('button', { name: 'Group by' })
    expect(row.textContent).toBe('Group by')
    expect(document.body).not.toHaveTextContent(/\bNone\b/)
  })

  it('has no Max tasks control: a list shows all its tasks', () => {
    render(<ListEditorBody draft={makeDraft()} onChange={vi.fn()} />)
    expect(screen.queryByLabelText('Max tasks')).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'When over the max' })).toBeNull()
  })

  it('toggles show completed in the predicate', () => {
    const onChange = vi.fn()
    render(<ListEditorBody draft={makeDraft()} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Show completed tasks'))
    expect(last(onChange).membership.predicate.showCompleted).toBe(true)
  })

  it('shows the list filters as chips; × removes one', () => {
    useStatusStore.setState({ statuses: [{ id: 4, name: 'Waiting', color: '#aa0', sortOrder: 0 }] })
    const onChange = vi.fn()
    const predicate = { ...emptyPredicate(), statusIds: [4] }
    render(<ListEditorBody draft={makeDraft({ membership: { kind: 'custom', predicate } })} onChange={onChange} />)
    expect(screen.getByTestId('list-filter-chip').textContent).toContain('Waiting')
    fireEvent.click(screen.getByLabelText('Remove filter'))
    expect(last(onChange).membership.predicate.statusIds).toBeNull()
  })

  it('sets the prompt field, and clears it with Nothing', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ListEditorBody draft={makeDraft()} onChange={onChange} />)
    openChoices('Prompt for')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Person' }))
    expect(last(onChange).runtimeFilter).toEqual({ field: 'person' })
    rerender(<ListEditorBody draft={makeDraft({ runtimeFilter: { field: 'tag' } })} onChange={onChange} />)
    openChoices('Prompt for')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Nothing' }))
    expect(last(onChange).runtimeFilter).toBeUndefined()
  })

  it('picking the current choice changes nothing', () => {
    const onChange = vi.fn()
    render(<ListEditorBody draft={makeDraft()} onChange={onChange} />)
    openChoices('Sort by')
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Manual/ }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('with the saved list, marks the rows that differ from it', () => {
    const saved = makeDraft()
    const draft = makeDraft({ name: 'Renamed', sort: 'priority', runtimeFilter: { field: 'person' } })
    const { container } = render(<ListEditorBody draft={draft} saved={saved} onChange={vi.fn()} />)
    expect(Array.from(container.querySelectorAll('[data-changed]')).map((el) => el.textContent)).toEqual(['Name', 'Sort by', 'Prompt for'])
  })

  it('phone sheet: choices are rows that open a list of radios; Show completed is a switch', () => {
    const onChange = vi.fn()
    render(<ListEditorBody draft={makeDraft({ grouping: 'status' })} saved={makeDraft()} onChange={onChange} variant="sheet" />)
    const groupRow = screen.getByRole('button', { name: 'Group by: Status' })
    expect(groupRow).toHaveAttribute('data-changed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Sort by: Manual' }))
    const radios = screen.getByRole('radiogroup', { name: 'Sort by' })
    expect(radios).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /^Priority/ }))
    expect(last(onChange).sort).toBe('priority')
    // Back on the form.
    expect(screen.getByRole('button', { name: /^Group by:/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch'))
    expect(last(onChange).membership.predicate.showCompleted).toBe(true)
  })
})
