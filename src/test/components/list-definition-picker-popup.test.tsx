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
      <ListDefinitionPickerPopup x={10} y={10} onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={vi.fn()} />,
    )
    expect(getByText('First list')).toBeInTheDocument()
    expect(getByText('Second list')).toBeInTheDocument()
  })

  it('shows the "Add list" header and "Add" action label', () => {
    useListDefinitionStore.setState({ listDefinitions: [makeDef({ id: 1 })] })
    const { getByText } = render(
      <ListDefinitionPickerPopup x={10} y={10} onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={vi.fn()} />,
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
      <ListDefinitionPickerPopup x={10} y={10} onSelect={onSelect} onCreateNew={vi.fn()} onClose={onClose} />,
    )

    fireEvent.click(getByText('Target'))

    expect(onSelect).toHaveBeenCalledWith(7)
    expect(onClose).toHaveBeenCalled()
  })

  it('renders empty state when there are no defs', () => {
    const { getAllByText } = render(
      <ListDefinitionPickerPopup x={10} y={10} onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={vi.fn()} />,
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
      <ListDefinitionPickerPopup x={10} y={10} onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={vi.fn()} />,
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
        <ListDefinitionPickerPopup x={10} y={10} onSelect={vi.fn()} onCreateNew={onCreateNew} onClose={onClose} />,
      )
      fireEvent.click(getByText(/create new list/i))
      expect(onCreateNew).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })

    it('Escape closes the popup', () => {
      const onClose = vi.fn()
      render(
        <ListDefinitionPickerPopup x={10} y={10} onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={onClose} />,
      )
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).toHaveBeenCalled()
    })

    it('outside click closes the popup', () => {
      const onClose = vi.fn()
      render(
        <>
          <ListDefinitionPickerPopup x={10} y={10} onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={onClose} />
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
        <ListDefinitionPickerPopup x={10} y={10} onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={onClose} />,
      )
      // Header is part of the popup; clicking it should not trigger outside-click.
      fireEvent.mouseDown(getByText(/^add list$/i))
      expect(onClose).not.toHaveBeenCalled()
    })
  })
})

describe('ListDefinitionPickerPopup — hidden lists', () => {
  it('offers no list a layout or the Eisenhower owns', () => {
    useListDefinitionStore.setState({
      listDefinitions: [
        makeDef({ id: 1, name: 'Saved' }),
        makeDef({ id: 2, name: 'Layout only', owner: { layoutId: 1 } }),
        makeDef({ id: 3, name: 'Eisenhower', owner: { eisenhower: true } }),
      ],
    })
    const { getByText, queryByText } = render(
      <ListDefinitionPickerPopup x={10} y={10} onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={vi.fn()} />,
    )
    expect(getByText('Saved')).toBeInTheDocument()
    expect(queryByText('Layout only')).toBeNull()
    expect(queryByText('Eisenhower')).toBeNull()
  })

  it('in a saved layout: its own lists too (marked), never another layout’s; Saved list / This layout only before Create, Saved first', () => {
    useListDefinitionStore.setState({
      listDefinitions: [
        makeDef({ id: 1, name: 'Saved' }),
        makeDef({ id: 2, name: 'Mine', owner: { layoutId: 4 } }),
        makeDef({ id: 3, name: 'Theirs', owner: { layoutId: 5 } }),
      ],
    })
    const onCreateNew = vi.fn()
    const { getByText, queryByText, getByRole } = render(
      <ListDefinitionPickerPopup x={10} y={10} layoutId={4} onSelect={vi.fn()} onCreateNew={onCreateNew} onClose={vi.fn()} />,
    )
    expect(getByText('Mine')).toBeInTheDocument()
    expect(getByText('This layout')).toBeInTheDocument()
    expect(queryByText('Theirs')).toBeNull()
    expect(getByRole('radio', { name: 'Saved list' })).toBeChecked()
    fireEvent.click(getByText('+ Create new list…'))
    expect(onCreateNew).toHaveBeenLastCalledWith(false)
  })

  it('This layout only: Create says so', () => {
    const onCreateNew = vi.fn()
    const { getByRole, getByText } = render(
      <ListDefinitionPickerPopup x={10} y={10} layoutId={4} onSelect={vi.fn()} onCreateNew={onCreateNew} onClose={vi.fn()} />,
    )
    // No list yet: the choice sits above the primary Create.
    fireEvent.click(getByRole('radio', { name: 'This layout only' }))
    fireEvent.click(getByText('+ Create new list…'))
    expect(onCreateNew).toHaveBeenLastCalledWith(true)
  })

  it('no layout to keep it in (a new layout not saved yet): no choice, a saved list', () => {
    const onCreateNew = vi.fn()
    const { queryByRole, getByText } = render(
      <ListDefinitionPickerPopup x={10} y={10} onSelect={vi.fn()} onCreateNew={onCreateNew} onClose={vi.fn()} />,
    )
    expect(queryByRole('radio')).toBeNull()
    fireEvent.click(getByText('+ Create new list…'))
    expect(onCreateNew).toHaveBeenLastCalledWith(false)
  })
})
