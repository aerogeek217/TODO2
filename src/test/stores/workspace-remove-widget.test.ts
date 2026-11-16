import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import { createTab, type PersistedWorkspaceLayout, type WorkspaceLayout } from '../../models/workspace-layout'
import { settleLayoutWrites, useWorkspaceStore } from '../../stores/workspace-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListOrderStore } from '../../stores/list-order-store'
import { useUndoStore } from '../../stores/undo-store'
import { addTabToCell } from '../../components/workspace/widget-hooks'
import { resetDb } from '../helpers'
import { cell, grid, picture } from '../helpers/layout-builders'

/**
 * The normal workspace's widget edits (layout edit mode E4 — edit mode
 * changes the grid; what's inside a cell changes in place): Remove widget
 * keeps its cell (a lone widget's becomes an empty cell) as one undo step;
 * Add widget as tab adds to that cell; in the mode both change only the
 * draft.
 */

const T0 = new Date('2026-09-01T09:00:00.000Z')
const ws = () => useWorkspaceStore.getState()
const undoNames = () => useUndoStore.getState().undoStack.map((e) => e.description)

async function settle() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0))
  await settleLayoutWrites()
}

/** a (Notes) | b (Calendar, Project pulse) over c (Review) spanning both. */
function layout(): Omit<WorkspaceLayout, 'id'> {
  const a = cell('a', [createTab('notes', 'a1')])
  const b = cell('b', [createTab('calendar', 'b1'), createTab('pulse', 'b2')], { activeTabId: 'b1' })
  const c = cell('c', [createTab('review', 'c1')])
  return { sortOrder: 0, name: 'Daily', createdAt: T0, modifiedAt: T0, ...grid([[a, b], [c, c]], { colIds: ['A', 'B'], rowIds: ['R1', 'R2'] }) }
}

async function seed(): Promise<number> {
  const id = await layoutRepository.insert(layout())
  await layoutRepository.setActiveId(id)
  await Promise.all([useListDefinitionStore.getState().load(), useListOrderStore.getState().load()])
  await ws().init()
  return id
}

async function stored(id: number): Promise<PersistedWorkspaceLayout> {
  await settleLayoutWrites()
  return (await db.layouts.get(id)) as PersistedWorkspaceLayout
}

const tabsOf = (cellId: string) => ws().working?.cells.find((c) => c.id === cellId)?.tabs.map((t) => t.id)

beforeEach(async () => {
  await resetDb()
})

describe('removeWidget', () => {
  it('a lone widget: its cell stays, empty, in its place — one undo step, written at once; Undo brings the widget back', async () => {
    const id = await seed()
    ws().removeWidget('a1')
    expect(picture(ws().working!)).toEqual(['a b', 'c c'])
    expect(tabsOf('a')).toEqual([])
    expect(undoNames()).toEqual(['Removed “Notes”'])
    expect((await stored(id)).cells.find((c) => c.id === 'a')?.tabs).toEqual([])
    await useUndoStore.getState().undo()
    await settle()
    expect(tabsOf('a')).toEqual(['a1'])
    expect((await stored(id)).cells.find((c) => c.id === 'a')?.tabs.map((t) => t.id)).toEqual(['a1'])
  })

  it('one of several tabs: that tab goes, the cell keeps the rest (as closeTab)', async () => {
    await seed()
    ws().removeWidget('b1')
    expect(tabsOf('b')).toEqual(['b2'])
    expect(ws().working?.cells.find((c) => c.id === 'b')?.activeTabId).toBe('b2')
    expect(undoNames()).toEqual(['Removed “Calendar”'])
  })

  it('an unknown tab changes nothing', async () => {
    await seed()
    const before = ws().working
    ws().removeWidget('nope')
    expect(ws().working).toBe(before)
    expect(undoNames()).toEqual([])
  })

  it('in the layout edit mode: the draft only — a step of the mode’s undo, nothing written or on the global stack', async () => {
    const id = await seed()
    expect(await ws().enterEdit()).toBe(true)
    ws().removeWidget('a1')
    expect(tabsOf('a')).toEqual([])
    expect(ws().saved?.cells.find((c) => c.id === 'a')?.tabs).toHaveLength(1)
    expect(ws().editing?.undo).toHaveLength(1)
    expect(undoNames()).toEqual([])
    expect((await stored(id)).cells.find((c) => c.id === 'a')?.tabs).toHaveLength(1)
    ws().undoEdit()
    expect(tabsOf('a')).toEqual(['a1'])
    ws().leaveEdit()
  })
})

describe('addTabToCell (Add widget as tab ›, an empty cell’s picker)', () => {
  it('adds the kind as a new tab of that cell, made its active one, as one undo step', async () => {
    await seed()
    addTabToCell('a', 'calendar')
    const a = ws().working?.cells.find((c) => c.id === 'a')
    expect(a?.tabs.map((t) => t.kind)).toEqual(['notes', 'calendar'])
    expect(a?.activeTabId).toBe(a?.tabs[1]?.id)
    expect(ws().working?.cells).toHaveLength(3)
    expect(undoNames()).toEqual(['Added “Calendar”'])
  })

  it('fills an empty cell (a lone widget removed): the cell keeps its place', async () => {
    await seed()
    ws().removeWidget('a1')
    addTabToCell('a', 'neglect')
    expect(picture(ws().working!)).toEqual(['a b', 'c c'])
    expect(ws().working?.cells.find((c) => c.id === 'a')?.tabs.map((t) => t.kind)).toEqual(['neglect'])
  })

  it('a Breakdown from its preset', async () => {
    await seed()
    addTabToCell('a', 'breakdown', 'tags')
    const tab = ws().working?.cells.find((c) => c.id === 'a')?.tabs[1]
    expect(tab?.kind).toBe('breakdown')
    expect(tab?.kind === 'breakdown' ? tab.config.splitBy : undefined).toBe('tags')
  })

  it('a List gets a new list of the layout', async () => {
    const id = await seed()
    addTabToCell('a', 'lens')
    await settle()
    const tab = ws().working?.cells.find((c) => c.id === 'a')?.tabs[1]
    expect(tab?.kind).toBe('lens')
    const listId = tab?.kind === 'lens' ? tab.config.listDefinitionId : undefined
    expect(listId).toBeDefined()
    expect(await db.listDefinitions.get(listId!)).toMatchObject({ name: 'New list', owner: { layoutId: id } })
  })

  it('in the layout edit mode: the draft only', async () => {
    await seed()
    expect(await ws().enterEdit()).toBe(true)
    addTabToCell('a', 'calendar')
    expect(tabsOf('a')).toHaveLength(2)
    expect(ws().saved?.cells.find((c) => c.id === 'a')?.tabs).toHaveLength(1)
    expect(ws().editing?.undo).toHaveLength(1)
    expect(undoNames()).toEqual([])
    ws().leaveEdit()
  })
})
