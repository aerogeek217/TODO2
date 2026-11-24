import { describe, it, expect } from 'vitest'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import { createTab, type LayoutTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { emptyPredicate } from '../../models/filter-predicate'
import type { ListDefinition, ListOwner } from '../../models/list-definition'
import { settleLayoutWrites, useWorkspaceStore } from '../../stores/workspace-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListOrderStore } from '../../stores/list-order-store'
import { useUndoStore } from '../../stores/undo-store'
import { layoutListRefs } from '../../utils/workspace-layout-lists'
import { cell, grid, single, freshNumberTab } from '../helpers/layout-builders'

/**
 * Move / Copy to layout: a widget or a cell of the open layout is carried to
 * another layout, which opens in the layout edit mode with it in hand; Done
 * writes both layouts as one undo step that undoes from either.
 */

const T0 = new Date('2026-09-01T09:00:00.000Z')
const ws = () => useWorkspaceStore.getState()
const undoStore = () => useUndoStore.getState()

const listTab = (id: string, listDefinitionId: number): LayoutTab => createTab('lens', id, { listDefinitionId })
/** A Numbers widget of one Number (`id`) following list `listDefinitionId`. */
const follower = (id: string, listDefinitionId: number): LayoutTab => {
  const tab = freshNumberTab(id)
  return { ...tab, config: { items: [{ ...tab.config.items[0]!, show: 'list', list: { listDefinitionId } }] } }
}

function def(name: string, owner: ListOwner): Omit<ListDefinition, 'id'> {
  return { name, sortOrder: 0, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() }, owner }
}

type Body = Omit<WorkspaceLayout, 'id' | 'sortOrder' | 'name' | 'createdAt' | 'modifiedAt'>
const row = (name: string, body: Body): Omit<WorkspaceLayout, 'id' | 'sortOrder'> => ({ name, createdAt: T0, modifiedAt: T0, ...body })

interface World {
  a: number
  b: number
  list: number
}

/** A (open): cell `ka` with a list tab `lt` (list "Inbox", A's, manual order) beside cell `kn` with notes `nt`. B: one notes tab `bt`. */
async function world(): Promise<World> {
  const a = await layoutRepository.insert(row('A', single(cell('x'))))
  const b = await layoutRepository.insert(row('B', single(cell('kb', [createTab('notes', 'bt')], { activeTabId: 'bt' }), { prefix: 'B-' })))
  const list = (await db.listDefinitions.add(def('Inbox', { layoutId: a }))) as number
  await db.layouts.update(a, row('A', grid([[cell('ka', [listTab('lt', list)], { activeTabId: 'lt' }), cell('kn', [createTab('notes', 'nt')])]], { prefix: 'A-' })))
  await db.listOrders.bulkAdd([
    { listDefinitionId: list, todoId: 1, rank: 1 },
    { listDefinitionId: list, todoId: 2, rank: 2 },
  ])
  await layoutRepository.setActiveId(a)
  await Promise.all([useListDefinitionStore.getState().load(), useListOrderStore.getState().load()])
  await ws().init()
  return { a, b, list }
}

const stored = async (id: number) => {
  await settleLayoutWrites()
  const r = await db.layouts.get(id)
  if (!r) throw new Error('layout gone')
  return r
}
const tabIds = (l: { cells: { tabs: { id: string }[] }[] }) => l.cells.flatMap((c) => c.tabs.map((t) => t.id))
const ownerOf = async (id: number) => (await db.listDefinitions.get(id))?.owner
const ranksOf = async (id: number) => (await db.listOrders.where('listDefinitionId').equals(id).toArray()).map((r) => [r.todoId, r.rank])
const undoNames = () => undoStore().undoStack.map((e) => e.description)

/** Carries and places at the bottom; leaves the mode open. */
async function carryAndPlace(to: number, what: Parameters<WorkspaceState['transferTo']>[1], copy: boolean) {
  expect(await ws().transferTo(to, what, copy)).toBe(true)
  expect(ws().placeIncoming({ kind: 'bottom' })).toBe(true)
}
type WorkspaceState = ReturnType<typeof ws>

describe('Move to layout', () => {
  it('opens the target in the edit mode with the widget in hand and writes nothing yet', async () => {
    const w = await world()
    const aBefore = await stored(w.a)
    expect(await ws().transferTo(w.b, { kind: 'tab', tabId: 'lt' }, false)).toBe(true)
    expect(ws().activeLayoutId).toBe(w.b)
    expect(ws().editing?.incoming).toMatchObject({ copy: false, sourceLayoutId: w.a, sourceName: 'A', sourceTabIds: ['lt'] })
    expect(await stored(w.a)).toEqual(aBefore)
    expect(tabIds(await stored(w.b))).toEqual(['bt'])
    expect(undoNames()).toEqual([])
  })

  it('refuses the open layout, an unknown layout and a missing widget', async () => {
    const w = await world()
    expect(await ws().transferTo(w.a, { kind: 'tab', tabId: 'lt' }, false)).toBe(false)
    expect(await ws().transferTo(999, { kind: 'tab', tabId: 'lt' }, false)).toBe(false)
    expect(await ws().transferTo(w.b, { kind: 'tab', tabId: 'nope' }, false)).toBe(false)
    expect(ws().editing).toBeNull()
    expect(ws().activeLayoutId).toBe(w.a)
  })

  it('Done while the widget is unplaced does not transfer', async () => {
    const w = await world()
    await ws().transferTo(w.b, { kind: 'tab', tabId: 'lt' }, false)
    await ws().finishEdit()
    expect(undoNames()).toEqual([])
    expect(tabIds(await stored(w.a))).toContain('lt')
    expect(tabIds(await stored(w.b))).toEqual(['bt'])
    // Done with nothing placed just leaves the mode (no write, no step).
    expect(ws().editing).toBeNull()
  })

  it('places at the bottom, then Done writes both layouts, hands the list over and pushes one undo step', async () => {
    const w = await world()
    await carryAndPlace(w.b, { kind: 'tab', tabId: 'lt' }, false)
    expect(ws().placeIncoming({ kind: 'bottom' })).toBe(false)
    expect(await ws().finishEdit()).toBe(true)
    expect(ws().editing).toBeNull()

    const b = await stored(w.b)
    expect(tabIds(b)).toEqual(['bt', 'lt'])
    const a = await stored(w.a)
    expect(tabIds(a)).toEqual(['nt'])
    expect(a.cells.find((c) => c.id === 'ka')?.tabs).toEqual([])
    expect(layoutListRefs(b)).toEqual(new Set([w.list]))
    expect(await ownerOf(w.list)).toEqual({ layoutId: w.b })
    expect(await ranksOf(w.list)).toEqual([[1, 1], [2, 2]])
    expect(undoNames()).toEqual(['Moved “Inbox” to “B”'])
  })

  it('undo from the target brings both layouts and the list owner back; redo moves it again', async () => {
    const w = await world()
    const aBefore = await stored(w.a)
    const bBefore = await stored(w.b)
    await carryAndPlace(w.b, { kind: 'tab', tabId: 'lt' }, false)
    await ws().finishEdit()

    await undoStore().undo()
    expect(tabIds(await stored(w.a))).toEqual(tabIds(aBefore))
    expect(tabIds(await stored(w.b))).toEqual(tabIds(bBefore))
    expect(await ownerOf(w.list)).toEqual({ layoutId: w.a })
    expect(undoStore().redoStack).toHaveLength(1)

    await undoStore().redo()
    expect(tabIds(await stored(w.a))).toEqual(['nt'])
    expect(tabIds(await stored(w.b))).toEqual(['bt', 'lt'])
    expect(await ownerOf(w.list)).toEqual({ layoutId: w.b })
    expect(await ranksOf(w.list)).toEqual([[1, 1], [2, 2]])
  })

  it('undo works after switching to the source layout', async () => {
    const w = await world()
    await carryAndPlace(w.b, { kind: 'tab', tabId: 'lt' }, false)
    await ws().finishEdit()
    await ws().load(w.a)
    expect(ws().activeLayoutId).toBe(w.a)

    await undoStore().undo()
    expect(tabIds(await stored(w.a))).toContain('lt')
    expect(tabIds(await stored(w.b))).toEqual(['bt'])
    expect(await ownerOf(w.list)).toEqual({ layoutId: w.a })
    expect(tabIds(ws().working!)).toContain('lt')
  })

  it('a list the source keeps through another tab is copied, not handed over', async () => {
    const w = await world()
    await db.layouts.update(w.a, row('A', grid([[cell('ka', [listTab('lt', w.list), listTab('lt2', w.list)]), cell('kn', [createTab('notes', 'nt')])]], { prefix: 'A-' })))
    await ws().load(w.b)
    await ws().load(w.a)
    await carryAndPlace(w.b, { kind: 'tab', tabId: 'lt' }, false)
    await ws().finishEdit()
    const a = await stored(w.a)
    const b = await stored(w.b)
    expect(layoutListRefs(a)).toEqual(new Set([w.list]))
    const copied = [...layoutListRefs(b)]
    expect(copied).toHaveLength(1)
    expect(copied[0]).not.toBe(w.list)
    expect(await ownerOf(w.list)).toEqual({ layoutId: w.a })
    expect(await ownerOf(copied[0]!)).toEqual({ layoutId: w.b })
  })

  it('a Number in the source following the list keeps it: the target gets a copy', async () => {
    const w = await world()
    await db.layouts.update(w.a, row('A', grid([[cell('ka', [listTab('lt', w.list)]), cell('kn', [follower('fn', w.list)])]], { prefix: 'A-' })))
    await ws().load(w.b)
    await ws().load(w.a)
    await carryAndPlace(w.b, { kind: 'tab', tabId: 'lt' }, false)
    await ws().finishEdit()
    const a = await stored(w.a)
    const b = await stored(w.b)
    expect(layoutListRefs(a)).toEqual(new Set([w.list]))
    expect(await ownerOf(w.list)).toEqual({ layoutId: w.a })
    const [copyId] = [...layoutListRefs(b)]
    expect(copyId).not.toBe(w.list)
    expect(await ownerOf(copyId!)).toEqual({ layoutId: w.b })
  })

  it('a whole cell moves with all its tabs and its active tab', async () => {
    const w = await world()
    await db.layouts.update(w.a, row('A', grid([[cell('ka', [createTab('notes', 'n1'), createTab('notes', 'n2')], { activeTabId: 'n2' }), cell('kn', [createTab('notes', 'nt')])]], { prefix: 'A-' })))
    await ws().load(w.b)
    await ws().load(w.a)
    await carryAndPlace(w.b, { kind: 'cell', cellId: 'ka' }, false)
    expect(ws().editing?.incoming?.activeTabId).toBe('n2')
    await ws().finishEdit()
    const b = await stored(w.b)
    const placed = b.cells.find((c) => c.tabs.some((t) => t.id === 'n1'))
    expect(placed?.tabs.map((t) => t.id)).toEqual(['n1', 'n2'])
    expect(placed?.activeTabId).toBe('n2')
    const a = await stored(w.a)
    expect(tabIds(a)).toEqual(['nt'])
  })

  it('a carried tab whose id the target already uses lands under a new id', async () => {
    const w = await world()
    await db.layouts.update(w.b, row('B', single(cell('kb', [createTab('notes', 'nt')]), { prefix: 'B-' })))
    await ws().load(w.b)
    await ws().load(w.a)
    await carryAndPlace(w.b, { kind: 'tab', tabId: 'nt' }, false)
    const landed = ws().editing?.incoming?.tabs[0]
    expect(landed?.id).not.toBe('nt')
    await ws().finishEdit()
    const b = await stored(w.b)
    expect(tabIds(b)).toHaveLength(2)
    expect(new Set(tabIds(b)).size).toBe(2)
    expect(tabIds(await stored(w.a))).not.toContain('nt')
  })
})

describe('Copy to layout', () => {
  it('leaves the source alone and gives the target a new list with the same definition and manual order', async () => {
    const w = await world()
    const aBefore = await stored(w.a)
    await carryAndPlace(w.b, { kind: 'tab', tabId: 'lt' }, true)
    await ws().finishEdit()
    expect(undoNames()).toEqual(['Copied “Inbox” to “B”'])
    expect(await stored(w.a)).toEqual(expect.objectContaining({ cells: aBefore.cells }))
    const b = await stored(w.b)
    const [copyId] = [...layoutListRefs(b)]
    expect(copyId).toBeDefined()
    expect(copyId).not.toBe(w.list)
    const copy = await db.listDefinitions.get(copyId!)
    expect(copy).toMatchObject({ name: 'Inbox', sort: 'manual', grouping: 'none', owner: { layoutId: w.b } })
    expect(await ranksOf(copyId!)).toEqual([[1, 1], [2, 2]])
    expect(await ownerOf(w.list)).toEqual({ layoutId: w.a })
    expect(useListDefinitionStore.getState().listDefinitions.some((d) => d.id === copyId)).toBe(true)
  })

  it('undo deletes the copy; redo puts it back with the same id and order', async () => {
    const w = await world()
    await carryAndPlace(w.b, { kind: 'tab', tabId: 'lt' }, true)
    await ws().finishEdit()
    const [copyId] = [...layoutListRefs(await stored(w.b))]

    await undoStore().undo()
    expect(await db.listDefinitions.get(copyId!)).toBeUndefined()
    expect(await ranksOf(copyId!)).toEqual([])
    expect(tabIds(await stored(w.b))).toEqual(['bt'])
    expect(tabIds(await stored(w.a))).toContain('lt')

    await undoStore().redo()
    expect(tabIds(await stored(w.b))).toEqual(['bt', 'lt'])
    expect((await db.listDefinitions.get(copyId!))?.owner).toEqual({ layoutId: w.b })
    expect(await ranksOf(copyId!)).toEqual([[1, 1], [2, 2]])
    expect(tabIds(await stored(w.a))).toContain('lt')
  })
})

describe('while carrying', () => {
  it('Cancel goes back to the source and writes nothing', async () => {
    const w = await world()
    const aBefore = await stored(w.a)
    const bBefore = await stored(w.b)
    await carryAndPlace(w.b, { kind: 'tab', tabId: 'lt' }, false)
    ws().cancelEdit()
    await waitUntil(() => ws().activeLayoutId === w.a)
    expect(ws().editing).toBeNull()
    expect(ws().activeLayoutId).toBe(w.a)
    const body = (l: Awaited<ReturnType<typeof stored>>) => ({ cells: l.cells, grid: l.grid, modifiedAt: l.modifiedAt })
    expect(body(await stored(w.a))).toEqual(body(aBefore))
    expect(body(await stored(w.b))).toEqual(body(bBefore))
    expect(await ownerOf(w.list)).toEqual({ layoutId: w.a })
    expect(undoNames()).toEqual([])
  })

  it('moving to a new layout makes it, and Cancel deletes it again', async () => {
    const w = await world()
    expect(await ws().transferTo({ newName: 'C' }, { kind: 'tab', tabId: 'nt' }, false)).toBe(true)
    const cId = ws().activeLayoutId!
    expect(cId).not.toBe(w.a)
    expect(ws().layouts.find((l) => l.id === cId)?.name).toBe('C')
    expect(ws().editing?.incoming?.madeLayout).toBe(true)
    ws().cancelEdit()
    await waitUntil(() => ws().activeLayoutId === w.a && !ws().layouts.some((l) => l.id === cId))
    expect(await db.layouts.get(cId)).toBeUndefined()
    expect(tabIds(await stored(w.a))).toContain('nt')
  })

  it('moving to a new layout and placing it works end to end', async () => {
    const w = await world()
    await ws().transferTo({ newName: 'C' }, { kind: 'tab', tabId: 'nt' }, false)
    const cId = ws().activeLayoutId!
    expect(ws().placeIncoming({ kind: 'bottom' })).toBe(true)
    expect(await ws().finishEdit()).toBe(true)
    expect(tabIds(await stored(cId))).toEqual(['nt'])
    expect(tabIds(await stored(w.a))).toEqual(['lt'])
    expect(undoNames()).toEqual(['Moved “Notes” to “C”'])
  })

  it('a tap on a slot places the widget there', async () => {
    const w = await world()
    await db.layouts.update(w.b, row('B', grid([[cell('kb', [createTab('notes', 'bt')]), cell('slot')]], { prefix: 'B-' })))
    await ws().load(w.a)
    await ws().load(w.b)
    await ws().load(w.a)
    expect(await ws().transferTo(w.b, { kind: 'tab', tabId: 'nt' }, false)).toBe(true)
    const outcome = ws().tapEdit({ kind: 'slot', cellId: 'slot' })
    expect(outcome).toEqual({ kind: 'place', cellId: 'slot' })
    expect(ws().working?.cells.find((c) => c.id === 'slot')?.tabs.map((t) => t.id)).toEqual(['nt'])
    expect(ws().editing?.selectedCellId).toBe('slot')
  })

  it('a tap on a card joins the widget to it as a tab', async () => {
    const w = await world()
    await ws().transferTo(w.b, { kind: 'tab', tabId: 'nt' }, false)
    expect(ws().tapEdit({ kind: 'card', cellId: 'kb', zone: 'middle' })).toMatchObject({ kind: 'place' })
    expect(ws().working?.cells.find((c) => c.id === 'kb')?.tabs.map((t) => t.id)).toEqual(['bt', 'nt'])
  })

  it('undoing the transfer while the edit mode is on is refused and stays on the stack', async () => {
    const w = await world()
    await carryAndPlace(w.b, { kind: 'tab', tabId: 'lt' }, false)
    await ws().finishEdit()
    expect(await ws().enterEdit()).toBeTruthy()
    await undoStore().undo()
    expect(undoStore().snackbar?.description).toMatch(/^Finish editing the layout to undo: Moved “Inbox” to “B”/)
    expect(undoNames()).toEqual(['Moved “Inbox” to “B”'])
    expect(tabIds(await stored(w.b))).toContain('lt')
  })
})

async function waitUntil(cond: () => boolean) {
  for (let i = 0; i < 50 && !cond(); i++) await new Promise((r) => setTimeout(r, 10))
  expect(cond()).toBe(true)
}
