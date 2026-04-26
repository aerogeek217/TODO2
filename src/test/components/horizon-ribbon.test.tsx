import type { ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { HorizonRibbon, type HorizonRow } from '../../components/dashboard/HorizonRibbon'
import { makeTodo } from '../helpers'

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
      onRowContext: vi.fn(),
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

  it('renders one row per horizon with a label button + bar button (no inline × button)', () => {
    const rows = [
      makeRow({ defId: 1, label: 'This week', total: 3 }),
      makeRow({ defId: 2, label: 'Later', total: 1 }),
    ]
    const { container } = renderRibbon({ rows, selectedDefId: 1 })
    const rowEls = container.querySelectorAll('[data-horizon-defid]')
    expect(rowEls.length).toBe(2)
    expect(rowEls[0]?.getAttribute('data-horizon-defid')).toBe('1')
    expect(rowEls[1]?.getAttribute('data-horizon-defid')).toBe('2')
    // Remove button is gone — removal flows through the row right-click menu now.
    expect(container.querySelector('button[title="Remove from horizons"]')).toBeNull()
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

  it('right-clicking a row invokes onRowContext with that row\'s defId + click coords', () => {
    const rows = [makeRow({ defId: 7, label: 'This week', total: 3 })]
    const { container, onRowContext } = renderRibbon({ rows })
    const rowEl = container.querySelector<HTMLDivElement>('[data-horizon-defid="7"]')
    expect(rowEl).not.toBeNull()
    fireEvent.contextMenu(rowEl!, { clientX: 123, clientY: 456 })
    expect(onRowContext).toHaveBeenCalledWith(7, { x: 123, y: 456 })
  })

  it('+ Add list footer button invokes onAdd with an anchor when rows are empty', () => {
    const { getByText, onAdd } = renderRibbon({ rows: [] })
    fireEvent.click(getByText('+ Add list'))
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }))
  })

  it('+ Add list footer is hidden when at least one row exists (right-click drives Insert below)', () => {
    const rows = [makeRow({ defId: 1, label: 'This week', total: 1 })]
    const { queryByText } = renderRibbon({ rows })
    expect(queryByText('+ Add list')).toBeNull()
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

  it('renders both scheduled + due bar segments with widths proportional to per-row counts', () => {
    const rows = [
      makeRow({
        defId: 1,
        label: 'This week',
        scheduled: [makeTodo({ id: 1 }), makeTodo({ id: 2 }), makeTodo({ id: 3 })],
        due: [makeTodo({ id: 4 })],
        total: 4,
      }),
    ]
    const { container } = renderRibbon({ rows, selectedDefId: null })
    const scheduledSeg = container.querySelector<HTMLElement>('[title="3 scheduled"]')
    const dueSeg = container.querySelector<HTMLElement>('[title="1 due"]')
    expect(scheduledSeg).not.toBeNull()
    expect(dueSeg).not.toBeNull()
    // Widths are 75% / 25% of the max-row width (single row → max = 4 → fillPct = 100%).
    expect(scheduledSeg!.style.width).toBe('75%')
    expect(dueSeg!.style.width).toBe('25%')
  })

  it('row with total=0 collapses both bar segments to 0% width', () => {
    const rows = [
      makeRow({ defId: 1, label: 'Empty', total: 0 }),
      makeRow({ defId: 2, label: 'With work', total: 3, scheduled: [makeTodo({ id: 1 }), makeTodo({ id: 2 }), makeTodo({ id: 3 })] }),
    ]
    const { container } = renderRibbon({ rows, selectedDefId: null })
    const emptyRow = container.querySelector('[data-horizon-defid="1"]')
    const segs = emptyRow?.querySelectorAll<HTMLElement>('[title]')
    for (const seg of Array.from(segs ?? [])) {
      // Only check the inner bar segments (have width style)
      if (seg.style.width) expect(seg.style.width).toBe('0%')
    }
  })

  it('per-row count text reflects HorizonRow.total', () => {
    const rows = [
      makeRow({ defId: 1, label: 'Many', total: 12 }),
      makeRow({ defId: 2, label: 'One', total: 1 }),
    ]
    const { container } = renderRibbon({ rows, selectedDefId: null })
    const counts = Array.from(container.querySelectorAll('[data-horizon-defid] span'))
      .map((el) => el.textContent?.trim())
      .filter((t) => t === '12' || t === '1')
    expect(counts).toContain('12')
    expect(counts).toContain('1')
  })

  it('aria-label on the bar button singularizes "task" when total === 1', () => {
    const rows = [
      makeRow({ defId: 1, label: 'Solo', total: 1, scheduled: [makeTodo({ id: 1 })] }),
      makeRow({ defId: 2, label: 'Many', total: 3, scheduled: [makeTodo({ id: 2 }), makeTodo({ id: 3 }), makeTodo({ id: 4 })] }),
    ]
    const { container } = renderRibbon({ rows })
    const soloBar = container.querySelector('[data-horizon-defid="1"] button[aria-pressed]')
    const manyBar = container.querySelector('[data-horizon-defid="2"] button[aria-pressed]')
    expect(soloBar?.getAttribute('aria-label')).toMatch(/1 task \(/)
    expect(manyBar?.getAttribute('aria-label')).toMatch(/3 tasks \(/)
  })

  it('every row exposes a drag-handle (dnd-kit useSortable wiring)', () => {
    // The handle is interactive (cursor: grab) — JSDOM can't simulate the
    // pointer drag itself, but we can assert the handle is present per row.
    const rows = [
      makeRow({ defId: 1, label: 'A' }),
      makeRow({ defId: 2, label: 'B' }),
      makeRow({ defId: 3, label: 'C' }),
    ]
    const { container } = renderRibbon({ rows })
    const rowEls = container.querySelectorAll('[data-horizon-defid]')
    for (const rowEl of Array.from(rowEls)) {
      expect(rowEl.querySelector('[role="button"]') ?? rowEl.querySelector('button')).not.toBeNull()
    }
  })

  it('clicking + Add list passes a bottom-aligned anchor relative to the button', () => {
    const { getByText, onAdd } = renderRibbon({ rows: [] })
    fireEvent.click(getByText('+ Add list'))
    const call = onAdd.mock.calls[0]?.[0] as { x: number; y: number }
    expect(typeof call.x).toBe('number')
    expect(typeof call.y).toBe('number')
  })
})
