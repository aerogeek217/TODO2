import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import { createTab, type LayoutBody, type PersistedWorkspaceLayout, type WorkspaceLayout } from '../../models/workspace-layout'
import { settleLayoutWrites, useWorkspaceStore } from '../../stores/workspace-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListOrderStore } from '../../stores/list-order-store'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'
import { cell, grid, picture } from '../helpers/layout-builders'

/**
 * The cards' store actions (layout edit mode E3): `moveEditCard`,
 * `setCellArea`, `stretchCell`, `swapCells` and tap then tap (`tapEdit`).
 * In the mode each acts on the draft — a step of the mode's own undo — and
 * writes nothing until Done, which is one global undo step.
 */

const T0 = new Date('2026-09-01T09:00:00.000Z')
const ws = () => useWorkspaceStore.getState()

const notes = (id: string) => cell(id, [createTab('notes', `${id}-t`)], { activeTabId: `${id}-t` })
const slot = (id: string) => cell(id, [])

function base(): Omit<WorkspaceLayout, 'id'> {
  // a e
  // b c
  return { sortOrder: 0, name: 'Daily', createdAt: T0, modifiedAt: T0, ...grid([[notes('a'), slot('e')], [notes('b'), notes('c')]]) }
}

async function seed(layout: Omit<WorkspaceLayout, 'id'>): Promise<number> {
  const id = await layoutRepository.insert(layout)
  await layoutRepository.setActiveId(id)
  await Promise.all([useListDefinitionStore.getState().load(), useListOrderStore.getState().load()])
  await ws().init()
  return id
}

async function stored(id: number): Promise<PersistedWorkspaceLayout> {
  await settleLayoutWrites()
  return (await db.layouts.get(id)) as PersistedWorkspaceLayout
}

const shape = () => picture(ws().working as LayoutBody)

beforeEach(async () => {
  await resetDb()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useListDefinitionStore.setState({ listDefinitions: [], loaded: false })
  useListOrderStore.setState({ ranks: new Map(), loaded: false })
})

describe('in the mode, the card actions change the draft only', () => {
  it('setCellArea: a stretch on the draft, a mode step, nothing written; Done is one global step', async () => {
    const id = await seed(base())
    await ws().enterEdit()
    expect(ws().setCellArea('a', { col: 0, row: 0, colSpan: 2, rowSpan: 1 })).toBe(true)
    expect(shape()).toEqual(['a a', 'b c'])
    expect(ws().editing?.undo).toHaveLength(1)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect((await stored(id)).cells).toHaveLength(4)
    expect(await ws().finishEdit()).toBe(true)
    expect((await stored(id)).cells).toHaveLength(3)
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('Edited layout “Daily”')
  })

  it('stretchCell: right over the slot, then back left — a slot again', async () => {
    await seed(base())
    await ws().enterEdit()
    expect(ws().stretchCell('a', 'right')).toBe(true)
    expect(shape()).toEqual(['a a', 'b c'])
    // Down: b is in the way.
    expect(ws().stretchCell('a', 'down')).toBe(false)
    expect(ws().stretchCell('a', 'left')).toBe(true)
    expect(shape()[0]?.split(' ')[0]).toBe('a')
    expect(ws().working?.cells.find((c) => c.area.row === 0 && c.area.col === 1)?.tabs).toEqual([])
    ws().undoEdit()
    ws().undoEdit()
    expect(shape()).toEqual(['a e', 'b c'])
  })

  it('swapCells: on the draft, undone by the mode', async () => {
    await seed(base())
    await ws().enterEdit()
    expect(ws().swapCells('a', 'c')).toBe(true)
    expect(shape()).toEqual(['c e', 'b a'])
    ws().undoEdit()
    expect(shape()).toEqual(['a e', 'b c'])
  })

  it('moveEditCard: onto a slot, the moved card selected where it landed', async () => {
    await seed(base())
    await ws().enterEdit()
    expect(ws().moveEditCard('c', { kind: 'cell', cellId: 'e' })).toBe(true)
    const holder = ws().working?.cells.find((x) => x.tabs.some((t) => t.id === 'c-t'))
    expect(holder?.area).toMatchObject({ col: 1, row: 0 })
    expect(ws().editing?.selectedCellId).toBe(holder?.id)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('outside the mode the same actions commit at once (one undo step each)', async () => {
    await seed(base())
    expect(ws().swapCells('a', 'c')).toBe(true)
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('Swapped cells')
  })
})

describe('tap, then tap', () => {
  it('a tap on a card selects it and arms a move; a tap on a slot moves it there', async () => {
    await seed(base())
    await ws().enterEdit()
    expect(ws().tapEdit({ kind: 'card', cellId: 'c', zone: 'middle' })).toEqual({ kind: 'select', cellId: 'c' })
    expect(ws().editing).toMatchObject({ selectedCellId: 'c', moveArmed: true })
    expect(ws().tapEdit({ kind: 'slot', cellId: 'e' })).toEqual({ kind: 'move', from: 'c', to: 'e' })
    const holder = ws().working?.cells.find((x) => x.tabs.some((t) => t.id === 'c-t'))
    expect(holder?.area).toMatchObject({ col: 1, row: 0 })
    expect(ws().editing).toMatchObject({ selectedCellId: holder?.id, moveArmed: false })
  })

  it('a tap on another card’s tab area joins them as tabs; on its edge it selects that card instead', async () => {
    await seed(base())
    await ws().enterEdit()
    ws().tapEdit({ kind: 'card', cellId: 'a', zone: 'middle' })
    expect(ws().tapEdit({ kind: 'card', cellId: 'b', zone: 'edge' })).toEqual({ kind: 'select', cellId: 'b' })
    expect(ws().editing).toMatchObject({ selectedCellId: 'b', moveArmed: true })
    expect(ws().tapEdit({ kind: 'card', cellId: 'c', zone: 'tabs' })).toEqual({ kind: 'join', from: 'b', into: 'c' })
    expect(ws().working?.cells.find((x) => x.id === 'c')?.tabs.map((t) => t.id)).toEqual(['c-t', 'b-t'])
    expect(ws().editing).toMatchObject({ selectedCellId: 'c', moveArmed: false })
  })

  it('a tap on another card’s middle swaps the two whole cards; the moved card stays selected', async () => {
    await seed(base())
    await ws().enterEdit()
    const areaOf = (id: string) => ws().working?.cells.find((x) => x.id === id)?.area
    const [a, c] = [areaOf('a'), areaOf('c')]
    ws().tapEdit({ kind: 'card', cellId: 'a', zone: 'middle' })
    expect(ws().tapEdit({ kind: 'card', cellId: 'c', zone: 'middle' })).toEqual({ kind: 'swap', from: 'a', with: 'c' })
    expect(areaOf('a')).toEqual(c)
    expect(areaOf('c')).toEqual(a)
    expect(ws().editing).toMatchObject({ selectedCellId: 'a', moveArmed: false })
  })

  it('the armed card again disarms; Esc’s disarm keeps the selection; a slot with nothing armed asks for its kinds', async () => {
    await seed(base())
    await ws().enterEdit()
    ws().tapEdit({ kind: 'card', cellId: 'a', zone: 'middle' })
    expect(ws().tapEdit({ kind: 'card', cellId: 'a', zone: 'middle' })).toEqual({ kind: 'disarm' })
    expect(ws().editing).toMatchObject({ selectedCellId: 'a', moveArmed: false })
    ws().selectEditCell('a', { arm: true })
    ws().disarmEditMove()
    expect(ws().editing).toMatchObject({ selectedCellId: 'a', moveArmed: false })
    expect(ws().tapEdit({ kind: 'slot', cellId: 'e' })).toEqual({ kind: 'menu', cellId: 'e' })
    expect(ws().editing?.selectedCellId).toBe('e')
  })

  it('an edit or the mode’s undo disarms a pending move', async () => {
    await seed(base())
    await ws().enterEdit()
    ws().tapEdit({ kind: 'card', cellId: 'a', zone: 'middle' })
    ws().swapCells('b', 'c')
    expect(ws().editing?.moveArmed).toBe(false)
    ws().selectEditCell('a', { arm: true })
    ws().undoEdit()
    expect(ws().editing?.moveArmed).toBe(false)
  })
})
