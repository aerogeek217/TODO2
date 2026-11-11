import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import { createTab, type LayoutTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { emptyPredicate } from '../../models/filter-predicate'
import type { ListDefinition, PersistedListDefinition } from '../../models/list-definition'
import { replaceData } from '../../services/replace-data'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListOrderStore } from '../../stores/list-order-store'
import { replaceHoldActive } from '../../stores/replace-hold'
import { useUndoStore } from '../../stores/undo-store'
import { settleLayoutWrites, useWorkspaceStore } from '../../stores/workspace-store'
import { layoutListRefs } from '../../utils/workspace-layout-lists'
import { resetDb } from '../helpers'
import { single } from '../helpers/layout-builders'

/**
 * The window between a data replace's write and the reload of the stores
 * (`replace-data`, `refresh-all`): the workspace and list stores still hold
 * the replaced data, and their writes put whole rows. An edit made then
 * must not write the old layout or list over the new data, nor prune the
 * new data's lists by the old layout's tabs (`stores/replace-hold`).
 */
const T0 = new Date('2026-09-01T09:00:00.000Z')
const ws = () => useWorkspaceStore.getState()
const lens = (id: string, listDefinitionId: number): LayoutTab => createTab('lens', id, { listDefinitionId })
function layoutWith(name: string, tabs: LayoutTab[]): Omit<WorkspaceLayout, 'id' | 'sortOrder'> {
  return { name, createdAt: T0, modifiedAt: T0, ...single({ id: `k-${name}`, tabs }, { prefix: `${name}-` }) }
}
function def(id: number, name: string, layoutId: number): ListDefinition {
  return { id, name, sortOrder: 0, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() }, owner: { layoutId } }
}

beforeEach(async () => {
  await resetDb()
  useListDefinitionStore.setState({ listDefinitions: [], loaded: false })
  useListOrderStore.setState({ ranks: new Map(), loaded: false })
})

/** Layout 1 shows its lists 10 and 11 (open); the replacing data has layout 1 showing its list 20. */
async function oldWorld(): Promise<void> {
  await db.listDefinitions.bulkAdd([def(10, 'Old A', 1), def(11, 'Old B', 1)])
  await db.layouts.add({ id: 1, sortOrder: 0, ...layoutWith('Old', [lens('a', 10), lens('b', 11)]) })
  await layoutRepository.setActiveId(1)
  await useListDefinitionStore.getState().load()
  await ws().init()
}

/** The replacing data: layout 1 (another layout under the same id) showing list 20. */
async function writeNewData(): Promise<void> {
  await db.layouts.clear()
  await db.listDefinitions.clear()
  await db.listDefinitions.add(def(20, 'New', 1))
  await db.layouts.add({ id: 1, sortOrder: 0, ...layoutWith('New', [lens('n', 20)]) })
}

/** The stored lists of layouts. */
async function layoutLists(): Promise<PersistedListDefinition[]> {
  return ((await db.listDefinitions.toArray()) as PersistedListDefinition[]).filter((d) => d.owner && 'layoutId' in d.owner)
}

describe('a data replace holds layout and list writes until the stores have reloaded', () => {
  it('an edit made after the write and before the reload writes nothing over the new data', async () => {
    await oldWorld()
    let heldDuringWrite = false
    await replaceData('import', {
      backup: 'best-effort',
      write: async () => {
        await writeNewData()
        heldDuringWrite = replaceHoldActive()
        // The user closes a tab, switches a list's lens, undoes, renames the layout — on the old data in memory.
        ws().closeTab('a')
        await ws().setActiveTab('b')
        await useListDefinitionStore.getState().setIgnoreLens(11, true)
        await useListDefinitionStore.getState().editList(10, (d) => ({ ...d, name: 'Renamed' }), 'Edited list')
        await ws().rename(1, 'Renamed layout')
        await useUndoStore.getState().undo()
      },
    })
    await settleLayoutWrites()
    // The new data, untouched: its layout, and its list (not pruned by the old layout's tabs).
    const stored = (await layoutRepository.get(1))!.layout
    expect(stored.name).toBe('New')
    expect([...layoutListRefs(stored)]).toEqual([20])
    expect((await layoutLists()).map((d) => [d.id, d.name, d.ignoreLens ?? false])).toEqual([[20, 'New', false]])
    // The stores show the new data.
    expect(ws().saved?.name).toBe('New')
    expect(heldDuringWrite).toBe(true)
    expect(replaceHoldActive()).toBe(false)
    expect(useListDefinitionStore.getState().listDefinitions.filter((d) => d.owner && 'layoutId' in d.owner).map((d) => d.id)).toEqual([20])
  })

  it('a layout write already running when the replace starts lands before it', async () => {
    await oldWorld()
    ws().closeTab('a')
    await replaceData('import', { backup: 'best-effort', write: writeNewData })
    await settleLayoutWrites()
    expect((await layoutRepository.get(1))!.layout.name).toBe('New')
    expect((await layoutLists()).map((d) => d.id)).toEqual([20])
  })

  it('edits write again once the replace is done', async () => {
    await oldWorld()
    await replaceData('import', { backup: 'best-effort', write: writeNewData })
    expect(await useListDefinitionStore.getState().editList(20, (d) => ({ ...d, name: 'After' }), 'Edited list')).toBe(true)
    expect((await db.listDefinitions.get(20))!.name).toBe('After')
  })
})
