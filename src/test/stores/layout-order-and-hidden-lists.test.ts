import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import { createTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { emptyPredicate } from '../../models/filter-predicate'
import type { ListDefinition } from '../../models/list-definition'
import { settleLayoutWrites, useWorkspaceStore } from '../../stores/workspace-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListDraftStore } from '../../stores/list-draft-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'
import { single } from '../helpers/layout-builders'
import { layoutSteps } from '../helpers/layout-steps'

const T0 = new Date('2026-09-01T09:00:00.000Z')

const layout = (name: string): Omit<WorkspaceLayout, 'id' | 'sortOrder'> => ({
  name, createdAt: T0, modifiedAt: T0,
  ...single({ id: 'ka', tabs: [createTab('notes', `${name}-n`)] }),
})

async function seedLayouts(...names: string[]): Promise<number[]> {
  const ids: number[] = []
  for (const n of names) ids.push(await layoutRepository.insert(layout(n)))
  await layoutRepository.setActiveId(ids[0]!)
  await useWorkspaceStore.getState().init()
  return ids
}

const ws = () => useWorkspaceStore.getState()
const names = () => ws().layouts.map((l) => l.name)
const storedOrder = async () => (await layoutRepository.getAll()).map((r) => r.layout.name)

const list = (name: string, extra: Partial<ListDefinition> = {}): ListDefinition => ({
  name, sortOrder: 0, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() }, ...extra,
})

beforeEach(async () => {
  await resetDb()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useListDefinitionStore.setState({ listDefinitions: [], loaded: false })
  useListDraftStore.setState({ drafts: {} })
})

describe('workspace store: the layout order', () => {
  it('layouts open in their stored order', async () => {
    await seedLayouts('A', 'B', 'C')
    await layoutRepository.reorder([3, 1, 2])
    await ws().init()
    expect(names()).toEqual(['C', 'A', 'B'])
  })

  it('reorderLayouts shows and saves the new order at once; nothing becomes unsaved', async () => {
    const [a, b, c] = await seedLayouts('A', 'B', 'C')
    expect(await ws().reorderLayouts([c!, a!])).toBe(true)
    // A layout left out keeps its place after the named ones.
    expect(names()).toEqual(['C', 'A', 'B'])
    expect(ws().layouts.map((l) => l.sortOrder)).toEqual([0, 1, 2])
    expect(await storedOrder()).toEqual(['C', 'A', 'B'])
    expect(layoutSteps()).toEqual([])
    expect(ws().saved?.sortOrder).toBe(1)
    expect(ws().working?.sortOrder).toBe(1)
    void b
  })

  it('an edit after a reorder keeps the new order', async () => {
    const [a, b] = await seedLayouts('A', 'B')
    await ws().reorderLayouts([b!, a!])
    ws().closeTab('A-n')
    await settleLayoutWrites()
    expect(await storedOrder()).toEqual(['B', 'A'])
  })

  it('a failed write puts the order on screen back and says so', async () => {
    const [a, b] = await seedLayouts('A', 'B')
    const spy = vi.spyOn(layoutRepository, 'reorder').mockRejectedValueOnce(new Error('disk full'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await ws().reorderLayouts([b!, a!])).toBe(false)
    expect(names()).toEqual(['A', 'B'])
    expect(ws().saved?.sortOrder).toBe(0)
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: "Couldn't save the layout order.", notice: true })
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    spy.mockRestore()
  })

  it('a reorder is one undo step: Undo puts the old order back, Redo the new one, both saved', async () => {
    const [a, b, c] = await seedLayouts('A', 'B', 'C')
    expect(await ws().moveLayout(c!, 0)).toBe(true)
    expect(names()).toEqual(['C', 'A', 'B'])
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Moved layout “C”'])
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'Moved layout “C”' })
    await useUndoStore.getState().undo()
    expect(names()).toEqual(['A', 'B', 'C'])
    expect(await storedOrder()).toEqual(['A', 'B', 'C'])
    await useUndoStore.getState().redo()
    expect(names()).toEqual(['C', 'A', 'B'])
    expect(await storedOrder()).toEqual(['C', 'A', 'B'])
    expect(layoutSteps()).toEqual([])
    void a
    void b
  })

  it('moveLayout: one step left / right, clamped at the ends; no move = no undo step', async () => {
    const [a, b] = await seedLayouts('A', 'B', 'C')
    expect(await ws().moveLayout(a!, 1)).toBe(true)
    expect(names()).toEqual(['B', 'A', 'C'])
    expect(await ws().moveLayout(b!, -1)).toBe(true)
    expect(names()).toEqual(['B', 'A', 'C'])
    expect(await ws().moveLayout(a!, 9)).toBe(true)
    expect(names()).toEqual(['B', 'C', 'A'])
    expect(useUndoStore.getState().undoStack).toHaveLength(2)
    expect(await ws().reorderLayouts([b!])).toBe(true)
    expect(useUndoStore.getState().undoStack).toHaveLength(2)
    expect(await ws().moveLayout(999, 0)).toBe(false)
  })

  it('a failed undo keeps the entry to try again', async () => {
    const [, , c] = await seedLayouts('A', 'B', 'C')
    await ws().moveLayout(c!, 0)
    vi.spyOn(layoutRepository, 'reorder').mockRejectedValueOnce(new Error('disk full'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await useUndoStore.getState().undo()
    expect(names()).toEqual(['C', 'A', 'B'])
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Moved layout “C”'])
    await useUndoStore.getState().undo()
    expect(names()).toEqual(['A', 'B', 'C'])
  })

  it('Duplicate layout puts the new layout last', async () => {
    const [a, b] = await seedLayouts('A', 'B')
    await ws().reorderLayouts([b!, a!])
    const copy = await ws().duplicateLayout('Copy')
    expect(names()).toEqual(['B', 'A', 'Copy'])
    expect(ws().saved).toMatchObject({ id: copy, sortOrder: 2 })
    expect(await storedOrder()).toEqual(['B', 'A', 'Copy'])
  })
})

describe('list store: hidden lists', () => {
  it('the retired Eisenhower’s list is never loaded: it stays stored, untouched', async () => {
    const retired = await db.listDefinitions.add(list('Eisenhower', { owner: { eisenhower: true } }))
    const mine = await db.listDefinitions.add(list('Mine', { owner: { layoutId: 1 } }))
    await useListDefinitionStore.getState().load()
    expect(useListDefinitionStore.getState().listDefinitions.map((d) => d.id)).toEqual([mine])
    expect(await db.listDefinitions.get(retired)).toMatchObject({ name: 'Eisenhower', owner: { eisenhower: true } })
  })

  it('a list edit never changes who the list belongs to (an edit without the owner keeps it)', async () => {
    const id = await db.listDefinitions.add(list('Mine', { owner: { layoutId: 1 } }))
    await useListDefinitionStore.getState().load()
    const saved = useListDefinitionStore.getState().listDefinitions[0]!
    const { owner: _o, ...withoutOwner } = saved
    void _o
    await useListDefinitionStore.getState().editList(id, () => ({ ...withoutOwner, grouping: 'people' }), 'Edited')
    expect(await db.listDefinitions.get(id)).toMatchObject({ grouping: 'people', owner: { layoutId: 1 } })
    // A list with no owner stays so, whatever the edit holds.
    const other = await db.listDefinitions.add(list('Saved'))
    await useListDefinitionStore.getState().load()
    await useListDefinitionStore.getState().editList(other, (d) => ({ ...d, grouping: 'tag', owner: { layoutId: 3 } }), 'Edited')
    expect('owner' in (await db.listDefinitions.get(other))!).toBe(false)
  })
})

describe('settings store: new tasks get a follow-up', () => {
  it('on by default; off is stored as false, on removes the row; a load reads it', async () => {
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().autoFollowup).toBe(true)
    await useSettingsStore.getState().setAutoFollowup(false)
    expect(await db.settings.get('newTaskFollowup')).toEqual({ key: 'newTaskFollowup', value: 'false' })
    useSettingsStore.setState({ autoFollowup: true })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().autoFollowup).toBe(false)
    await useSettingsStore.getState().setAutoFollowup(true)
    expect(await db.settings.get('newTaskFollowup')).toBeUndefined()
    expect(useSettingsStore.getState().autoFollowup).toBe(true)
  })
})
