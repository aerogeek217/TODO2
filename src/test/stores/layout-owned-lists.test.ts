import { describe, it, expect, beforeEach } from 'vitest'
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
import { writeLayoutDraft } from '../../data/draft-storage'
import { resetDb } from '../helpers'
import { grid, single } from '../helpers/layout-builders'

/**
 * A layout's lists live and die with it: an edit that leaves one shown by
 * no tab deletes it at once, in the edit's undo step (Undo brings it back
 * with its tab), Duplicate layout copies the ones it shows (as edited, with
 * their manual order) for the new layout, Delete layout takes them with it
 * — never another layout's or the Eisenhower's.
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
  eisenhower: number
}

/**
 * Layout A (open) shows three lists of its own; layout B shows its own
 * list; the Eisenhower has its list. A's "Mine 1" and B's list have a manual
 * order.
 */
async function world(): Promise<World> {
  const a = await layoutRepository.insert(layoutWith('A', []))
  const b = await layoutRepository.insert(layoutWith('B', []))
  const saved = (await db.listDefinitions.add(def('Saved', { layoutId: a }))) as number
  const mine1 = (await db.listDefinitions.add(def('Mine 1', { layoutId: a }))) as number
  const mine2 = (await db.listDefinitions.add(def('Mine 2', { layoutId: a }))) as number
  const theirs = (await db.listDefinitions.add(def('Theirs', { layoutId: b }))) as number
  const eisenhower = (await db.listDefinitions.add(def('Eisenhower', { eisenhower: true }))) as number
  await db.layouts.update(a, layoutWith('A', [lens('s', saved), lens('m1', mine1), lens('m2', mine2), createTab('eisenhower', 'e')]))
  await db.layouts.update(b, layoutWith('B', [lens('t', theirs)]))
  await db.listOrders.bulkAdd([
    { listDefinitionId: mine1, todoId: 1, rank: 1 },
    { listDefinitionId: mine1, todoId: 2, rank: 2 },
    { listDefinitionId: theirs, todoId: 1, rank: 5 },
  ])
  await layoutRepository.setActiveId(a)
  await Promise.all([useListDefinitionStore.getState().load(), useListOrderStore.getState().load()])
  await ws().init()
  return { a, b, saved, mine1, mine2, theirs, eisenhower }
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
    expect(await storedListIds()).toEqual([w.saved, w.mine2, w.theirs, w.eisenhower])
    expect(storeListIds()).toEqual([w.saved, w.mine2, w.theirs, w.eisenhower])
    expect(await ranksOf(w.mine1)).toEqual([])
    expect(useListOrderStore.getState().ranks.has(w.mine1)).toBe(false)
    // Another layout's list keeps its order.
    expect(await ranksOf(w.theirs)).toEqual([[1, 5]])
    expect(undoNames()).toEqual(['Closed tab “Mine 1”'])
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
    expect(useUndoStore.getState().snackbar?.description).toBe('Open layout “A” to undo: Closed tab “Mine 1”.')
    await ws().load(w.a)
    await undo()
    expect(await storedListIds()).toContain(w.mine1)
    expect(layoutListRefs(ws().working!).has(w.mine1)).toBe(true)
  })

  it('closing two tabs is two steps: Undo brings back one list at a time, each tab at its index', async () => {
    const w = await world()
    ws().closeTab('m1')
    ws().closeTab('m2')
    expect(await storedListIds()).toEqual([w.saved, w.theirs, w.eisenhower])
    await undo()
    expect(ws().working!.cells[0]!.tabs.map((t) => t.id)).toEqual(['s', 'm2', 'e'])
    expect(await storedListIds()).toEqual([w.saved, w.mine2, w.theirs, w.eisenhower])
    await undo()
    const listOf = (t: LayoutTab) => (t.kind === 'lens' ? t.config.listDefinitionId : t.kind)
    expect(ws().working!.cells[0]!.tabs.map(listOf)).toEqual([w.saved, w.mine1, w.mine2, 'eisenhower'])
  })

  it('a whole cell closed: Undo brings back its lists and the cell as it was', async () => {
    const w = await world()
    const A = ws().working!
    const kt = { id: 'kt', tabs: [createTab('notes', 'nt')], activeTabId: 'nt' }
    await db.layouts.put({ ...A, ...grid([[kt], [A.cells[0]!]], { prefix: 'A-' }) })
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
    await ws().init()
    ws().closeCell('k-A')
    expect(await storedListIds()).toEqual([w.theirs, w.eisenhower])
    expect(undoNames().at(-1)).toBe('Closed cell (4 tabs)')
    await undo()
    expect(await storedListIds()).toEqual([w.saved, w.mine1, w.mine2, w.theirs, w.eisenhower])
    expect(ws().working!.cells.map((c) => c.id)).toEqual(['kt', 'k-A'])
  })

  it('Undo once the layout is gone brings nothing back, and says so', async () => {
    const w = await world()
    ws().closeTab('m1')
    await settled()
    await ws().delete(w.a)
    await undo()
    expect(await storedListIds()).not.toContain(w.mine1)
    expect(useUndoStore.getState().snackbar?.description).toBe('Can’t undo: Closed tab “Mine 1” — its layout is gone.')
  })

  it('Change list away from one deletes it too; Undo brings it back under the tab', async () => {
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
    expect(await storedListIds()).toEqual([w.saved, w.mine1, w.mine2, w.theirs, w.eisenhower])
    expect(storeListIds()).not.toContain(fresh)
    await redo()
    expect(await storedListIds()).toContain(fresh)
    expect(await ranksOf(fresh)).toEqual([[1, 1]])
    expect(ws().working!.cells[0]!.tabs.map((t) => t.id)).toContain(tabId)
  })

  it('never touches the Eisenhower’s list or another layout’s, though no tab of this layout shows them', async () => {
    const w = await world()
    ws().closeTab('e')
    expect(await storedListIds()).toEqual([w.saved, w.mine1, w.mine2, w.theirs, w.eisenhower])
  })
})

describe('a layout shows only its own lists', () => {
  const tabsOf = () => ws().working!.cells.flatMap((k) => k.tabs)
  const steps = () => useUndoStore.getState().undoStack.length

  it('a new tab on another layout’s or the Eisenhower’s list is refused; on its own, added', async () => {
    const w = await world()
    for (const id of [w.theirs, w.eisenhower]) {
      expect(ws().addWidget('lens', { kind: 'cell', cellId: 'k-A' }, { listDefinitionId: id })).toBeNull()
    }
    expect(steps()).toBe(0)
    expect(layoutListRefs(ws().working!)).toEqual(new Set([w.saved, w.mine1, w.mine2]))
    const tabId = ws().addWidget('lens', { kind: 'cell', cellId: 'k-A' }, { listDefinitionId: w.mine1 })
    expect(tabId).not.toBeNull()
    expect(steps()).toBe(1)
    await settled()
  })

  it('Change list to another layout’s list changes nothing; to its own, it switches', async () => {
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
  /** A reload: the stores start afresh and the workspace opens again (applying an older build's kept draft). */
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
    expect(await storedListIds()).toEqual([w.saved, w.mine1, w.mine2, w.theirs, w.eisenhower])
    expect(storeListIds()).not.toContain(unshown)
  })

  it('a kept draft that shows a list made for it is applied with it', async () => {
    const w = await world()
    const kept = await useListDefinitionStore.getState().add({ name: 'Kept', owner: { layoutId: w.a } })
    const base = layoutBodyOf(await stored(w.a))
    writeLayoutDraft({
      kind: 'saved',
      layoutId: w.a,
      base,
      body: layoutBodyOf(layoutWith('A', [lens('s', w.saved), lens('m1', w.mine1), lens('m2', w.mine2), createTab('eisenhower', 'e'), lens('k', kept)])),
    })
    await reload()
    expect(layoutListRefs(ws().working!).has(kept)).toBe(true)
    expect(layoutListRefs(await stored(w.a)).has(kept)).toBe(true)
    expect(await storedListIds()).toContain(kept)
  })

  it('a kept new layout (an older build’s) that shows a list is not taken back (every list is a stored layout’s), and says so', async () => {
    const w = await world()
    writeLayoutDraft({ kind: 'new', name: 'Untitled layout', body: layoutBodyOf(layoutWith('N', [lens('n', w.theirs)])) })
    await reload()
    expect(ws().saved?.id).toBe(w.a)
    expect(await db.layouts.count()).toBe(2)
    expect(useUndoStore.getState().snackbar?.description).toBe('The unsaved new layout “Untitled layout” was dropped: a layout shows only its own lists, and it wasn’t stored yet.')
  })

  it('a kept new layout that shows no list is stored and opened', async () => {
    const w = await world()
    writeLayoutDraft({ kind: 'new', name: 'Plain', body: layoutBodyOf(layoutWith('N', [createTab('notes', 'n')])) })
    await reload()
    expect(ws().working?.name).toBe('Plain')
    expect(ws().saved?.id).not.toBe(w.a)
    expect(await db.layouts.count()).toBe(3)
  })

  it('a kept draft made before its layout got copies of the lists it shared (an upgrade) is applied on the copies', async () => {
    const w = await world()
    // The draft (made at v67) adds a notes tab; B showed A's "Mine 1" then, and the upgrade gave B a copy.
    const base = layoutBodyOf(layoutWith('B', [lens('t', w.theirs), lens('m1b', w.mine1)]))
    const body = layoutBodyOf(layoutWith('B', [lens('t', w.theirs), lens('m1b', w.mine1), createTab('notes', 'nb')]))
    const copy = (await db.listDefinitions.add(def('Mine 1', { layoutId: w.b }))) as number
    await db.layouts.update(w.b, layoutWith('B', [lens('t', w.theirs), lens('m1b', copy)]))
    writeLayoutDraft({ kind: 'saved', layoutId: w.b, base, body })
    await layoutRepository.setActiveId(w.b)
    await reload()
    expect(ws().saved?.id).toBe(w.b)
    expect([...layoutListRefs(ws().working!)].sort((x, y) => x - y)).toEqual([w.theirs, copy].sort((x, y) => x - y))
    expect(ws().working!.cells[0]!.tabs.map((t) => t.id)).toEqual(['t', 'm1b', 'nb'])
    expect((await stored(w.b)).cells[0]!.tabs.map((t) => t.id)).toEqual(['t', 'm1b', 'nb'])
  })

  it('a kept draft that shows another layout’s list is dropped, and says so', async () => {
    const w = await world()
    const base = layoutBodyOf(layoutWith('B', [lens('t', w.theirs)]))
    writeLayoutDraft({ kind: 'saved', layoutId: w.b, base, body: layoutBodyOf(layoutWith('B', [lens('t', w.theirs), lens('x', w.mine1)])) })
    await layoutRepository.setActiveId(w.b)
    await reload()
    expect(ws().saved?.id).toBe(w.b)
    expect(layoutListRefs(ws().working!)).toEqual(new Set([w.theirs]))
    expect(useUndoStore.getState().snackbar?.description).toBe('Unsaved changes to layout “B” were dropped: they showed another layout’s list.')
  })

  it('a kept draft of another layout than the one opening is dropped, and so are the lists only it showed', async () => {
    const w = await world()
    const fresh = await useListDefinitionStore.getState().add({ name: 'Fresh', owner: { layoutId: w.a } })
    const base = layoutBodyOf(await stored(w.a))
    writeLayoutDraft({ kind: 'saved', layoutId: w.a, base, body: layoutBodyOf(layoutWith('A', [lens('s', w.saved), lens('f', fresh)])) })
    // Layout B was opened elsewhere since.
    await layoutRepository.setActiveId(w.b)
    await reload()
    expect(ws().activeLayoutId).toBe(w.b)
    expect(await storedListIds()).not.toContain(fresh)
    expect(await storedListIds()).toContain(w.mine1)
  })

  it('a kept draft that no longer matches the stored layout is forgotten, and so are the lists only it showed', async () => {
    const w = await world()
    const fresh = await useListDefinitionStore.getState().add({ name: 'Fresh', owner: { layoutId: w.a } })
    const base = layoutBodyOf(await stored(w.a))
    writeLayoutDraft({ kind: 'saved', layoutId: w.a, base, body: layoutBodyOf(layoutWith('A', [lens('s', w.saved), lens('f', fresh)])) })
    // The stored layout changed meanwhile (e.g. saved from another tab).
    await db.layouts.update(w.a, layoutWith('A', [lens('s', w.saved), lens('m1', w.mine1)]))
    await reload()
    expect(undoNames()).toEqual([])
    expect(await storedListIds()).toEqual([w.saved, w.mine1, w.theirs, w.eisenhower])
  })
})

describe('a list of the layout another layout names (data edited by hand)', () => {
  it('Delete layout hands it to the other layout instead of deleting it under that layout’s tab', async () => {
    const w = await world()
    await db.layouts.update(w.b, layoutWith('B', [lens('t', w.theirs), lens('m1b', w.mine1)]))
    expect(await ws().delete(w.a)).toBe(true)
    expect(await storedListIds()).toEqual([w.mine1, w.theirs, w.eisenhower])
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
  it('deletes the open layout’s own lists and their manual order; never another layout’s or the Eisenhower’s', async () => {
    const w = await world()
    expect(await ws().delete(w.a)).toBe(true)
    expect(await storedListIds()).toEqual([w.theirs, w.eisenhower])
    expect(storeListIds()).toEqual([w.theirs, w.eisenhower])
    expect(await ranksOf(w.mine1)).toEqual([])
    expect(ws().activeLayoutId).toBe(w.b)
  })

  it('another layout: its own lists go, the open layout’s stay', async () => {
    const w = await world()
    expect(await ws().delete(w.b)).toBe(true)
    expect(await storedListIds()).toEqual([w.saved, w.mine1, w.mine2, w.eisenhower])
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
