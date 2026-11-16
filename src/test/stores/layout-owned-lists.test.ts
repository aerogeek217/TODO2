import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import { createTab, layoutBodyOf, type LayoutTab, type PersistedWorkspaceLayout, type WorkspaceLayout } from '../../models/workspace-layout'
import { emptyPredicate } from '../../models/filter-predicate'
import type { ListDefinition, ListOwner, PersistedListDefinition } from '../../models/list-definition'
import { settleLayoutWrites, useWorkspaceStore } from '../../stores/workspace-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListDraftStore } from '../../stores/list-draft-store'
import { useListOrderStore } from '../../stores/list-order-store'
import { useUndoStore } from '../../stores/undo-store'
import { layoutListRefs } from '../../utils/workspace-layout-lists'
import { resetDb } from '../helpers'
import { grid, single } from '../helpers/layout-builders'

/**
 * A layout's lists live and die with it: an edit that leaves one shown by
 * no tab deletes it at once, in the edit's undo step (Undo brings it back
 * with its tab), Duplicate layout copies the ones it shows (as edited, with
 * their manual order) for the new layout, Delete layout takes them with it
 * — never another layout's.
 */

const T0 = new Date('2026-09-01T09:00:00.000Z')
const ws = () => useWorkspaceStore.getState()

const lens = (id: string, listDefinitionId: number): LayoutTab => createTab('lens', id, { listDefinitionId })

function layoutWith(name: string, tabs: LayoutTab[]): Omit<WorkspaceLayout, 'id' | 'sortOrder'> {
  return { name, createdAt: T0, modifiedAt: T0, ...single({ id: `k-${name}`, tabs }, { prefix: `${name}-` }) }
}

function def(name: string, owner?: ListOwner, extra: Partial<ListDefinition> = {}): Omit<ListDefinition, 'id'> {
  return { name, sortOrder: 0, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() }, ...(owner ? { owner } : {}), ...extra }
}

interface World {
  a: number
  b: number
  /** Another list of A's. */
  saved: number
  mine1: number
  mine2: number
  theirs: number
}

/**
 * Layout A (open) shows three lists of its own; layout B shows its own
 * list. A's "Mine 1" and B's list have a manual order.
 */
async function world(): Promise<World> {
  const a = await layoutRepository.insert(layoutWith('A', []))
  const b = await layoutRepository.insert(layoutWith('B', []))
  const saved = (await db.listDefinitions.add(def('Saved', { layoutId: a }))) as number
  const mine1 = (await db.listDefinitions.add(def('Mine 1', { layoutId: a }))) as number
  const mine2 = (await db.listDefinitions.add(def('Mine 2', { layoutId: a }))) as number
  const theirs = (await db.listDefinitions.add(def('Theirs', { layoutId: b }))) as number
  await db.layouts.update(a, layoutWith('A', [lens('s', saved), lens('m1', mine1), lens('m2', mine2), createTab('notes', 'e')]))
  await db.layouts.update(b, layoutWith('B', [lens('t', theirs)]))
  await db.listOrders.bulkAdd([
    { listDefinitionId: mine1, todoId: 1, rank: 1 },
    { listDefinitionId: mine1, todoId: 2, rank: 2 },
    { listDefinitionId: theirs, todoId: 1, rank: 5 },
  ])
  await layoutRepository.setActiveId(a)
  await Promise.all([useListDefinitionStore.getState().load(), useListOrderStore.getState().load()])
  await ws().init()
  return { a, b, saved, mine1, mine2, theirs }
}

const settled = () => settleLayoutWrites()
const storedListIds = async () => {
  await settled()
  return (await db.listDefinitions.toArray()).map((d) => d.id).sort((x, y) => x! - y!)
}
const storeListIds = () => useListDefinitionStore.getState().listDefinitions.map((d) => d.id).sort((x, y) => x - y)
const ranksOf = async (listId: number) => (await db.listOrders.where('listDefinitionId').equals(listId).toArray()).map((r) => [r.todoId, r.rank])
const undoNames = () => useUndoStore.getState().undoStack.map((e) => e.description)
const undo = () => useUndoStore.getState().undo()
const redo = () => useUndoStore.getState().redo()
async function stored(id: number): Promise<PersistedWorkspaceLayout> {
  await settled()
  return (await db.layouts.get(id)) as PersistedWorkspaceLayout
}

beforeEach(async () => {
  await resetDb()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useListDefinitionStore.setState({ listDefinitions: [], loaded: false })
  useListOrderStore.setState({ ranks: new Map(), loaded: false })
  useListDraftStore.setState({ drafts: {} })
})

describe('an edit that leaves a list shown by no tab', () => {
  it('deletes it at once — with its manual order — and nothing else', async () => {
    const w = await world()
    ws().closeTab('m1')
    expect(await storedListIds()).toEqual([w.saved, w.mine2, w.theirs])
    expect(storeListIds()).toEqual([w.saved, w.mine2, w.theirs])
    expect(await ranksOf(w.mine1)).toEqual([])
    expect(useListOrderStore.getState().ranks.has(w.mine1)).toBe(false)
    // Another layout's list keeps its order.
    expect(await ranksOf(w.theirs)).toEqual([[1, 5]])
    expect(undoNames()).toEqual(['Removed “Mine 1”'])
  })

  it('Undo brings the list back — the layout’s, with its manual order — and its tab where it was; Redo removes both again', async () => {
    const w = await world()
    ws().closeTab('m1')
    expect(await storedListIds()).not.toContain(w.mine1)
    await undo()
    const back = await db.listDefinitions.get(w.mine1)
    expect(back?.name).toBe('Mine 1')
    expect(back?.owner).toEqual({ layoutId: w.a })
    expect(await ranksOf(w.mine1)).toEqual([[1, 1], [2, 2]])
    expect(useListDefinitionStore.getState().listDefinitions.some((d) => d.id === w.mine1)).toBe(true)
    expect(ws().working!.cells[0]!.tabs.map((t) => t.id)).toEqual(['s', 'm1', 'm2', 'e'])
    expect(layoutListRefs(await stored(w.a)).has(w.mine1)).toBe(true)
    await redo()
    expect(await storedListIds()).not.toContain(w.mine1)
    expect(storeListIds()).not.toContain(w.mine1)
    expect(layoutListRefs(ws().working!).has(w.mine1)).toBe(false)
    expect(layoutListRefs(await stored(w.a)).has(w.mine1)).toBe(false)
  })

  it('a list Undo brought back survives a page load', async () => {
    const w = await world()
    ws().closeTab('m1')
    await undo()
    await settled()
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
    await useListDefinitionStore.getState().load()
    await ws().init()
    expect(await storedListIds()).toContain(w.mine1)
    expect(layoutListRefs(ws().working!).has(w.mine1)).toBe(true)
  })

  it('Undo while another layout is open brings nothing back and says to open the layout; it stays on the stack', async () => {
    const w = await world()
    ws().closeTab('m1')
    await settled()
    await ws().load(w.b)
    await undo()
    expect(await storedListIds()).not.toContain(w.mine1)
    expect(useUndoStore.getState().snackbar?.description).toBe('Open layout “A” to undo: Removed “Mine 1”.')
    await ws().load(w.a)
    await undo()
    expect(await storedListIds()).toContain(w.mine1)
    expect(layoutListRefs(ws().working!).has(w.mine1)).toBe(true)
  })

  it('closing two tabs is two steps: Undo brings back one list at a time, each tab at its index', async () => {
    const w = await world()
    ws().closeTab('m1')
    ws().closeTab('m2')
    expect(await storedListIds()).toEqual([w.saved, w.theirs])
    await undo()
    expect(ws().working!.cells[0]!.tabs.map((t) => t.id)).toEqual(['s', 'm2', 'e'])
    expect(await storedListIds()).toEqual([w.saved, w.mine2, w.theirs])
    await undo()
    const listOf = (t: LayoutTab) => (t.kind === 'lens' ? t.config.listDefinitionId : t.kind)
    expect(ws().working!.cells[0]!.tabs.map(listOf)).toEqual([w.saved, w.mine1, w.mine2, 'notes'])
  })

  it('a whole cell closed: Undo brings back its lists and the cell as it was', async () => {
    const w = await world()
    const A = ws().working!
    const kt = { id: 'kt', tabs: [createTab('notes', 'nt')], activeTabId: 'nt' }
    await db.layouts.put({ ...A, ...grid([[kt], [A.cells[0]!]], { prefix: 'A-' }) })
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
    await ws().init()
    ws().closeCell('k-A')
    expect(await storedListIds()).toEqual([w.theirs])
    expect(undoNames().at(-1)).toBe('Closed cell (4 tabs)')
    await undo()
    expect(await storedListIds()).toEqual([w.saved, w.mine1, w.mine2, w.theirs])
    expect(ws().working!.cells.map((c) => c.id)).toEqual(['kt', 'k-A'])
  })

  it('Undo once the layout is gone brings nothing back, and says so', async () => {
    const w = await world()
    ws().closeTab('m1')
    await settled()
    await ws().delete(w.a)
    await undo()
    expect(await storedListIds()).not.toContain(w.mine1)
    expect(useUndoStore.getState().snackbar?.description).toBe('Can’t undo: Removed “Mine 1” — its layout is gone.')
  })

  it('a tab re-pointed away from one (patchTabConfig) deletes it too; Undo brings it back under the tab', async () => {
    const w = await world()
    ws().patchTabConfig('m2', 'lens', { listDefinitionId: w.saved })
    expect(await storedListIds()).not.toContain(w.mine2)
    expect(await storedListIds()).toContain(w.mine1)
    await undo()
    expect(await storedListIds()).toContain(w.mine2)
    expect(ws().working!.cells[0]!.tabs.find((t) => t.id === 'm2')?.config).toEqual({ listDefinitionId: w.mine2 })
  })

  it('Undo of adding a list tab deletes the list made for it; Redo brings both back', async () => {
    const w = await world()
    const fresh = await useListDefinitionStore.getState().add({ name: 'New here', owner: { layoutId: w.a } })
    await db.listOrders.add({ listDefinitionId: fresh, todoId: 1, rank: 1 })
    await useListOrderStore.getState().load()
    const tabId = ws().addWidget('lens', { kind: 'cell', cellId: 'k-A' }, { listDefinitionId: fresh })!
    expect(undoNames().at(-1)).toBe('Added “New here”')
    await undo()
    expect(await storedListIds()).toEqual([w.saved, w.mine1, w.mine2, w.theirs])
    expect(storeListIds()).not.toContain(fresh)
    await redo()
    expect(await storedListIds()).toContain(fresh)
    expect(await ranksOf(fresh)).toEqual([[1, 1]])
    expect(ws().working!.cells[0]!.tabs.map((t) => t.id)).toContain(tabId)
  })

  it('never touches another layout’s list, though no tab of this layout shows them', async () => {
    const w = await world()
    ws().closeTab('e')
    expect(await storedListIds()).toEqual([w.saved, w.mine1, w.mine2, w.theirs])
  })
})

describe('a layout write that fails, then Undo: the list comes back (cr34 M6 / D2)', () => {
  /** The next layout write fails (storage full); the ones after it land. */
  function failNextWrite(): void {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(layoutRepository, 'putAndPrune').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'))
  }
  const tabIds = () => ws().working!.cells.flatMap((c) => c.tabs.map((t) => t.id))
  /** List `id` is stored as it was — the layout's, with its manual order — and in the stores. */
  async function expectMine1Back(w: World): Promise<void> {
    await settled()
    const back = await db.listDefinitions.get(w.mine1)
    expect(back?.name).toBe('Mine 1')
    expect(back?.owner).toEqual({ layoutId: w.a })
    expect(await ranksOf(w.mine1)).toEqual([[1, 1], [2, 2]])
    expect(storeListIds()).toContain(w.mine1)
    expect(useListOrderStore.getState().ranks.get(w.mine1)?.size).toBe(2)
  }

  afterEach(() => { vi.restoreAllMocks() })

  it('the failed write deletes nothing: the list stays stored until a write lands', async () => {
    const w = await world()
    failNextWrite()
    ws().closeTab('m1')
    await settled()
    expect(ws().writeFailed).toBe(true)
    expect(tabIds()).toEqual(['s', 'm2', 'e'])
    expect(await storedListIds()).toContain(w.mine1)
    // Undo before any write lands: the tab is back, its list was never gone.
    await undo()
    expect(tabIds()).toEqual(['s', 'm1', 'm2', 'e'])
    await expectMine1Back(w)
    expect(ws().writeFailed).toBe(false)
  })

  it('Retry lands and deletes the list; Undo of the closed tab brings back the tab and its list; Redo removes both', async () => {
    const w = await world()
    failNextWrite()
    ws().closeTab('m1')
    await settled()
    expect(await ws().retryWrite()).toBe(true)
    expect(await storedListIds()).toEqual([w.saved, w.mine2, w.theirs])
    expect(storeListIds()).not.toContain(w.mine1)
    await undo()
    expect(tabIds()).toEqual(['s', 'm1', 'm2', 'e'])
    await expectMine1Back(w)
    expect(layoutListRefs(await stored(w.a)).has(w.mine1)).toBe(true)
    await redo()
    expect(await storedListIds()).toEqual([w.saved, w.mine2, w.theirs])
    expect(tabIds()).toEqual(['s', 'm2', 'e'])
    await undo()
    await expectMine1Back(w)
  })

  it('a later edit lands and deletes the list; undoing both steps brings back the tab and its list', async () => {
    const w = await world()
    failNextWrite()
    ws().closeTab('m1')
    await settled()
    ws().splitCell('k-A', 'right')
    expect(await storedListIds()).toEqual([w.saved, w.mine2, w.theirs])
    expect(ws().writeFailed).toBe(false)
    expect(undoNames()).toEqual(['Removed “Mine 1”', 'Split cell'])
    // The split's undo: the list isn't its to bring back (its tab is still closed).
    await undo()
    expect(tabIds()).toEqual(['s', 'm2', 'e'])
    expect(await storedListIds()).toEqual([w.saved, w.mine2, w.theirs])
    await undo()
    expect(tabIds()).toEqual(['s', 'm1', 'm2', 'e'])
    await expectMine1Back(w)
    // And forward again: each step removes what it removed.
    await redo()
    await redo()
    expect(await storedListIds()).toEqual([w.saved, w.mine2, w.theirs])
    await undo()
    await undo()
    await expectMine1Back(w)
  })

  it('a later edit that closes another list: each Undo brings back its own list', async () => {
    const w = await world()
    failNextWrite()
    ws().closeTab('m1')
    await settled()
    ws().closeTab('m2')
    expect(await storedListIds()).toEqual([w.saved, w.theirs])
    await undo()
    expect(tabIds()).toEqual(['s', 'm2', 'e'])
    expect(await storedListIds()).toEqual([w.saved, w.mine2, w.theirs])
    await undo()
    expect(tabIds()).toEqual(['s', 'm1', 'm2', 'e'])
    expect(await storedListIds()).toEqual([w.saved, w.mine1, w.mine2, w.theirs])
    await expectMine1Back(w)
  })

  it('leaving the layout writes it (the list goes); back on it, Undo brings the list back', async () => {
    const w = await world()
    failNextWrite()
    ws().closeTab('m1')
    await settled()
    await ws().load(w.b)
    expect(ws().activeLayoutId).toBe(w.b)
    expect(await storedListIds()).not.toContain(w.mine1)
    await ws().load(w.a)
    await undo()
    expect(tabIds()).toEqual(['s', 'm1', 'm2', 'e'])
    await expectMine1Back(w)
  })

  it('a Redo whose write fails: once a write lands, Undo still brings the list back', async () => {
    const w = await world()
    ws().closeTab('m1')
    await settled()
    await undo()
    await settled()
    failNextWrite()
    await redo()
    await settled()
    expect(ws().writeFailed).toBe(true)
    expect(await storedListIds()).toContain(w.mine1)
    expect(await ws().retryWrite()).toBe(true)
    expect(await storedListIds()).not.toContain(w.mine1)
    await undo()
    expect(tabIds()).toEqual(['s', 'm1', 'm2', 'e'])
    await expectMine1Back(w)
  })

  it('an Undo whose write fails (of an added list tab): once a write lands, Redo brings the tab back with its list', async () => {
    const w = await world()
    const fresh = await useListDefinitionStore.getState().add({ name: 'New here', owner: { layoutId: w.a } })
    const tabId = ws().addWidget('lens', { kind: 'cell', cellId: 'k-A' }, { listDefinitionId: fresh })!
    await settled()
    failNextWrite()
    await undo()
    await settled()
    expect(ws().writeFailed).toBe(true)
    expect(tabIds()).not.toContain(tabId)
    expect(await storedListIds()).toContain(fresh)
    expect(await ws().retryWrite()).toBe(true)
    expect(await storedListIds()).not.toContain(fresh)
    await redo()
    expect(tabIds()).toContain(tabId)
    expect(await storedListIds()).toContain(fresh)
    expect(storeListIds()).toContain(fresh)
    expect((await db.listDefinitions.get(fresh))?.name).toBe('New here')
  })
})

describe('a layout shows only its own lists', () => {
  const tabsOf = () => ws().working!.cells.flatMap((k) => k.tabs)
  const steps = () => useUndoStore.getState().undoStack.length

  it('a new tab on another layout’s list is refused; on its own, added', async () => {
    const w = await world()
    expect(ws().addWidget('lens', { kind: 'cell', cellId: 'k-A' }, { listDefinitionId: w.theirs })).toBeNull()
    expect(steps()).toBe(0)
    expect(layoutListRefs(ws().working!)).toEqual(new Set([w.saved, w.mine1, w.mine2]))
    const tabId = ws().addWidget('lens', { kind: 'cell', cellId: 'k-A' }, { listDefinitionId: w.mine1 })
    expect(tabId).not.toBeNull()
    expect(steps()).toBe(1)
    await settled()
  })

  it('a tab re-pointed at another layout’s list changes nothing; at its own, it switches', async () => {
    const w = await world()
    ws().patchTabConfig('s', 'lens', { listDefinitionId: w.theirs })
    expect(tabsOf().find((t) => t.id === 's')?.config).toMatchObject({ listDefinitionId: w.saved })
    expect(steps()).toBe(0)
    ws().patchTabConfig('s', 'lens', { listDefinitionId: w.mine2 })
    expect(tabsOf().find((t) => t.id === 's')?.config).toMatchObject({ listDefinitionId: w.mine2 })
    await settled()
  })

  it('a list that no longer exists is no one’s: a tab may still name it (it shows as deleted)', async () => {
    await world()
    expect(ws().addWidget('lens', { kind: 'cell', cellId: 'k-A' }, { listDefinitionId: 999 })).not.toBeNull()
    await settled()
  })
})

describe('page load', () => {
  /** A reload: the stores start afresh and the workspace opens again. */
  async function reload(): Promise<void> {
    await settled()
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
    await useListDefinitionStore.getState().load()
    await ws().init()
  }

  it('deletes the open layout’s own lists its stored layout doesn’t show (left by edits an older build dropped)', async () => {
    const w = await world()
    const unshown = await useListDefinitionStore.getState().add({ name: 'Unshown', owner: { layoutId: w.a } })
    await reload()
    expect(await storedListIds()).toEqual([w.saved, w.mine1, w.mine2, w.theirs])
    expect(storeListIds()).not.toContain(unshown)
  })
})

describe('a list of the layout another layout names (data edited by hand)', () => {
  it('Delete layout hands it to the other layout instead of deleting it under that layout’s tab', async () => {
    const w = await world()
    await db.layouts.update(w.b, layoutWith('B', [lens('t', w.theirs), lens('m1b', w.mine1)]))
    expect(await ws().delete(w.a)).toBe(true)
    expect(await storedListIds()).toEqual([w.mine1, w.theirs])
    expect((await db.listDefinitions.get(w.mine1))?.owner).toEqual({ layoutId: w.b })
    expect(await ranksOf(w.mine1)).toEqual([[1, 1], [2, 2]])
    expect(useListDefinitionStore.getState().listDefinitions.find((d) => d.id === w.mine1)?.owner).toEqual({ layoutId: w.b })
  })

  it('an edit that no longer shows it hands it to the other layout instead of deleting it', async () => {
    const w = await world()
    await db.layouts.update(w.b, layoutWith('B', [lens('t', w.theirs), lens('m1b', w.mine1)]))
    ws().closeTab('m1')
    await settled()
    expect((await db.listDefinitions.get(w.mine1))?.owner).toEqual({ layoutId: w.b })
    expect(useListDefinitionStore.getState().listDefinitions.find((d) => d.id === w.mine1)?.owner).toEqual({ layoutId: w.b })
  })

  /** Layout A stored with a tab this build can't read (a number id) that shows Mine 2: it opens repaired, without it. */
  async function repairedWorld(): Promise<World> {
    const w = await world()
    const row = await stored(w.a)
    const cell = row.cells[0]!
    await db.layouts.put({ ...row, cells: [{ ...cell, tabs: [...cell.tabs.filter((t) => t.id !== 'm2'), { ...lens('x', w.mine2), id: 7 as unknown as string }] }] })
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
    await ws().init()
    expect(ws().repairedIds.has(w.a)).toBe(true)
    return w
  }

  it('opening a layout the repair changed deletes nothing; its first edit writes the repair, deleting the lists only the dropped parts showed', async () => {
    const w = await repairedWorld()
    expect(await storedListIds()).toContain(w.mine2)
    ws().closeTab('e')
    expect(await storedListIds()).not.toContain(w.mine2)
    expect(ws().repairedIds.has(w.a)).toBe(false)
    // The lists the layout shows stay its own.
    expect((await db.listDefinitions.get(w.mine1))?.owner).toEqual({ layoutId: w.a })
  })

  it('Duplicate layout from a layout the repair changed keeps the lists its stored row still names', async () => {
    const w = await repairedWorld()
    expect(layoutListRefs(ws().working!).has(w.mine2)).toBe(false)
    await ws().duplicateLayout('A copy')
    expect(await storedListIds()).toContain(w.mine2)
  })
})

describe('Duplicate layout', () => {
  it('copies the shown own lists — with their manual order — for the new layout, whose tabs show the copies', async () => {
    const w = await world()
    await useListDefinitionStore.getState().editList(w.mine1, (d) => ({ ...d, name: 'Mine 1 edited', sort: 'deadline' }), 'Edited list')
    const before = layoutBodyOf(await stored(w.a))
    const id = await ws().duplicateLayout('A copy')
    expect(id).not.toBeNull()
    const lists = (await db.listDefinitions.toArray()) as PersistedListDefinition[]
    const copies = lists.filter((d) => d.owner && 'layoutId' in d.owner && d.owner.layoutId === id)
    expect(copies.map((d) => d.name).sort()).toEqual(['Mine 1 edited', 'Mine 2', 'Saved'])
    const copy1 = copies.find((d) => d.name === 'Mine 1 edited')!
    const copy2 = copies.find((d) => d.name === 'Mine 2')!
    const copy0 = copies.find((d) => d.name === 'Saved')!
    expect(copy1.sort).toBe('deadline')
    expect(copy1.id).not.toBe(w.mine1)
    expect(await ranksOf(copy1.id)).toEqual([[1, 1], [2, 2]])
    // The new layout shows the copies, as stored and on screen.
    const refs = layoutListRefs(await stored(id!))
    expect([...refs].sort((x, y) => x - y)).toEqual([copy0.id, copy1.id, copy2.id].sort((x, y) => x - y))
    expect(layoutListRefs(ws().working!)).toEqual(refs)
    expect(storeListIds()).toEqual(expect.arrayContaining([copy1.id, copy2.id]))
    expect(useListOrderStore.getState().ranks.get(copy1.id)?.size).toBe(2)
    // The originals stay with A; A as it was.
    expect(await storedListIds()).toEqual(expect.arrayContaining([w.saved, w.mine1, w.mine2]))
    expect(layoutBodyOf(await stored(w.a))).toEqual(before)
  })

  it('a failed write makes nothing: no layout, no copies', async () => {
    await world()
    const count = await db.listDefinitions.count()
    const insert = layoutRepository.insert
    layoutRepository.insert = () => Promise.reject(new Error('full'))
    try {
      expect(await ws().duplicateLayout('Nope')).toBeNull()
    } finally {
      layoutRepository.insert = insert
    }
    expect(await db.listDefinitions.count()).toBe(count)
    expect(await db.layouts.count()).toBe(2)
    expect(useUndoStore.getState().snackbar?.description).toBe('Couldn\'t duplicate layout "A".')
  })
})

describe('Delete layout', () => {
  it('deletes the open layout’s own lists and their manual order; never another layout’s', async () => {
    const w = await world()
    expect(await ws().delete(w.a)).toBe(true)
    expect(await storedListIds()).toEqual([w.theirs])
    expect(storeListIds()).toEqual([w.theirs])
    expect(await ranksOf(w.mine1)).toEqual([])
    expect(ws().activeLayoutId).toBe(w.b)
  })

  it('another layout: its own lists go, the open layout’s stay', async () => {
    const w = await world()
    expect(await ws().delete(w.b)).toBe(true)
    expect(await storedListIds()).toEqual([w.saved, w.mine1, w.mine2])
    expect(await ranksOf(w.theirs)).toEqual([])
    expect(ws().activeLayoutId).toBe(w.a)
  })

  it('the last layout is never deleted, nor its lists', async () => {
    const w = await world()
    await ws().delete(w.b)
    expect(await ws().delete(w.a)).toBe(false)
    expect(await storedListIds()).toContain(w.mine1)
  })
})
