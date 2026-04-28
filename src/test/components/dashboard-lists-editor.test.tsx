import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { DashboardListsEditor } from '../../components/settings/DashboardListsEditor'
import { useListDefinitionStore, emptyPredicate } from '../../stores/list-definition-store'
import { useUIStore } from '../../stores/ui-store'
import type { PersistedListDefinition } from '../../models'

vi.mock('../../data/list-definition-repository', () => ({
  listDefinitionRepository: { getAll: async () => [] },
}))

function makeDef(overrides: Partial<PersistedListDefinition> & { id: number }): PersistedListDefinition {
  return {
    name: `List ${overrides.id}`,
    sortOrder: overrides.id,
    pinnedToDashboard: true,
    favorited: false,
    membership: { kind: 'custom', predicate: emptyPredicate() },
    sort: 'manual',
    grouping: 'none',
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

// "Match sort field" grouping option retired in ui-consistency-2026-04-25 P4.
// The on-disk shape is flat literals, so coupling sort↔group is now an
// explicit "set both to the same value" UX, not a special grouping kind.

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

    render(
      <MemoryRouter>
        <DashboardListsEditor onClose={() => {}} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getAllByText('⚙')[0]!)

    // The runtime-filter select lives inside the dialog body (portaled to
    // document.body). Find it via the option that includes "Person".
    const selects = Array.from(document.body.querySelectorAll('select')) as HTMLSelectElement[]
    const runtimeSelect = selects.find((el) =>
      Array.from(el.options).some((o) => o.value === 'person'),
    )
    expect(runtimeSelect).toBeTruthy()

    // Dirty-tracked save: changing the select only touches the draft; the
    // store call happens when the user clicks Save (now in the dialog footer).
    fireEvent.change(runtimeSelect!, { target: { value: 'person' } })
    expect(updates.length).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    // Flush the microtask queue so the async update() resolves.
    await Promise.resolve()
    expect(updates.at(-1)?.runtimeFilter).toEqual({ kind: 'value', field: 'person' })

    // Save closes the dialog; re-open to flip the pick back to None.
    fireEvent.click(screen.getAllByText('⚙')[0]!)
    const selects2 = Array.from(document.body.querySelectorAll('select')) as HTMLSelectElement[]
    const runtimeSelect2 = selects2.find((el) =>
      Array.from(el.options).some((o) => o.value === 'person'),
    )
    expect(runtimeSelect2).toBeTruthy()
    fireEvent.change(runtimeSelect2!, { target: { value: 'none' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
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

  it("mounts with the given def's editor dialog already open", () => {
    render(
      <MemoryRouter>
        <DashboardListsEditor onClose={() => {}} initialSelectedId={3} />
      </MemoryRouter>,
    )
    // Exactly one editor dialog exists, portaled to document.body, labelled
    // for Gamma (id 3).
    const dialogs = document.body.querySelectorAll('[role="dialog"]')
    expect(dialogs.length).toBe(1)
    const aria = dialogs[0]!.getAttribute('aria-label') ?? ''
    expect(aria.startsWith('Edit list')).toBe(true)
    expect(aria).toContain('Gamma')
  })
})

describe('DashboardListsEditor — draft dirty-gating (L5)', () => {
  beforeEach(() => {
    useListDefinitionStore.setState({
      listDefinitions: [makeDef({ id: 1, name: 'Original name' })],
    })
  })
  afterEach(() => { cleanup() })

  it('preserves mid-edit runtime-filter pick when the upstream name changes', async () => {
    // User edits the runtime-filter select (makes draft dirty), then an
    // external write renames the def in the store. The dialog's re-sync
    // effect must forward name/pin/sortOrder but leave the user's
    // runtime-filter pick intact until Save.
    render(
      <MemoryRouter>
        <DashboardListsEditor onClose={() => {}} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getAllByText('⚙')[0]!)

    const selects = Array.from(document.body.querySelectorAll('select')) as HTMLSelectElement[]
    const runtimeSelect = selects.find((el) =>
      Array.from(el.options).some((o) => o.value === 'person'),
    )
    expect(runtimeSelect).toBeTruthy()

    fireEvent.change(runtimeSelect!, { target: { value: 'person' } })
    expect(runtimeSelect!.value).toBe('person')

    // External def-level rename while the draft is dirty — mimics an
    // inline-rename path writing through the store.
    const prev = useListDefinitionStore.getState().listDefinitions
    useListDefinitionStore.setState({
      listDefinitions: prev.map((d) => (d.id === 1 ? { ...d, name: 'Renamed' } : d)),
    })
    await Promise.resolve()

    // The user's edit (`person`) is still selected — the external rename did
    // not clobber the draft's runtime filter.
    const selects2 = Array.from(document.body.querySelectorAll('select')) as HTMLSelectElement[]
    const runtimeSelect2 = selects2.find((el) =>
      Array.from(el.options).some((o) => o.value === 'person'),
    )
    expect(runtimeSelect2!.value).toBe('person')
  })
})

describe('DashboardListsEditor — modal-on-modal contract', () => {
  let originalShowBulk: ReturnType<typeof useUIStore.getState>['showBulkConfirmation']
  let originalSetFavorited: ReturnType<typeof useListDefinitionStore.getState>['setFavorited']

  beforeEach(() => {
    useListDefinitionStore.setState({
      listDefinitions: [makeDef({ id: 1, name: 'Alpha' })],
    })
    originalShowBulk = useUIStore.getState().showBulkConfirmation
    originalSetFavorited = useListDefinitionStore.getState().setFavorited
  })
  afterEach(() => {
    useUIStore.setState({ showBulkConfirmation: originalShowBulk } as never)
    useListDefinitionStore.setState({ setFavorited: originalSetFavorited } as never)
    cleanup()
  })

  it('opens the editor dialog on ⚙ click and closes it via ×', () => {
    render(
      <MemoryRouter>
        <DashboardListsEditor onClose={() => {}} />
      </MemoryRouter>,
    )
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    fireEvent.click(screen.getByText('⚙'))
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()

    // Dialog × is the only element labelled "Close" (Lists modal's × has no aria-label).
    fireEvent.click(screen.getByLabelText('Close'))
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('Esc closes the editor only — Lists modal stays mounted', () => {
    const onClose = vi.fn()
    const { container } = render(
      <MemoryRouter>
        <DashboardListsEditor onClose={onClose} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByText('⚙'))
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    // Outer Lists modal still rendered in the test container.
    expect(container.querySelector('[class*="backdrop"]')).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('clicking the scrim closes the editor', () => {
    render(
      <MemoryRouter>
        <DashboardListsEditor onClose={() => {}} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByText('⚙'))
    const scrim = document.body.querySelector('[class*="scrim"]') as HTMLElement | null
    expect(scrim).not.toBeNull()
    fireEvent.click(scrim!)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('routes a dirty close through showBulkConfirmation', () => {
    const showSpy = vi.fn()
    useUIStore.setState({ showBulkConfirmation: showSpy } as never)

    render(
      <MemoryRouter>
        <DashboardListsEditor onClose={() => {}} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByText('⚙'))

    // Dirty the draft via the runtime-filter select.
    const selects = Array.from(document.body.querySelectorAll('select')) as HTMLSelectElement[]
    const runtimeSelect = selects.find((el) =>
      Array.from(el.options).some((o) => o.value === 'person'),
    )
    expect(runtimeSelect).toBeTruthy()
    fireEvent.change(runtimeSelect!, { target: { value: 'person' } })

    // Cancel button is in the dialog footer.
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(showSpy).toHaveBeenCalled()
    // Editor still mounted — confirm flow is gating the close.
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('header favorite toggle fires setFavorited immediately, no Save needed', () => {
    const setFavoritedSpy = vi.fn(async () => {})
    useListDefinitionStore.setState({ setFavorited: setFavoritedSpy } as never)

    render(
      <MemoryRouter>
        <DashboardListsEditor onClose={() => {}} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByText('⚙'))
    fireEvent.click(screen.getByText('Add to favorites'))
    expect(setFavoritedSpy).toHaveBeenCalledWith(1, true)
  })
})
