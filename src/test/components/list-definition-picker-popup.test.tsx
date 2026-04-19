import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { ListDefinitionPickerPopup } from '../../components/overlays/ListDefinitionPickerPopup'
import { useListDefinitionStore, emptyPredicate } from '../../stores/list-definition-store'
import type { PersistedListDefinition } from '../../models/list-definition'

function makeDef(overrides: Partial<PersistedListDefinition> & { id: number }): PersistedListDefinition {
  return {
    name: `List ${overrides.id}`,
    sortOrder: overrides.id,
    pinnedToDashboard: false,
    membership: { kind: 'custom', predicate: emptyPredicate() },
    sort: { kind: 'sort-order' },
    grouping: { kind: 'none' },
    ...overrides,
  }
}

beforeEach(() => {
  useListDefinitionStore.setState({ listDefinitions: [], loading: false, error: null })
})

afterEach(cleanup)

describe('ListDefinitionPickerPopup', () => {
  describe('canvas mode', () => {
    it('renders every list definition (pinned and unpinned)', () => {
      useListDefinitionStore.setState({
        listDefinitions: [
          makeDef({ id: 1, name: 'Pinned one', pinnedToDashboard: true }),
          makeDef({ id: 2, name: 'Unpinned one', pinnedToDashboard: false }),
        ],
      })
      const { getByText } = render(
        <ListDefinitionPickerPopup x={10} y={10} mode="canvas" onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={vi.fn()} />,
      )
      expect(getByText('Pinned one')).toBeInTheDocument()
      expect(getByText('Unpinned one')).toBeInTheDocument()
    })

    it('shows "Add list to canvas" header and "Add" action label', () => {
      useListDefinitionStore.setState({ listDefinitions: [makeDef({ id: 1 })] })
      const { getByText } = render(
        <ListDefinitionPickerPopup x={10} y={10} mode="canvas" onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={vi.fn()} />,
      )
      expect(getByText(/add list to canvas/i)).toBeInTheDocument()
      expect(getByText('Add')).toBeInTheDocument()
    })

    it('clicking an item calls onSelect with the def id (not setPinned) and closes', () => {
      useListDefinitionStore.setState({
        listDefinitions: [makeDef({ id: 7, name: 'Target', pinnedToDashboard: false })],
      })
      const onSelect = vi.fn()
      const onClose = vi.fn()
      const { getByText } = render(
        <ListDefinitionPickerPopup x={10} y={10} mode="canvas" onSelect={onSelect} onCreateNew={vi.fn()} onClose={onClose} />,
      )

      fireEvent.click(getByText('Target'))

      expect(onSelect).toHaveBeenCalledWith(7)
      expect(onClose).toHaveBeenCalled()
      // The def should NOT have been pinned as a side-effect.
      expect(useListDefinitionStore.getState().listDefinitions[0].pinnedToDashboard).toBe(false)
    })

    it('renders empty state when there are no defs', () => {
      const { getByText } = render(
        <ListDefinitionPickerPopup x={10} y={10} mode="canvas" onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={vi.fn()} />,
      )
      expect(getByText(/no lists yet/i)).toBeInTheDocument()
    })

    it('sorts defs by sortOrder', () => {
      useListDefinitionStore.setState({
        listDefinitions: [
          makeDef({ id: 3, name: 'Third', sortOrder: 3 }),
          makeDef({ id: 1, name: 'First', sortOrder: 1 }),
          makeDef({ id: 2, name: 'Second', sortOrder: 2 }),
        ],
      })
      const { container } = render(
        <ListDefinitionPickerPopup x={10} y={10} mode="canvas" onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={vi.fn()} />,
      )
      const names = Array.from(container.querySelectorAll('button'))
        .map(b => b.textContent ?? '')
        .filter(t => t.includes('First') || t.includes('Second') || t.includes('Third'))
      expect(names[0]).toContain('First')
      expect(names[1]).toContain('Second')
      expect(names[2]).toContain('Third')
    })
  })

  describe('dashboard mode (default)', () => {
    it('shows only unpinned defs', () => {
      useListDefinitionStore.setState({
        listDefinitions: [
          makeDef({ id: 1, name: 'Pinned', pinnedToDashboard: true }),
          makeDef({ id: 2, name: 'Unpinned', pinnedToDashboard: false }),
        ],
      })
      const { getByText, queryByText } = render(
        <ListDefinitionPickerPopup x={10} y={10} onCreateNew={vi.fn()} onClose={vi.fn()} />,
      )
      expect(getByText('Unpinned')).toBeInTheDocument()
      expect(queryByText('Pinned')).not.toBeInTheDocument()
    })

    it('clicking an item pins it via the store (no onSelect)', async () => {
      useListDefinitionStore.setState({
        listDefinitions: [makeDef({ id: 5, name: 'Needs pinning', pinnedToDashboard: false })],
      })
      const setPinnedSpy = vi.fn().mockResolvedValue(undefined)
      useListDefinitionStore.setState({ setPinned: setPinnedSpy })
      const onSelect = vi.fn()
      const onClose = vi.fn()
      const { getByText } = render(
        <ListDefinitionPickerPopup x={10} y={10} onSelect={onSelect} onCreateNew={vi.fn()} onClose={onClose} />,
      )

      fireEvent.click(getByText('Needs pinning'))

      expect(setPinnedSpy).toHaveBeenCalledWith(5, true)
      expect(onSelect).not.toHaveBeenCalled()
      // onClose fires after the await resolves on the next tick.
      await Promise.resolve()
      expect(onClose).toHaveBeenCalled()
    })

    it('excludeIds hides listed ids regardless of pinnedToDashboard flag', () => {
      useListDefinitionStore.setState({
        listDefinitions: [
          makeDef({ id: 1, name: 'In grid pinned', pinnedToDashboard: true }),
          makeDef({ id: 2, name: 'Not in grid, pinned', pinnedToDashboard: true }),
          makeDef({ id: 3, name: 'Not in grid, unpinned', pinnedToDashboard: false }),
        ],
      })
      const { getByText, queryByText } = render(
        <ListDefinitionPickerPopup
          x={10}
          y={10}
          onCreateNew={vi.fn()}
          onClose={vi.fn()}
          excludeIds={[1]}
          onPin={vi.fn()}
        />,
      )
      expect(queryByText('In grid pinned')).not.toBeInTheDocument()
      // Horizon case: pinned-to-dashboard but not yet in grid — must still be pickable.
      expect(getByText('Not in grid, pinned')).toBeInTheDocument()
      expect(getByText('Not in grid, unpinned')).toBeInTheDocument()
    })

    it('onPin fires instead of the store setPinned when provided', async () => {
      useListDefinitionStore.setState({
        listDefinitions: [makeDef({ id: 9, name: 'Pickme', pinnedToDashboard: false })],
      })
      const setPinnedSpy = vi.fn().mockResolvedValue(undefined)
      useListDefinitionStore.setState({ setPinned: setPinnedSpy })
      const onPin = vi.fn()
      const onClose = vi.fn()
      const { getByText } = render(
        <ListDefinitionPickerPopup
          x={10}
          y={10}
          onCreateNew={vi.fn()}
          onClose={onClose}
          excludeIds={[]}
          onPin={onPin}
        />,
      )
      fireEvent.click(getByText('Pickme'))
      expect(onPin).toHaveBeenCalledWith(9)
      expect(setPinnedSpy).not.toHaveBeenCalled()
      await Promise.resolve()
      expect(onClose).toHaveBeenCalled()
    })

    it('when every def is pinned, shows a primary "Create new list…" CTA', () => {
      useListDefinitionStore.setState({
        listDefinitions: [makeDef({ id: 1, name: 'A', pinnedToDashboard: true })],
      })
      const onCreateNew = vi.fn()
      const onClose = vi.fn()
      const { getAllByText, container } = render(
        <ListDefinitionPickerPopup x={10} y={10} onCreateNew={onCreateNew} onClose={onClose} />,
      )
      // The dim "already pinned" label is gone — the primary create button is the
      // only affordance.
      expect(container.textContent).not.toMatch(/already pinned/i)
      const ctas = getAllByText(/create new list/i)
      expect(ctas.length).toBeGreaterThan(0)
      fireEvent.click(ctas[0])
      expect(onCreateNew).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('closing behaviors', () => {
    it('"Create new…" fires onCreateNew and onClose', () => {
      const onCreateNew = vi.fn()
      const onClose = vi.fn()
      const { getByText } = render(
        <ListDefinitionPickerPopup x={10} y={10} mode="canvas" onSelect={vi.fn()} onCreateNew={onCreateNew} onClose={onClose} />,
      )
      fireEvent.click(getByText(/create new list/i))
      expect(onCreateNew).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })

    it('Escape closes the popup', () => {
      const onClose = vi.fn()
      render(
        <ListDefinitionPickerPopup x={10} y={10} mode="canvas" onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={onClose} />,
      )
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).toHaveBeenCalled()
    })

    it('outside click closes the popup', () => {
      const onClose = vi.fn()
      render(
        <>
          <ListDefinitionPickerPopup x={10} y={10} mode="canvas" onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={onClose} />
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
        <ListDefinitionPickerPopup x={10} y={10} mode="canvas" onSelect={vi.fn()} onCreateNew={vi.fn()} onClose={onClose} />,
      )
      // Header is part of the popup; clicking it should not trigger outside-click.
      fireEvent.mouseDown(getByText(/add list to canvas/i))
      expect(onClose).not.toHaveBeenCalled()
    })
  })
})
