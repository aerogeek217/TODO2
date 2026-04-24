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
    orgIds: null,
    orgFilterMode: 'include-people',
    projectIds: null,
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
    expect(getByText('Lists')).toBeInTheDocument()
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

describe('DashboardListsEditor — Match sort field grouping option', () => {
  beforeEach(() => {
    useListDefinitionStore.setState({
      listDefinitions: [
        makeDef({ id: 1, name: 'SortOrder def', sort: { kind: 'sort-order' } }),
        makeDef({ id: 2, name: 'SortBy def', sort: { kind: 'sortBy', by: 'project' } }),
      ],
    })
  })
  afterEach(() => { cleanup() })

  it('disables Match-sort-field grouping when sort kind is not sortBy', () => {
    const { getAllByText, getByText } = render(
      <MemoryRouter>
        <DashboardListsEditor onClose={() => {}} />
      </MemoryRouter>,
    )
    // Open the first def's config panel.
    const configBtns = getAllByText('⚙')
    fireEvent.click(configBtns[0])
    const matchBtn = getByText('Match sort field') as HTMLButtonElement
    expect(matchBtn.disabled).toBe(true)
  })

  it('enables Match-sort-field grouping when sort kind is sortBy', () => {
    const { getAllByText, getByText } = render(
      <MemoryRouter>
        <DashboardListsEditor onClose={() => {}} />
      </MemoryRouter>,
    )
    const configBtns = getAllByText('⚙')
    fireEvent.click(configBtns[1])
    const matchBtn = getByText('Match sort field') as HTMLButtonElement
    expect(matchBtn.disabled).toBe(false)
  })
})

describe('DashboardListsEditor — runtime filter control', () => {
  beforeEach(() => {
    useListDefinitionStore.setState({
      listDefinitions: [makeDef({ id: 1, name: 'Tasks for…' })],
    })
  })
  afterEach(() => { cleanup() })

  it('round-trips a runtime-filter pick through the store on Save', async () => {
    const updates: PersistedListDefinition[] = []
    useListDefinitionStore.setState({
      update: async (def: PersistedListDefinition) => {
        updates.push(def)
        const prev = useListDefinitionStore.getState().listDefinitions
        useListDefinitionStore.setState({
          listDefinitions: prev.map((d) => (d.id === def.id ? def : d)),
        })
      },
    } as Partial<ReturnType<typeof useListDefinitionStore.getState>> as never)

    const { getAllByText, getByText, container } = render(
      <MemoryRouter>
        <DashboardListsEditor onClose={() => {}} />
      </MemoryRouter>,
    )
    const configBtns = getAllByText('⚙')
    fireEvent.click(configBtns[0])

    // The runtime-filter select is the one whose options include "Person".
    const selects = Array.from(container.querySelectorAll('select')) as HTMLSelectElement[]
    const runtimeSelect = selects.find((el) =>
      Array.from(el.options).some((o) => o.value === 'person'),
    )
    expect(runtimeSelect).toBeTruthy()

    // Dirty-tracked save: changing the select only touches the draft; the
    // store call happens when the user clicks Save.
    fireEvent.change(runtimeSelect!, { target: { value: 'person' } })
    expect(updates.length).toBe(0)
    fireEvent.click(getByText('Save'))
    // Flush the microtask queue so the async update() resolves.
    await Promise.resolve()
    expect(updates.at(-1)?.runtimeFilter).toEqual({ field: 'person' })

    // Picking None again clears it — still gated by a Save click.
    fireEvent.change(runtimeSelect!, { target: { value: 'none' } })
    fireEvent.click(getByText('Save'))
    await Promise.resolve()
    expect(updates.at(-1)?.runtimeFilter).toBeUndefined()
  })
})

describe('DashboardListsEditor — initialSelectedId', () => {
  beforeEach(() => {
    useListDefinitionStore.setState({
      listDefinitions: [
        makeDef({ id: 1, name: 'Alpha' }),
        makeDef({ id: 2, name: 'Beta' }),
        makeDef({ id: 3, name: 'Gamma' }),
      ],
    })
  })
  afterEach(() => { cleanup() })

  it('mounts with the given def\'s ConfigPanel already open', () => {
    const { container } = render(
      <MemoryRouter>
        <DashboardListsEditor onClose={() => {}} initialSelectedId={3} />
      </MemoryRouter>,
    )
    // Only one config panel should be visible, and it belongs to Gamma (id 3).
    const panels = container.querySelectorAll('[class*="configPanel"]')
    expect(panels.length).toBe(1)
  })
})
