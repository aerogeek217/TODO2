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
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'deadline' } })
    expect(last(onChange)).toMatchObject({ sort: 'deadline', grouping: 'none', name: 'Test list' })
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'people' } })
    expect(last(onChange).grouping).toBe('people')
  })

  it('offers the list choices, plus a stored sort no longer offered', () => {
    render(<ListEditorBody draft={makeDraft({ sort: 'status', grouping: 'tag' })} onChange={vi.fn()} />)
    const sorts = Array.from((screen.getByLabelText('Sort by') as HTMLSelectElement).options).map((o) => o.textContent)
    expect(sorts).toEqual(['Manual', 'Priority', 'Due date', 'Follow-up date', 'Name', 'Created', 'Status'])
    const groups = Array.from((screen.getByLabelText('Group by') as HTMLSelectElement).options).map((o) => o.value)
    expect(groups).toEqual(['none', 'deadline', 'followup', 'people', 'status', 'tag'])
  })

  it('sets max tasks and its limit mode; clearing removes the cap', () => {
    const onChange = vi.fn()
    render(<ListEditorBody draft={makeDraft({ maxTasks: 5 })} onChange={onChange} />)
    const max = screen.getByLabelText('Max tasks') as HTMLInputElement
    expect(max.value).toBe('5')
    fireEvent.change(max, { target: { value: '12' } })
    expect(last(onChange).maxTasks).toBe(12)
    fireEvent.change(max, { target: { value: '' } })
    expect(last(onChange).maxTasks).toBeUndefined()
    fireEvent.click(screen.getByRole('radio', { name: 'Scroll' }))
    expect(last(onChange).limitMode).toBe('scroll')
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
    fireEvent.change(screen.getByLabelText('Prompt for'), { target: { value: 'person' } })
    expect(last(onChange).runtimeFilter).toEqual({ field: 'person' })
    rerender(<ListEditorBody draft={makeDraft({ runtimeFilter: { field: 'tag' } })} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Prompt for'), { target: { value: 'none' } })
    expect(last(onChange).runtimeFilter).toBeUndefined()
  })
})
