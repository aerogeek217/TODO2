import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import { createTab, type LayoutBody, type PersistedWorkspaceLayout, type WorkspaceLayout } from '../../models/workspace-layout'
import { settleLayoutWrites, useWorkspaceStore } from '../../stores/workspace-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListOrderStore } from '../../stores/list-order-store'
import { useUndoStore } from '../../stores/undo-store'
import { validateTiling } from '../../utils/workspace-grid'
import { resetDb } from '../helpers'
import { cell, grid, picture } from '../helpers/layout-builders'

/**
 * The rulers' store actions (layout edit mode E2): `insertTrackAt`,
 * `removeTrack`, `mergeTrackInto` and `evenTracks`. In the mode each acts on
 * the draft — a step of the mode's own undo (sizes: view state, none) — and
 * writes nothing until Done.
 */

const T0 = new Date('2026-09-01T09:00:00.000Z')
const ws = () => useWorkspaceStore.getState()

async function settle() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0))
  await settleLayoutWrites()
}

const notes = (id: string) => cell(id, [createTab('notes', `${id}-t`)], { activeTabId: `${id}-t` })

function twoByTwo(): Omit<WorkspaceLayout, 'id'> {
  return {
    sortOrder: 0,
    name: 'Daily',
    createdAt: T0,
    modifiedAt: T0,
    ...grid([[notes('a'), notes('b')], [notes('c'), notes('d')]], { cols: [600, 400], rows: [500, 500] }),
  }
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

const tabsOf = (l: LayoutBody | null | undefined, cellId: string) => l?.cells.find((c) => c.id === cellId)?.tabs.map((t) => t.id)

beforeEach(async () => {
  await resetDb()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useListDefinitionStore.setState({ listDefinitions: [], loaded: false })
  useListOrderStore.setState({ ranks: new Map(), loaded: false })
})

describe('in the mode, the track actions change the draft only', () => {
  it('insertTrackAt: a row on the draft, a mode step, nothing written', async () => {
    const id = await seed(twoByTwo())
    await ws().enterEdit()
    const cellId = ws().insertTrackAt('rows', 1)
    expect(cellId).not.toBeNull()
    expect(picture(ws().working as LayoutBody)).toEqual(['a b', `${cellId} ${cellId}`, 'c d'])
    expect(ws().editing?.undo).toHaveLength(1)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect((await stored(id)).grid.rows).toHaveLength(2)
    // The mode's Undo takes it back.
    ws().undoEdit()
    expect(picture(ws().working as LayoutBody)).toEqual(['a b', 'c d'])
  })

  it('removeTrack: the row’s widgets join the cells above as tabs, on the draft; Done writes it as one step', async () => {
    const id = await seed(twoByTwo())
    await ws().enterEdit({ cellId: 'c' })
    expect(ws().removeTrack('rows', 1)).toBe(true)
    expect(tabsOf(ws().working, 'a')).toEqual(['a-t', 'c-t'])
    expect(validateTiling(ws().working as LayoutBody)).toBe(true)
    // The selected cell joined another: the selection lets go.
    expect(ws().editing?.selectedCellId).toBeNull()
    expect((await stored(id)).cells).toHaveLength(4)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)

    expect(await ws().finishEdit()).toBe(true)
    await settle()
    expect(tabsOf(await stored(id), 'a')).toEqual(['a-t', 'c-t'])
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Edited layout “Daily”'])
  })

  it('removeTrack refuses the last track: no step', async () => {
    await seed({ sortOrder: 0, name: 'One', createdAt: T0, modifiedAt: T0, ...grid([[notes('a'), notes('b')]]) })
    await ws().enterEdit()
    expect(ws().removeTrack('rows', 0)).toBe(false)
    expect(ws().editing?.undo).toHaveLength(0)
  })

  it('mergeTrackInto: the line between two columns goes, on the draft', async () => {
    const x = notes('x')
    const y = notes('y')
    const z = notes('z')
    const w = notes('w')
    const id = await seed({ sortOrder: 0, name: 'Sliver', createdAt: T0, modifiedAt: T0, ...grid([[x, y, y], [z, z, w]], { cols: [500, 10, 490] }) })
    await ws().enterEdit()
    expect(ws().mergeTrackInto('columns', 1, 2)).toBe(true)
    expect(picture(ws().working as LayoutBody)).toEqual(['x y', 'z w'])
    expect(ws().editing?.undo).toHaveLength(1)
    expect((await stored(id)).grid.columns).toHaveLength(3)
  })

  it('evenTracks: the draft’s weights even, nothing written, no step', async () => {
    const id = await seed(twoByTwo())
    await ws().enterEdit()
    await ws().evenTracks('columns')
    expect(ws().working?.grid.columns.map((t) => t.weight)).toEqual([500, 500])
    expect(ws().editing?.undo).toHaveLength(0)
    expect((await stored(id)).grid.columns.map((t) => t.weight)).toEqual([600, 400])
  })
})

describe('outside the mode', () => {
  it('a track action is an ordinary layout edit: written at once, one undo step', async () => {
    const id = await seed(twoByTwo())
    ws().removeTrack('columns', 1)
    await settle()
    expect(picture(await stored(id))).toEqual(['a', 'c'])
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Removed column'])
  })
})
