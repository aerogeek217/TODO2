import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import { settleLayoutWrites, useWorkspaceStore } from '../../stores/workspace-store'
import { createTab, kindTabTitle, tabStripIcon, tabTopLineIcon, type LayoutTab, type PersistedWorkspaceLayout, type WorkspaceLayout } from '../../models/workspace-layout'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useUndoStore } from '../../stores/undo-store'
import { getTab } from '../../utils/workspace-layout-queries'
import { resetDb } from '../helpers'
import { cell, grid } from '../helpers/layout-builders'

const T0 = new Date('2026-09-01T09:00:00.000Z')

function layoutOf(tabs: LayoutTab[]): Omit<WorkspaceLayout, 'id'> {
  return { sortOrder: 0, name: 'Daily', createdAt: T0, modifiedAt: T0, ...grid([[cell('k', tabs, { activeTabId: tabs[0]?.id })]], { colIds: ['A'], rowIds: ['R'] }) }
}

async function open(tabs: LayoutTab[]): Promise<number> {
  const id = await layoutRepository.insert(layoutOf(tabs))
  await layoutRepository.setActiveId(id)
  await useWorkspaceStore.getState().init()
  return id
}

async function stored(id: number): Promise<PersistedWorkspaceLayout> {
  await settleLayoutWrites()
  const row = (await db.layouts.get(id)) as PersistedWorkspaceLayout | undefined
  if (!row) throw new Error(`no layout ${id}`)
  return row
}

const ws = () => useWorkspaceStore.getState()
const tab = (id: string) => { const w = ws().working; return w ? getTab(w, id) : undefined }
const undoNames = () => useUndoStore.getState().undoStack.map((e) => e.description)
const undo = () => useUndoStore.getState().undo()
const redo = () => useUndoStore.getState().redo()

beforeEach(async () => {
  await resetDb()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
})

describe('a tab’s name (items 11, 14)', () => {
  it('a kind without a name of its own takes the tab’s name: stored, one undo step, Undo / Redo', async () => {
    const id = await open([createTab('calendar', 'c1'), createTab('notes', 'n1')])
    expect(await ws().renameTab('c1', '  Deadlines ')).toBe(true)
    expect(tab('c1')?.name).toBe('Deadlines')
    expect(kindTabTitle(tab('c1')!)).toBe('Deadlines')
    expect((await stored(id)).cells[0]!.tabs[0]!.name).toBe('Deadlines')
    expect(undoNames()).toEqual(['Renamed tab to “Deadlines”'])
    await undo()
    expect(tab('c1')?.name).toBeUndefined()
    expect(kindTabTitle(tab('c1')!)).toBe('Calendar')
    await redo()
    expect(tab('c1')?.name).toBe('Deadlines')
  })

  it('a blank name goes back to the kind’s label (the key goes)', async () => {
    await open([{ ...createTab('notes', 'n1'), name: 'Scratch' }])
    expect(await ws().renameTab('n1', '   ')).toBe(true)
    expect(tab('n1')).not.toHaveProperty('name')
    expect(undoNames()).toEqual(['Renamed tab to “Notes”'])
  })

  it('the same name again writes nothing', async () => {
    await open([{ ...createTab('notes', 'n1'), name: 'Scratch' }])
    expect(await ws().renameTab('n1', 'Scratch')).toBe(false)
    expect(undoNames()).toEqual([])
  })

  it('a Number’s name is its config.name', async () => {
    await open([createTab('number', 'u1')])
    await ws().renameTab('u1', 'Late')
    const t = tab('u1')
    expect(t?.kind === 'number' && t.config.name).toBe('Late')
    expect(t).not.toHaveProperty('name')
    expect(undoNames()).toEqual(['Renamed tab to “Late”'])
  })

  it('Created vs completed’s name is its config.name; a blank one is none', async () => {
    await open([createTab('trend', 't1')])
    await ws().renameTab('t1', 'Throughput')
    expect(kindTabTitle(tab('t1')!)).toBe('Throughput')
    await ws().renameTab('t1', '')
    const t = tab('t1')
    expect(t?.kind === 'trend' && t.config.name).toBeUndefined()
    expect(kindTabTitle(t!)).toBe('Created vs completed')
  })

  it('a list tab’s name is its list’s, written as Edit list writes it; a blank one keeps it', async () => {
    const layoutId = await layoutRepository.insert(layoutOf([createTab('notes', 'n1')]))
    const listId = await useListDefinitionStore.getState().add({ name: 'Inbox', owner: { layoutId } })
    await db.layouts.update(layoutId, layoutOf([createTab('lens', 'l1', { listDefinitionId: listId })]))
    await layoutRepository.setActiveId(layoutId)
    await ws().init()
    expect(await ws().renameTab('l1', 'This week')).toBe(true)
    expect(useListDefinitionStore.getState().listDefinitions.find((d) => d.id === listId)?.name).toBe('This week')
    expect(tab('l1')).not.toHaveProperty('name')
    expect(undoNames().at(-1)).toBe('Renamed tab to “This week”')
    expect(await ws().renameTab('l1', ' ')).toBe(false)
    await undo()
    expect(useListDefinitionStore.getState().listDefinitions.find((d) => d.id === listId)?.name).toBe('Inbox')
  })
})

describe('a tab’s icon (items 11, 14)', () => {
  it('never picked: the strip shows the kind’s glyph (J1), the top line none (J2)', async () => {
    await open([createTab('calendar', 'c1')])
    expect(tabStripIcon(tab('c1')!)).toEqual({ kind: 'line', key: 'calendar' })
    expect(tabTopLineIcon(tab('c1')!)).toBeUndefined()
  })

  it('a pick is stored and is one undo step; No icon is stored explicitly', async () => {
    const id = await open([{ ...createTab('calendar', 'c1'), name: 'Deadlines' }])
    expect(ws().setTabIcon('c1', { kind: 'emoji', emoji: '🔥' })).toBe(true)
    expect(tab('c1')?.icon).toEqual({ kind: 'emoji', emoji: '🔥' })
    expect(tabTopLineIcon(tab('c1')!)).toEqual({ kind: 'emoji', emoji: '🔥' })
    expect((await stored(id)).cells[0]!.tabs[0]!.icon).toEqual({ kind: 'emoji', emoji: '🔥' })
    ws().setTabIcon('c1', { kind: 'emoji', emoji: '🔥', show: 'color' })
    ws().setTabIcon('c1', { kind: 'none' })
    expect(tabStripIcon(tab('c1')!)).toEqual({ kind: 'none' })
    expect(tabTopLineIcon(tab('c1')!)).toBeUndefined()
    expect(undoNames()).toEqual(['Changed icon of “Deadlines”', 'Changed icon of “Deadlines”', 'Changed icon of “Deadlines”'])
    await undo()
    expect(tab('c1')?.icon).toEqual({ kind: 'emoji', emoji: '🔥', show: 'color' })
    await undo()
    await undo()
    expect(tab('c1')).not.toHaveProperty('icon')
    await redo()
    expect(tab('c1')?.icon).toEqual({ kind: 'emoji', emoji: '🔥' })
  })

  it('the same icon again writes nothing', async () => {
    await open([{ ...createTab('notes', 'n1'), icon: { kind: 'line', key: 'flag' } }])
    expect(ws().setTabIcon('n1', { kind: 'line', key: 'flag' })).toBe(false)
    expect(undoNames()).toEqual([])
  })

  it('Change widget keeps the icon, and the tab name where the new kind takes one', async () => {
    await open([{ ...createTab('calendar', 'c1'), name: 'Deadlines', icon: { kind: 'emoji', emoji: '📅' } }])
    ws().changeTabKind('c1', 'notes')
    expect(tab('c1')).toMatchObject({ kind: 'notes', name: 'Deadlines', icon: { kind: 'emoji', emoji: '📅' } })
    ws().changeTabKind('c1', 'number')
    expect(tab('c1')).toMatchObject({ kind: 'number', icon: { kind: 'emoji', emoji: '📅' } })
    expect(tab('c1')).not.toHaveProperty('name')
  })

  it('names the tab in other undo steps (Closed tab “…”)', async () => {
    await open([{ ...createTab('calendar', 'c1'), name: 'Deadlines' }, createTab('notes', 'n1')])
    ws().closeTab('c1')
    expect(undoNames()).toEqual(['Closed tab “Deadlines”'])
  })
})
