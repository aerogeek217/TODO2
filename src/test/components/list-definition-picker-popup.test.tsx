import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { ListDefinitionPickerPopup } from '../../components/overlays/ListDefinitionPickerPopup'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { emptyPredicate } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'

function makeDef(overrides: Partial<PersistedListDefinition> & { id: number }): PersistedListDefinition {
  return {
    name: `List ${overrides.id}`,
    sortOrder: overrides.id,
    membership: { kind: 'custom', predicate: emptyPredicate() },
    sort: 'manual',
    grouping: 'none',
    owner: { layoutId: 4 },
    ...overrides,
  }
}

beforeEach(() => {
  useListDefinitionStore.setState({ listDefinitions: [] })
})

afterEach(cleanup)

describe('ListDefinitionPickerPopup', () => {
  it('renders every list definition', () => {
    useListDefinitionStore.setState({
      listDefinitions: [
        makeDef({ id: 1, name: 'First list' }),
        makeDef({ id: 2, name: 'Second list' }),
      ],
    })
    const { getByText } = render(
      <ListDefinitionPickerPopup x={10} y={10} layoutId={4} onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={vi.fn()} />,
    )
    expect(getByText('First list')).toBeInTheDocument()
    expect(getByText('Second list')).toBeInTheDocument()
  })

  it('shows the "Add list" header and "Add" action label', () => {
    useListDefinitionStore.setState({ listDefinitions: [makeDef({ id: 1 })] })
    const { getByText } = render(
      <ListDefinitionPickerPopup x={10} y={10} layoutId={4} onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={vi.fn()} />,
    )
    expect(getByText(/^add list$/i)).toBeInTheDocument()
    expect(getByText('Add')).toBeInTheDocument()
  })

  it('clicking an item calls onSelect with the def id and closes', () => {
    useListDefinitionStore.setState({
      listDefinitions: [makeDef({ id: 7, name: 'Target' })],
    })
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const { getByText } = render(
      <ListDefinitionPickerPopup x={10} y={10} layoutId={4} onSelect={onSelect} onCreateNew={vi.fn()} onClose={onClose} />,
    )

    fireEvent.click(getByText('Target'))

    expect(onSelect).toHaveBeenCalledWith(7)
    expect(onClose).toHaveBeenCalled()
  })

  it('renders empty state when there are no defs', () => {
    const { getAllByText } = render(
      <ListDefinitionPickerPopup x={10} y={10} layoutId={4} onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={vi.fn()} />,
    )
    const ctas = getAllByText(/create new list/i)
    expect(ctas.length).toBeGreaterThan(0)
  })

  it('sorts defs by sortOrder', () => {
    useListDefinitionStore.setState({
      listDefinitions: [
        makeDef({ id: 3, name: 'Third', sortOrder: 3 }),
        makeDef({ id: 1, name: 'First', sortOrder: 1 }),
        makeDef({ id: 2, name: 'Second', sortOrder: 2 }),
      ],
    })
    render(
      <ListDefinitionPickerPopup x={10} y={10} layoutId={4} onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={vi.fn()} />,
    )
    const names = Array.from(document.body.querySelectorAll('button'))
      .map(b => b.textContent ?? '')
      .filter(t => t.includes('First') || t.includes('Second') || t.includes('Third'))
    expect(names[0]).toContain('First')
    expect(names[1]).toContain('Second')
    expect(names[2]).toContain('Third')
  })

  it('excludeIds hides listed ids', () => {
    useListDefinitionStore.setState({
      listDefinitions: [
        makeDef({ id: 1, name: 'Excluded' }),
        makeDef({ id: 2, name: 'Included' }),
      ],
    })
    const { getByText, queryByText } = render(
      <ListDefinitionPickerPopup
        x={10}
        y={10}
        layoutId={4}
        onSelect={vi.fn()}
        onCreateNew={vi.fn()}
        onClose={vi.fn()}
        excludeIds={[1]}
      />,
    )
    expect(queryByText('Excluded')).not.toBeInTheDocument()
    expect(getByText('Included')).toBeInTheDocument()
  })

  describe('closing behaviors', () => {
    it('"Create new…" fires onCreateNew and onClose', () => {
      useListDefinitionStore.setState({ listDefinitions: [makeDef({ id: 1 })] })
      const onCreateNew = vi.fn()
      const onClose = vi.fn()
      const { getByText } = render(
        <ListDefinitionPickerPopup x={10} y={10} layoutId={4} onSelect={vi.fn()} onCreateNew={onCreateNew} onClose={onClose} />,
      )
      fireEvent.click(getByText(/create new list/i))
      expect(onCreateNew).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })

    it('Escape closes the popup', () => {
      const onClose = vi.fn()
      render(
        <ListDefinitionPickerPopup x={10} y={10} layoutId={4} onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={onClose} />,
      )
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).toHaveBeenCalled()
    })

    it('outside click closes the popup', () => {
      const onClose = vi.fn()
      render(
        <>
          <ListDefinitionPickerPopup x={10} y={10} layoutId={4} onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={onClose} />
          <div data-testid="outside">outside</div>
        </>,
      )
      fireEvent.mouseDown(document.querySelector('[data-testid="outside"]')!)
      expect(onClose).toHaveBeenCalled()
    })

    it('click inside the popup does not close it', () => {
      useListDefinitionStore.setState({ listDefinitions: [] })
      const onClose = vi.fn()
      const { getByText } = render(
        <ListDefinitionPickerPopup x={10} y={10} layoutId={4} onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={onClose} />,
      )
      // Header is part of the popup; clicking it should not trigger outside-click.
      fireEvent.mouseDown(getByText(/^add list$/i))
      expect(onClose).not.toHaveBeenCalled()
    })
  })
})

describe('ListDefinitionPickerPopup — the layout’s lists', () => {
  it('offers only the lists the layout owns: never another layout’s, the Eisenhower’s or one without an owner', () => {
    useListDefinitionStore.setState({
      listDefinitions: [
        makeDef({ id: 1, name: 'Mine' }),
        makeDef({ id: 2, name: 'Theirs', owner: { layoutId: 5 } }),
        makeDef({ id: 3, name: 'Eisenhower', owner: { eisenhower: true } }),
        makeDef({ id: 4, name: 'No owner', owner: undefined }),
      ],
    })
    const { getByText, queryByText, queryByRole } = render(
      <ListDefinitionPickerPopup x={10} y={10} layoutId={4} onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={vi.fn()} />,
    )
    expect(getByText('Mine')).toBeInTheDocument()
    expect(queryByText('Theirs')).toBeNull()
    expect(queryByText('Eisenhower')).toBeNull()
    expect(queryByText('No owner')).toBeNull()
    // Only the layout's lists: no choice of where a new list goes, no note on the rows.
    expect(queryByRole('radio')).toBeNull()
    expect(queryByText('This layout')).toBeNull()
  })

  it('no stored layout (a new layout an older build kept): no list, and no Create unless given', () => {
    useListDefinitionStore.setState({ listDefinitions: [makeDef({ id: 1, name: 'Mine' })] })
    const { queryByText } = render(
      <ListDefinitionPickerPopup x={10} y={10} onSelect={vi.fn()} onClose={vi.fn()} />,
    )
    expect(queryByText('Mine')).toBeNull()
    expect(queryByText(/create new list/i)).toBeNull()
  })
})
