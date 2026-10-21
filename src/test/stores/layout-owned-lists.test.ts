import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import { createTab, layoutBodyOf, type LayoutTab, type PersistedWorkspaceLayout, type WorkspaceLayout } from '../../models/workspace-layout'
import { emptyPredicate } from '../../models/filter-predicate'
import type { ListDefinition, ListOwner, PersistedListDefinition } from '../../models/list-definition'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { getUnsavedListIds, useListDraftStore } from '../../stores/list-draft-store'
import { useListOrderStore } from '../../stores/list-order-store'
import { useUndoStore } from '../../stores/undo-store'
import { layoutListRefs } from '../../utils/workspace-layout-ops'
import { writeLayoutDraft } from '../../data/draft-storage'
import { resetDb } from '../helpers'

/**
 * A layout's lists live and die with it: a layout Save deletes the ones no
 * saved tab shows (Discard keeps them), Save as copies the ones it shows (as
 * edited, with their manual order) for the new layout, Delete layout takes
 * them with it — never another layout's or the Eisenhower's.
 */

const T0 = new Date('2026-09-01T09:00:00.000Z')
const ws = () => useWorkspaceStore.getState()

const lens = (id: string, listDefinitionId: number): LayoutTab => createTab('lens', id, { listDefinitionId })

function layoutWith(name: string, tabs: LayoutTab[]): Omit<WorkspaceLayout, 'id' | 'sortOrder'> {
  return { name, createdAt: T0, modifiedAt: T0, columns: [{ id: `c-${name}`, weight: 1, cells: [{ id: `k-${name}`, weight: 1, tabs }] }] }
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
  await Promise.all([useListDefinitionStore.getState().load(), useListOrderStore.getState().load(), useListDraftStore.getState().restore()])
  await ws().init()
  return { a, b, saved, mine1, mine2, theirs, eisenhower }
}

const storedListIds = async () => (await db.listDefinitions.toArray()).map((d) => d.id).sort((x, y) => x! - y!)
const storeListIds = () => useListDefinitionStore.getState().listDefinitions.map((d) => d.id).sort((x, y) => x - y)
const ranksOf = async (listId: number) => (await db.listOrders.where('listDefinitionId').equals(listId).toArray()).map((r) => [r.todoId, r.rank])
const editName = (id: number, name: string) => useListDraftStore.getState().edit(id, (d) => ({ ...d, name }))
async function stored(id: number): Promise<PersistedWorkspaceLayout> {
  return (await db.layouts.get(id)) as PersistedWorkspaceLayout
}

beforeEach(async () => {
  await resetDb()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useListDefinitionStore.setState({ listDefinitions: [], loaded: false })
  useListOrderStore.setState({ ranks: new Map(), loaded: false })
  useListDraftStore.setState({ drafts: {} })
})

describe('layout Save', () => {
  it('deletes the layout’s own lists no saved tab shows — with their manual order and unsaved edits — and nothing else', async () => {
    const w = await world()
    editName(w.mine1, 'Mine 1 edited')
    ws().closeTab('m1')
    // Closing the tab alone deletes nothing: it is a layout edit.
    expect(await storedListIds()).toContain(w.mine1)
    expect(await ws().save()).toBe(true)
    expect(await storedListIds()).toEqual([w.saved, w.mine2, w.theirs, w.eisenhower])
    expect(storeListIds()).toEqual([w.saved, w.mine2, w.theirs, w.eisenhower])
    expect(await ranksOf(w.mine1)).toEqual([])
    expect(useListOrderStore.getState().ranks.has(w.mine1)).toBe(false)
    expect(useListDraftStore.getState().drafts[w.mine1]).toBeUndefined()
    // Another layout's list keeps its order.
    expect(await ranksOf(w.theirs)).toEqual([[1, 5]])
  })

  it('says which lists it removed; Undo brings them back as the layout’s lists with their manual order, Redo removes them again', async () => {
    const w = await world()
    ws().closeTab('m1')
    await ws().save()
    expect(await storedListIds()).not.toContain(w.mine1)
    expect(useUndoStore.getState().snackbar?.description).toBe('Removed the list “Mine 1”')
    await useUndoStore.getState().undo()
    const back = await db.listDefinitions.get(w.mine1)
    expect(back?.name).toBe('Mine 1')
    expect(back?.owner).toEqual({ layoutId: w.a })
    expect(await ranksOf(w.mine1)).toEqual([[1, 1], [2, 2]])
    expect(useListDefinitionStore.getState().listDefinitions.some((d) => d.id === w.mine1)).toBe(true)
    // The layout stays as saved (without the tab).
    expect(layoutListRefs(await stored(w.a)).has(w.mine1)).toBe(false)
    await useUndoStore.getState().redo()
    expect(await storedListIds()).not.toContain(w.mine1)
    expect(storeListIds()).not.toContain(w.mine1)
  })

  it('Redo leaves a restored list alone once something shows it', async () => {
    const w = await world()
    ws().closeTab('m1')
    await ws().save()
    await useUndoStore.getState().undo()
    // The layout's list again: shown again in the layout.
    ws().addWidget('lens', { kind: 'cell', cellId: 'k-A' }, { listDefinitionId: w.mine1 })
    await useUndoStore.getState().redo()
    expect(await storedListIds()).toContain(w.mine1)
  })

  it('Undo once the layout is gone brings nothing back, and says so', async () => {
    const w = await world()
    ws().closeTab('m1')
    await ws().save()
    await ws().delete(w.a)
    await useUndoStore.getState().undo()
    expect(await storedListIds()).not.toContain(w.mine1)
    expect(useUndoStore.getState().snackbar?.description).toBe('“Mine 1” can’t come back: its layout is gone.')
  })

  it('Change list away from one is a layout edit too: deleted on Save', async () => {
    const w = await world()
    ws().patchTabConfig('m2', 'lens', { listDefinitionId: w.saved })
    expect(await storedListIds()).toContain(w.mine2)
    await ws().save()
    expect(await storedListIds()).not.toContain(w.mine2)
    expect(await storedListIds()).toContain(w.mine1)
  })

  it('Discard keeps it, and its tab is back', async () => {
    const w = await world()
    ws().closeTab('m1')
    ws().discard()
    expect(await storedListIds()).toContain(w.mine1)
    expect(layoutListRefs(ws().working!).has(w.mine1)).toBe(true)
    // A later Save that shows it keeps it.
    await ws().save()
    expect(await storedListIds()).toContain(w.mine1)
  })

  it('Discard deletes an own list only the dropped edits showed — with its manual order and unsaved edits', async () => {
    const w = await world()
    const fresh = await useListDefinitionStore.getState().add({ name: 'New here', owner: { layoutId: w.a } })
    ws().addWidget('lens', { kind: 'cell', cellId: 'k-A' }, { listDefinitionId: fresh })
    editName(fresh, 'New here edited')
    await db.listOrders.add({ listDefinitionId: fresh, todoId: 1, rank: 1 })
    await useListOrderStore.getState().load()
    ws().closeTab('m1')
    await ws().discard()
    expect(await storedListIds()).toEqual([w.saved, w.mine1, w.mine2, w.theirs, w.eisenhower])
    expect(storeListIds()).toEqual([w.saved, w.mine1, w.mine2, w.theirs, w.eisenhower])
    expect(await ranksOf(fresh)).toEqual([])
    expect(useListOrderStore.getState().ranks.has(fresh)).toBe(false)
    expect(useListDraftStore.getState().drafts[fresh]).toBeUndefined()
    // Nothing asks about it any more.
    expect(getUnsavedListIds()).toEqual([])
  })

  it('never touches the Eisenhower’s list or another layout’s, though no tab of this layout shows them', async () => {
    const w = await world()
    ws().closeTab('e')
    await ws().save()
    expect(await storedListIds()).toEqual([w.saved, w.mine1, w.mine2, w.theirs, w.eisenhower])
  })
})

describe('a layout shows only its own lists', () => {
  const dashboard = (id: string) => createTab('dashboard', id)
  const tabsOf = () => ws().working!.columns.flatMap((c) => c.cells.flatMap((k) => k.tabs))

  it('a new tab on another layout’s or the Eisenhower’s list is refused; on its own, added', async () => {
    const w = await world()
    for (const id of [w.theirs, w.eisenhower]) {
      expect(ws().addWidget('lens', { kind: 'cell', cellId: 'k-A' }, { listDefinitionId: id })).toBeNull()
    }
    expect(ws().isDirty).toBe(false)
    expect(layoutListRefs(ws().working!)).toEqual(new Set([w.saved, w.mine1, w.mine2]))
    const tabId = ws().addWidget('lens', { kind: 'cell', cellId: 'k-A' }, { listDefinitionId: w.mine1 })
    expect(tabId).not.toBeNull()
    expect(ws().isDirty).toBe(true)
  })

  it('Change list to another layout’s list changes nothing; to its own, it switches', async () => {
    const w = await world()
    ws().patchTabConfig('s', 'lens', { listDefinitionId: w.theirs })
    expect(tabsOf().find((t) => t.id === 's')?.config).toMatchObject({ listDefinitionId: w.saved })
    expect(ws().isDirty).toBe(false)
    ws().patchTabConfig('s', 'lens', { listDefinitionId: w.mine2 })
    expect(tabsOf().find((t) => t.id === 's')?.config).toMatchObject({ listDefinitionId: w.mine2 })
  })

  it('a dashboard’s list tiles: another layout’s list is refused, its own added', async () => {
    const w = await world()
    await db.layouts.update(w.a, layoutWith('A', [lens('s', w.saved), dashboard('d')]))
    await ws().init()
    ws().patchTabConfig('d', 'dashboard', { listTiles: [w.saved, w.theirs] })
    expect(tabsOf().find((t) => t.id === 'd')?.config).toMatchObject({ listTiles: [] })
    ws().patchTabConfig('d', 'dashboard', { listTiles: [w.saved] })
    expect(tabsOf().find((t) => t.id === 'd')?.config).toMatchObject({ listTiles: [w.saved] })
  })

  it('a list that no longer exists is no one’s: a tab may still name it (it shows as deleted)', async () => {
    await world()
    expect(ws().addWidget('lens', { kind: 'cell', cellId: 'k-A' }, { listDefinitionId: 999 })).not.toBeNull()
  })
})

describe('page load', () => {
  /** A reload: the stores start afresh and the workspace opens again (taking back the kept draft). */
  async function reload(): Promise<void> {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
    await useListDefinitionStore.getState().load()
    await ws().init()
  }

  it('deletes the open layout’s own lists neither the stored layout nor the kept draft shows', async () => {
    const w = await world()
    const unshown = await useListDefinitionStore.getState().add({ name: 'Unshown', owner: { layoutId: w.a } })
    const kept = await useListDefinitionStore.getState().add({ name: 'Kept', owner: { layoutId: w.a } })
    ws().addWidget('lens', { kind: 'cell', cellId: 'k-A' }, { listDefinitionId: kept })
    await reload()
    expect(layoutListRefs(ws().working!).has(kept)).toBe(true)
    expect(await storedListIds()).toEqual([w.saved, w.mine1, w.mine2, w.theirs, w.eisenhower, kept])
    expect(storeListIds()).not.toContain(unshown)
  })

  it('a kept new layout (an older build’s) that shows a list is not taken back (every list is a stored layout’s), and says so', async () => {
    const w = await world()
    writeLayoutDraft({ kind: 'new', name: 'Untitled layout', body: layoutBodyOf(layoutWith('N', [lens('n', w.theirs)])), listNames: { [w.theirs]: 'Theirs' } })
    await reload()
    expect(ws().saved?.id).toBe(w.a)
    expect(ws().isDirty).toBe(false)
    expect(useUndoStore.getState().snackbar?.description).toBe('The unsaved new layout “Untitled layout” was dropped: a layout shows only its own lists, and it wasn’t stored yet.')
  })

  it('a kept new layout that shows no list is taken back', async () => {
    const w = await world()
    writeLayoutDraft({ kind: 'new', name: 'Plain', body: layoutBodyOf(layoutWith('N', [createTab('notes', 'n')])), listNames: {} })
    await reload()
    expect(ws().saved).toBeNull()
    expect(ws().working?.name).toBe('Plain')
    expect(ws().previousLayoutId).toBe(w.a)
  })

  it('a kept draft made before its layout got copies of the lists it shared (an upgrade) reopens on the copies', async () => {
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
    expect(ws().isDirty).toBe(true)
    expect([...layoutListRefs(ws().working!)].sort((x, y) => x - y)).toEqual([w.theirs, copy].sort((x, y) => x - y))
    expect(ws().working!.columns[0]!.cells[0]!.tabs.map((t) => t.id)).toEqual(['t', 'm1b', 'nb'])
  })

  it('a kept draft that shows another layout’s list is dropped, and says so', async () => {
    const w = await world()
    const base = layoutBodyOf(layoutWith('B', [lens('t', w.theirs)]))
    writeLayoutDraft({ kind: 'saved', layoutId: w.b, base, body: layoutBodyOf(layoutWith('B', [lens('t', w.theirs), lens('x', w.mine1)])) })
    await layoutRepository.setActiveId(w.b)
    await reload()
    expect(ws().saved?.id).toBe(w.b)
    expect(ws().isDirty).toBe(false)
    expect(useUndoStore.getState().snackbar?.description).toBe('Unsaved changes to layout “B” were dropped: they showed another layout’s list.')
  })

  it('a kept draft of another layout than the one opening is dropped, and so are the lists only it showed', async () => {
    const w = await world()
    const fresh = await useListDefinitionStore.getState().add({ name: 'Fresh', owner: { layoutId: w.a } })
    ws().addWidget('lens', { kind: 'cell', cellId: 'k-A' }, { listDefinitionId: fresh })
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
    ws().addWidget('lens', { kind: 'cell', cellId: 'k-A' }, { listDefinitionId: fresh })
    // The stored layout changed meanwhile (e.g. saved from another tab).
    await db.layouts.update(w.a, layoutWith('A', [lens('s', w.saved), lens('m1', w.mine1)]))
    await reload()
    expect(ws().isDirty).toBe(false)
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

  it('a Save that no longer shows it hands it to the other layout instead of deleting it', async () => {
    const w = await world()
    await db.layouts.update(w.b, layoutWith('B', [lens('t', w.theirs), lens('m1b', w.mine1)]))
    ws().closeTab('m1')
    expect(await ws().save()).toBe(true)
    expect((await db.listDefinitions.get(w.mine1))?.owner).toEqual({ layoutId: w.b })
    expect(useUndoStore.getState().snackbar?.description).not.toBe('Removed the list “Mine 1”')
  })

  /** Layout A stored with a tab this build can't read (a number id) that shows Mine 2: it opens repaired, without it. */
  async function repairedWorld(): Promise<World> {
    const w = await world()
    const row = await stored(w.a)
    const cell = row.columns[0]!.cells[0]!
    await db.layouts.put({ ...row, columns: [{ ...row.columns[0]!, cells: [{ ...cell, tabs: [...cell.tabs.filter((t) => t.id !== 'm2'), { ...lens('x', w.mine2), id: 7 as unknown as string }] }] }] })
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
    await ws().init()
    expect(ws().repairedIds.has(w.a)).toBe(true)
    return w
  }

  it('Save of a layout the repair changed removes the lists only the dropped parts showed, as an undo step (Undo brings them back)', async () => {
    const w = await repairedWorld()
    expect(await ws().save()).toBe(true)
    expect(await storedListIds()).not.toContain(w.mine2)
    expect(useUndoStore.getState().snackbar?.description).toBe('Removed the list “Mine 2”')
    // The lists the saved layout shows stay its own.
    expect((await db.listDefinitions.get(w.mine1))?.owner).toEqual({ layoutId: w.a })
    await useUndoStore.getState().undo()
    expect((await db.listDefinitions.get(w.mine2))?.owner).toEqual({ layoutId: w.a })
  })

  it('Save as from a layout the repair changed keeps the lists its stored row still names', async () => {
    const w = await world()
    // A tab this build can't read (a number id) that shows Mine 2: the layout opens repaired, without it.
    const row = await stored(w.a)
    const cell = row.columns[0]!.cells[0]!
    await db.layouts.put({ ...row, columns: [{ ...row.columns[0]!, cells: [{ ...cell, tabs: [...cell.tabs.filter((t) => t.id !== 'm2'), { ...lens('x', w.mine2), id: 7 as unknown as string }] }] }] })
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
    await ws().init()
    expect(ws().repairedIds.has(w.a)).toBe(true)
    expect(layoutListRefs(ws().working!).has(w.mine2)).toBe(false)
    await ws().saveAs('A copy')
    expect(await storedListIds()).toContain(w.mine2)
  })
})

describe('layout Save as', () => {
  it('copies the shown own lists — as edited, with their manual order — for the new layout, whose tabs show the copies', async () => {
    const w = await world()
    editName(w.mine1, 'Mine 1 edited')
    useListDraftStore.getState().edit(w.mine1, (d) => ({ ...d, sort: 'deadline' }))
    const before = layoutBodyOf(await stored(w.a))
    const id = await ws().saveAs('A copy')
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
    expect(ws().isDirty).toBe(false)
    expect(storeListIds()).toEqual(expect.arrayContaining([copy1.id, copy2.id]))
    expect(useListOrderStore.getState().ranks.get(copy1.id)?.size).toBe(2)
    // The originals stay with A, their edits still unsaved; A as last saved.
    expect(await storedListIds()).toEqual(expect.arrayContaining([w.saved, w.mine1, w.mine2]))
    expect(useListDraftStore.getState().drafts[w.mine1]?.name).toBe('Mine 1 edited')
    expect(layoutBodyOf(await stored(w.a))).toEqual(before)
    // The copy edits on its own.
    editName(copy2.id, 'Copy only')
    expect(useListDraftStore.getState().drafts[w.mine2]).toBeUndefined()
  })

  it('an own list only the edits showed is copied, and the original (no saved tab of its layout shows it) goes', async () => {
    const w = await world()
    const fresh = await useListDefinitionStore.getState().add({ name: 'New here', owner: { layoutId: w.a } })
    ws().addWidget('lens', { kind: 'cell', cellId: 'k-A' }, { listDefinitionId: fresh })
    const id = await ws().saveAs('With new')
    const lists = (await db.listDefinitions.toArray()) as PersistedListDefinition[]
    expect(lists.find((d) => d.id === fresh)).toBeUndefined()
    expect(lists.filter((d) => d.name === 'New here').map((d) => d.owner)).toEqual([{ layoutId: id }])
    expect(storeListIds()).not.toContain(fresh)
  })

  it('a failed write makes nothing: no layout, no copies', async () => {
    await world()
    const count = await db.listDefinitions.count()
    const insert = layoutRepository.insert
    layoutRepository.insert = () => Promise.reject(new Error('full'))
    try {
      expect(await ws().saveAs('Nope')).toBeNull()
    } finally {
      layoutRepository.insert = insert
    }
    expect(await db.listDefinitions.count()).toBe(count)
    expect(await db.layouts.count()).toBe(2)
    expect(useUndoStore.getState().snackbar?.description).toBe('Couldn\'t save layout "Nope".')
  })
})

describe('Delete layout', () => {
  it('deletes the open layout’s own lists, their manual order and unsaved edits; never another layout’s or the Eisenhower’s', async () => {
    const w = await world()
    editName(w.mine2, 'Edited')
    expect(await ws().delete(w.a)).toBe(true)
    expect(await storedListIds()).toEqual([w.theirs, w.eisenhower])
    expect(storeListIds()).toEqual([w.theirs, w.eisenhower])
    expect(await ranksOf(w.mine1)).toEqual([])
    expect(useListDraftStore.getState().drafts[w.mine2]).toBeUndefined()
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
