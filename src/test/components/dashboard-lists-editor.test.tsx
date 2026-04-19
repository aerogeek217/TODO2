import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { DashboardListsEditor } from '../../components/settings/DashboardListsEditor'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import type { PersistedListDefinition, TodoPredicate } from '../../models'

vi.mock('../../data/list-definition-repository', () => ({
  listDefinitionRepository: { getAll: async () => [] },
}))

function emptyPredicate(): TodoPredicate {
  return {
    showCompleted: false,
    showHiddenStatuses: false,
    personIds: null,
    personFilterMode: 'include-orgs',
    tagIds: null,
    orgIds: null,
    orgFilterMode: 'include-people',
    statusIds: null,
    searchText: '',
    dateField: 'date',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasScheduled: null,
    hasDeadline: null,
  }
}

function makeDef(overrides: Partial<PersistedListDefinition> & { id: number }): PersistedListDefinition {
  return {
    name: `List ${overrides.id}`,
    sortOrder: overrides.id,
    pinnedToDashboard: true,
    membership: { kind: 'custom', predicate: emptyPredicate() },
    sort: { kind: 'sort-order' },
    grouping: { kind: 'none' },
    ...overrides,
  }
}

describe('DashboardListsEditor — filterIds mode', () => {
  beforeEach(() => {
    useListDefinitionStore.setState({
      listDefinitions: [
        makeDef({ id: 1, name: 'This week' }),
        makeDef({ id: 2, name: 'Next week' }),
        makeDef({ id: 3, name: 'Unpinned extra' }),
      ],
    })
  })
  afterEach(() => { cleanup() })

  it('renders only the filtered rows and uses the supplied title', () => {
    const { getByText, queryByText } = render(
      <MemoryRouter>
        <DashboardListsEditor
          onClose={() => {}}
          filterIds={[1, 2]}
          title="Edit Horizons"
        />
      </MemoryRouter>,
    )
    expect(getByText('Edit Horizons')).toBeInTheDocument()
    expect(getByText('This week')).toBeInTheDocument()
    expect(getByText('Next week')).toBeInTheDocument()
    expect(queryByText('Unpinned extra')).toBeNull()
  })

  it('hides the "+ Add List" button and per-row delete when filtered', () => {
    const { container, queryByText } = render(
      <MemoryRouter>
        <DashboardListsEditor onClose={() => {}} filterIds={[1, 2]} />
      </MemoryRouter>,
    )
    expect(queryByText(/\+ Add List/i)).toBeNull()
    // Each SortableRow's delete × sits in a .actions wrapper; there should be none.
    expect(container.querySelector('[class*="actions"]')).toBeNull()
  })

  it('without filterIds shows all defs, the add button, and per-row delete', () => {
    const { getByText, container } = render(
      <MemoryRouter>
        <DashboardListsEditor onClose={() => {}} />
      </MemoryRouter>,
    )
    expect(getByText('Dashboard Lists')).toBeInTheDocument()
    expect(getByText(/\+ Add List/i)).toBeInTheDocument()
    expect(getByText('Unpinned extra')).toBeInTheDocument()
    expect(container.querySelector('[class*="actions"]')).not.toBeNull()
  })

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn()
    const { container } = render(
      <MemoryRouter>
        <DashboardListsEditor onClose={onClose} filterIds={[1]} />
      </MemoryRouter>,
    )
    const backdrop = container.querySelector('[class*="backdrop"]')!
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalled()
  })
})
