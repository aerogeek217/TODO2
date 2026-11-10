import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, fireEvent, renderHook } from '@testing-library/react'
import { WorkspaceDivider } from '../../../components/workspace/WorkspaceDivider'
import { useKeyboardShortcuts } from '../../../hooks/use-keyboard-shortcuts'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { createTab, type LayoutBody, type PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { edgeStretches, type EdgeStretch } from '../../../utils/workspace-grid'
import { cell, grid, picture } from '../../helpers/layout-builders'
import { layoutSteps } from '../../helpers/layout-steps'

/**
 * A divider of the table (D26 P2): ↑ / ↓ move it without running the app's
 * task shortcuts; a drag of a whole line reweights its two tracks as view
 * state (live frames, one save); a drag of part of a line makes a new line
 * — an unsaved edit — on release.
 */

const noop = () => {}
const AT = new Date(2026, 0, 1)

function open(body: LayoutBody): void {
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'Main', createdAt: AT, modifiedAt: AT, ...body }
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, writeFailed: false, hydrated: true })
}

function working(): LayoutBody {
  const w = useWorkspaceStore.getState().working
  if (!w) throw new Error('no working layout')
  return w
}

/** The divider of `stretch` in a table drawn `rows` high (and 600px wide). */
function renderDivider(stretch: EdgeStretch, rows: string, columns = '600px') {
  const { container } = render(
    <div data-ws-table="" style={{ gridTemplateRows: rows, gridTemplateColumns: columns }}>
      <WorkspaceDivider stretch={stretch} beforeId="a" afterId="b" label="Resize a and b" value={{ now: 50, max: 100 }} style={{}} />
    </div>,
  )
  const table = container.querySelector<HTMLElement>('[data-ws-table]')!
  // JSDOM computes no grid: the template as drawn.
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    gridTemplateRows: rows,
    gridTemplateColumns: columns,
    paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px', columnGap: '6px',
  }) as unknown as CSSStyleDeclaration)
  return { divider: container.querySelector<HTMLElement>('[data-ws-divider]')!, table }
}

afterEach(() => {
  // Unmounted, not only detached: a mounted tree keeps its document listeners (the shortcuts hook's).
  cleanup()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const a = cell('a', [createTab('notes', 'na')])
const b = cell('b', [createTab('notes', 'nb')])

describe('workspace dividers and the arrow-key shortcuts', () => {
  it('↑ / ↓ on a divider between two rows leave the task selection alone, and still resize', () => {
    renderHook(() => useKeyboardShortcuts({ openPalette: noop, closePalette: noop, openSettings: noop, openShortcutsModal: noop }))
    const row = document.createElement('div')
    row.setAttribute('data-todo-id', '7')
    row.scrollIntoView = vi.fn()
    document.body.appendChild(row)
    open(grid([[a], [b]]))
    const stretch = edgeStretches(working())[0]!
    const { divider } = renderDivider(stretch, '300px 300px')
    divider.focus()
    fireEvent.keyDown(divider, { key: 'ArrowDown' })
    const [top, bottom] = working().grid.rows
    expect(top!.weight!).toBeGreaterThan(bottom!.weight!)
    expect(useUIStore.getState().selectedTodoIds.size).toBe(0)
    expect(layoutSteps()).toEqual([])
  })
})

describe('a divider drag', () => {
  it('a whole line: the two tracks share their size anew, saved as view state (never unsaved)', () => {
    open(grid([[a], [b]]))
    const stretch = edgeStretches(working())[0]!
    const { divider } = renderDivider(stretch, '300px 300px')
    fireEvent.pointerDown(divider, { button: 0, pointerId: 1, clientX: 10, clientY: 300 })
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 10, clientY: 360 })
    fireEvent.pointerUp(divider, { pointerId: 1, clientX: 10, clientY: 360 })
    const [top, bottom] = working().grid.rows
    expect(top!.weight! / bottom!.weight!).toBeCloseTo(360 / 240)
    expect(layoutSteps()).toEqual([])
    expect(useWorkspaceStore.getState().saved?.grid.rows[0]?.weight).toBeCloseTo(top!.weight!)
  })

  it('part of a line: a new line where it is let go, an unsaved edit', () => {
    const c = cell('c', [createTab('notes', 'nc')])
    const x = cell('x', [createTab('notes', 'nx')])
    const y = cell('y', [createTab('notes', 'ny')])
    // a | c | x over b | c | y: the level line has two stretches, c spanning between them.
    open(grid([[a, c, x], [b, c, y]]))
    const stretch = edgeStretches(working()).find((s) => s.axis === 'rows' && s.from === 0)!
    expect(stretch.to).toBe(1)
    const { divider } = renderDivider(stretch, '300px 300px', '200px 200px 200px')
    fireEvent.pointerDown(divider, { button: 0, pointerId: 1, clientX: 10, clientY: 300 })
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 10, clientY: 380 })
    fireEvent.pointerUp(divider, { pointerId: 1, clientX: 10, clientY: 380 })
    expect(picture(working())).toEqual(['a c x', 'a c y', 'b c y'])
    expect(layoutSteps()).not.toEqual([])
  })

  it('a cancelled part-line drag changes nothing', () => {
    const c = cell('c', [createTab('notes', 'nc')])
    const x = cell('x', [createTab('notes', 'nx')])
    const y = cell('y', [createTab('notes', 'ny')])
    open(grid([[a, c, x], [b, c, y]]))
    const before = working()
    const stretch = edgeStretches(working()).find((s) => s.axis === 'rows' && s.from === 0)!
    const { divider } = renderDivider(stretch, '300px 300px', '200px 200px 200px')
    fireEvent.pointerDown(divider, { button: 0, pointerId: 1, clientX: 10, clientY: 300 })
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 10, clientY: 380 })
    fireEvent.pointerCancel(divider, { pointerId: 1, clientX: 10, clientY: 380 })
    expect(picture(working())).toEqual(picture(before))
    expect(layoutSteps()).toEqual([])
  })
})
