import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, render, fireEvent } from '@testing-library/react'
import { WorkspaceCrossing } from '../../../components/workspace/WorkspaceCrossing'
import { useUndoStore } from '../../../stores/undo-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { createTab, type LayoutBody, type PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { lineCrossings } from '../../../utils/workspace-grid'
import { cell, grid, picture } from '../../helpers/layout-builders'
import { layoutSteps, settleLayoutWrites } from '../../helpers/layout-steps'

/**
 * A crossing handle's undo steps (cr34 W9): one drag is one step, also
 * when it changes the structure on both axes — each line landing on
 * another line —, and its key steps merge as a divider's do.
 */

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

const filled = (id: string) => cell(id, [createTab('notes', `${id}-t`)])
const [p, q, r, s, w1, w2, z1, z2] = ['p', 'q', 'r', 's', 'w1', 'w2', 'z1', 'z2'].map(filled) as [
  ReturnType<typeof filled>, ReturnType<typeof filled>, ReturnType<typeof filled>, ReturnType<typeof filled>,
  ReturnType<typeof filled>, ReturnType<typeof filled>, ReturnType<typeof filled>, ReturnType<typeof filled>,
]

/**
 * p  q  q  w1     Four 200px tracks each way. The "+" where p, q, r and s
 * r  s  s  w1     meet moves the first upright line and the first level
 * r  s  s  w2     line whole; the second upright line is an edge only in
 * z1 z1 z2 w2     the last row (z1 | z2), the second level one only in the
 *                 last column (w1 | w2) — each a line the drag can land on.
 */
function table(): LayoutBody {
  return grid([[p, q, q, w1], [r, s, s, w1], [r, s, s, w2], [z1, z1, z2, w2]])
}

const TRACKS = '200px 200px 200px 200px'
/** The table's tracks as drawn (JSDOM computes no grid). */
const drawn = { columns: TRACKS, rows: TRACKS }

/** The crossing handle of `table()` in a table drawn 4 × 200px each way. */
function renderCrossing() {
  drawn.columns = TRACKS
  drawn.rows = TRACKS
  const { container } = render(
    <div data-ws-table="">
      <WorkspaceCrossing col={1} row={1} cornerId="p" testId="p|s" />
    </div>,
  )
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
    gridTemplateRows: drawn.rows,
    gridTemplateColumns: drawn.columns,
  }) as unknown as CSSStyleDeclaration)
  return container.querySelector<HTMLElement>('[data-ws-crossing]')!
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('a crossing drag that changes the structure on both axes', () => {
  it('is one undo step: one Undo puts the table back', async () => {
    open(table())
    expect(lineCrossings(working())).toContainEqual({ col: 1, row: 1 })
    const before = picture(working())
    const handle = renderCrossing()
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400, clientY: 400 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 400, clientY: 400 })
    // Both lines landed on the next line of their axis: the first two tracks are one, each way.
    expect(picture(working())).toEqual(['p q w1', 'r s w2', 'z1 z2 w2'])
    expect(layoutSteps()).toEqual(['Moved divider'])
    await settleLayoutWrites()
    await act(async () => { await useUndoStore.getState().undo() })
    expect(picture(working())).toEqual(before)
    expect(layoutSteps()).toEqual([])
  })

  it('a second drag is a step of its own', () => {
    open(table())
    const handle = renderCrossing()
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400, clientY: 200 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 400, clientY: 200 })
    expect(picture(working())).toEqual(['p q w1', 'r s w1', 'r s w2', 'z1 z2 w2'])
    expect(layoutSteps()).toEqual(['Moved divider'])
    // The table as now drawn: three columns. The "+" is still where p, q, r and s meet.
    drawn.columns = '400px 200px 200px'
    fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientX: 400, clientY: 200 })
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 400, clientY: 400 })
    fireEvent.pointerUp(handle, { pointerId: 2, clientX: 400, clientY: 400 })
    expect(picture(working())).toEqual(['p q w1', 'r s w2', 'z1 z2 w2'])
    expect(layoutSteps()).toEqual(['Moved divider', 'Moved divider'])
  })
})

describe('a crossing handle’s key steps', () => {
  it('carry one merge key, as a divider’s do: the store merges a run of them into one undo step', () => {
    open(table())
    const handle = renderCrossing()
    const moveEdge = vi.spyOn(useWorkspaceStore.getState(), 'moveEdge')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(moveEdge).toHaveBeenCalledTimes(2)
    for (const call of moveEdge.mock.calls) expect(call[3]).toEqual({ mergeKey: 'crossing:p|s' })
  })
})
