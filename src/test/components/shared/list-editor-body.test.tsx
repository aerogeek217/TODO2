import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { ListEditorBody } from '../../../components/shared/ListEditorBody'
import { emptyPredicate } from '../../../stores/list-definition-store'
import type { PersistedListDefinition } from '../../../models'

/**
 * ListEditorBody migrated to <SortGroupToolbar> + flat literals
 * (ui-consistency-2026-04-25 P4). The encoder/decoder helpers are gone;
 * draft.sort and draft.grouping round-trip as plain strings.
 */

function makeDraft(overrides: Partial<PersistedListDefinition> = {}): PersistedListDefinition {
  return {
    id: 1,
    name: 'Test list',
    sortOrder: 0,
    pinnedToDashboard: true,
    favorited: false,
    membership: { kind: 'custom', predicate: emptyPredicate() },
    sort: 'manual',
    grouping: 'none',
    ...overrides,
  }
}

describe('<ListEditorBody>', () => {
  afterEach(() => { cleanup() })

  it('renders the name input bound to the draft', () => {
    const onChange = vi.fn()
    render(<ListEditorBody draft={makeDraft({ name: 'My list' })} onChange={onChange} />)
    const input = screen.getByPlaceholderText('List name') as HTMLInputElement
    expect(input.value).toBe('My list')
    fireEvent.change(input, { target: { value: 'Renamed' } })
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls.at(-1)![0].name).toBe('Renamed')
  })

  it('emits a flat-string sort when the sort dropdown changes', () => {
    const onChange = vi.fn()
    render(<ListEditorBody draft={makeDraft({ sort: 'manual' })} onChange={onChange} />)
    // SortGroupToolbar comfortable density wraps two IconSelect triggers; pick
    // the Sort one by its 'Sort tasks by' aria-label
    const sortTrigger = screen.getByLabelText('Sort tasks by')
    fireEvent.click(sortTrigger)
    fireEvent.click(screen.getByText('Effective date'))
    expect(onChange).toHaveBeenCalled()
    const next = onChange.mock.calls.at(-1)![0] as PersistedListDefinition
    expect(next.sort).toBe('date')
    // Untouched fields preserved.
    expect(next.grouping).toBe('none')
    expect(next.name).toBe('Test list')
  })

  it('emits a flat-string grouping when the group dropdown changes', () => {
    const onChange = vi.fn()
    render(<ListEditorBody draft={makeDraft()} onChange={onChange} />)
    const groupTrigger = screen.getByLabelText('Group tasks by')
    fireEvent.click(groupTrigger)
    fireEvent.click(screen.getByText('By project'))
    expect(onChange).toHaveBeenCalled()
    const next = onChange.mock.calls.at(-1)![0] as PersistedListDefinition
    expect(next.grouping).toBe('project')
  })

  it('does not emit on no-op selection (same value)', () => {
    const onChange = vi.fn()
    render(<ListEditorBody draft={makeDraft({ sort: 'date' })} onChange={onChange} />)
    const sortTrigger = screen.getByLabelText('Sort tasks by')
    fireEvent.click(sortTrigger)
    // After opening, the option matching the current value renders inside the
    // menu listbox — pick it explicitly via role to disambiguate from the
    // trigger's own label.
    const opts = screen.getAllByRole('option')
    const dateOpt = opts.find((el) => el.textContent === 'Effective date')!
    fireEvent.click(dateOpt)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('toggles runtimeFilter via the prompt select', () => {
    const onChange = vi.fn()
    render(<ListEditorBody draft={makeDraft()} onChange={onChange} />)
    const promptSelect = screen.getByDisplayValue('None') as HTMLSelectElement
    fireEvent.change(promptSelect, { target: { value: 'person' } })
    expect(onChange).toHaveBeenCalled()
    const next = onChange.mock.calls.at(-1)![0] as PersistedListDefinition
    expect(next.runtimeFilter).toEqual({ kind: 'value', field: 'person' })
  })

  it('clears runtimeFilter when the prompt is set back to None', () => {
    const onChange = vi.fn()
    render(<ListEditorBody draft={makeDraft({ runtimeFilter: { kind: 'value', field: 'org' } })} onChange={onChange} />)
    const promptSelect = screen.getByDisplayValue('Org') as HTMLSelectElement
    fireEvent.change(promptSelect, { target: { value: 'none' } })
    expect(onChange).toHaveBeenCalled()
    const next = onChange.mock.calls.at(-1)![0] as PersistedListDefinition
    expect(next.runtimeFilter).toBeUndefined()
  })

  it('switches to a date-offset spec when the prompt is set to Date offset', () => {
    const onChange = vi.fn()
    render(<ListEditorBody draft={makeDraft()} onChange={onChange} />)
    const promptSelect = screen.getByDisplayValue('None') as HTMLSelectElement
    fireEvent.change(promptSelect, { target: { value: 'date-offset' } })
    expect(onChange).toHaveBeenCalled()
    const next = onChange.mock.calls.at(-1)![0] as PersistedListDefinition
    expect(next.runtimeFilter).toEqual({ kind: 'date-offset', source: 'scheduled', anchor: 'today' })
  })

  it('exposes Source / min / max controls when runtimeFilter is a date-offset', () => {
    const onChange = vi.fn()
    render(
      <ListEditorBody
        draft={makeDraft({
          runtimeFilter: { kind: 'date-offset', source: 'scheduled', anchor: 'today' },
        })}
        onChange={onChange}
      />,
    )
    const sourceSelect = screen.getByLabelText('Date offset source') as HTMLSelectElement
    expect(sourceSelect.value).toBe('scheduled')
    fireEvent.change(sourceSelect, { target: { value: 'created' } })
    expect((onChange.mock.calls.at(-1)![0] as PersistedListDefinition).runtimeFilter).toEqual({
      kind: 'date-offset', source: 'created', anchor: 'today',
    })

    const minInput = screen.getByLabelText('Minimum days from today') as HTMLInputElement
    fireEvent.change(minInput, { target: { value: '-7' } })
    expect((onChange.mock.calls.at(-1)![0] as PersistedListDefinition).runtimeFilter).toEqual({
      kind: 'date-offset', source: 'scheduled', anchor: 'today', minDays: -7,
    })

    const maxInput = screen.getByLabelText('Maximum days from today') as HTMLInputElement
    fireEvent.change(maxInput, { target: { value: '0' } })
    expect((onChange.mock.calls.at(-1)![0] as PersistedListDefinition).runtimeFilter).toEqual({
      kind: 'date-offset', source: 'scheduled', anchor: 'today', maxDays: 0,
    })
  })

  it('clears a min/max bound when the input is emptied', () => {
    const onChange = vi.fn()
    render(
      <ListEditorBody
        draft={makeDraft({
          runtimeFilter: { kind: 'date-offset', source: 'scheduled', anchor: 'today', minDays: -7, maxDays: 0 },
        })}
        onChange={onChange}
      />,
    )
    const minInput = screen.getByLabelText('Minimum days from today') as HTMLInputElement
    fireEvent.change(minInput, { target: { value: '' } })
    expect((onChange.mock.calls.at(-1)![0] as PersistedListDefinition).runtimeFilter).toEqual({
      kind: 'date-offset', source: 'scheduled', anchor: 'today', maxDays: 0,
    })
  })
})
