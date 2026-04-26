import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { HorizonRibbon, type HorizonRow } from '../../components/dashboard/HorizonRibbon'

function makeRow(overrides: Partial<HorizonRow> & { defId: number; label: string }): HorizonRow {
  return {
    scheduled: [],
    due: [],
    total: 0,
    ...overrides,
  }
}

describe('HorizonRibbon', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 16))
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  function renderRibbon(props: Partial<ComponentProps<typeof HorizonRibbon>>) {
    const handlers = {
      onSelect: vi.fn(),
      onSwap: vi.fn(),
      onRemove: vi.fn(),
      onAdd: vi.fn(),
      onReorder: vi.fn(),
    }
    const result = render(
      <HorizonRibbon
        rows={props.rows ?? []}
        selectedDefId={props.selectedDefId ?? null}
        {...handlers}
        {...props}
      />,
    )
    return { ...result, ...handlers }
  }

  it('renders empty-state copy when there are no rows', () => {
    const { getByText } = renderRibbon({ rows: [] })
    expect(getByText(/Add a horizon to start/i)).toBeTruthy()
  })

  it('renders one row per horizon with a remove button + label button + bar button', () => {
    const rows = [
      makeRow({ defId: 1, label: 'This week', total: 3 }),
      makeRow({ defId: 2, label: 'Later', total: 1 }),
    ]
    const { container } = renderRibbon({ rows, selectedDefId: 1 })
    const rowEls = container.querySelectorAll('[data-horizon-defid]')
    expect(rowEls.length).toBe(2)
    expect(rowEls[0]?.getAttribute('data-horizon-defid')).toBe('1')
    expect(rowEls[1]?.getAttribute('data-horizon-defid')).toBe('2')
  })

  it('clicking a row\'s bar invokes onSelect with that row\'s defId', () => {
    const rows = [makeRow({ defId: 7, label: 'This week', total: 3 })]
    const { container, onSelect } = renderRibbon({ rows, selectedDefId: null })
    const bar = container.querySelector('button[aria-pressed]')
    expect(bar).not.toBeNull()
    fireEvent.click(bar!)
    expect(onSelect).toHaveBeenCalledWith(7)
  })

  it('clicking a row\'s label invokes onSwap with that row\'s defId + bottom-aligned anchor', () => {
    const rows = [makeRow({ defId: 7, label: 'This week', total: 3 })]
    const { container, onSwap } = renderRibbon({ rows })
    const labelBtn = container.querySelector<HTMLButtonElement>('button[title="Swap list…"]')
    expect(labelBtn).not.toBeNull()
    fireEvent.click(labelBtn!)
    expect(onSwap).toHaveBeenCalledWith(7, expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }))
  })

  it('clicking a row\'s × invokes onRemove with that row\'s defId', () => {
    const rows = [makeRow({ defId: 7, label: 'This week', total: 3 })]
    const { container, onRemove } = renderRibbon({ rows })
    const removeBtn = container.querySelector<HTMLButtonElement>('button[title="Remove from horizons"]')
    expect(removeBtn).not.toBeNull()
    fireEvent.click(removeBtn!)
    expect(onRemove).toHaveBeenCalledWith(7)
  })

  it('+ Add list footer button invokes onAdd with an anchor', () => {
    const { getByText, onAdd } = renderRibbon({ rows: [] })
    fireEvent.click(getByText('+ Add list'))
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }))
  })

  it('renders Edit horizons button only when onEditHorizons is provided', () => {
    const onEditHorizons = vi.fn()
    const { getByText, queryByText, rerender } = render(
      <HorizonRibbon
        rows={[makeRow({ defId: 1, label: 'This week', total: 0 })]}
        selectedDefId={1}
        onSelect={() => {}}
        onSwap={() => {}}
        onRemove={() => {}}
        onAdd={() => {}}
        onReorder={() => {}}
        onEditHorizons={onEditHorizons}
      />,
    )
    const btn = getByText(/Edit horizons/i)
    fireEvent.click(btn)
    expect(onEditHorizons).toHaveBeenCalled()

    rerender(
      <HorizonRibbon
        rows={[makeRow({ defId: 1, label: 'This week', total: 0 })]}
        selectedDefId={1}
        onSelect={() => {}}
        onSwap={() => {}}
        onRemove={() => {}}
        onAdd={() => {}}
        onReorder={() => {}}
      />,
    )
    expect(queryByText(/Edit horizons/i)).toBeNull()
  })

  it('selected row carries the rowSelected class so callers can style it', () => {
    const rows = [
      makeRow({ defId: 1, label: 'This week', total: 3 }),
      makeRow({ defId: 2, label: 'Later', total: 0 }),
    ]
    const { container } = renderRibbon({ rows, selectedDefId: 2 })
    const selectedRow = container.querySelector('[data-horizon-defid="2"]')
    expect(selectedRow?.className).toMatch(/rowSelected/)
    const otherRow = container.querySelector('[data-horizon-defid="1"]')
    expect(otherRow?.className).not.toMatch(/rowSelected/)
  })
})
