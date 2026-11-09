import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useUndoStore } from '../../stores/undo-store'
import { createTab, type PersistedWorkspaceLayout, type WorkspaceLayout } from '../../models/workspace-layout'
import { resetDb } from '../helpers'
import { emptyBody, grid, single } from '../helpers/layout-builders'

// A layout row the app can't use as stored (here: a retired `status` tab and
// a bad row size, as an old build or a hand edit leaves it) is repaired in
// memory when read: the workspace opens it without the bad parts, unsaved,
// and says so. The stored row changes only when the layout is saved.

const T0 = new Date('2026-09-01T09:00:00.000Z')

function corrupt(name = 'Daily'): Omit<WorkspaceLayout, 'id'> {
  return {
    sortOrder: 0, name,
    createdAt: T0,
    modifiedAt: T0,
    // ka | kb over one row (R, its size bad); ka holds a retired tab.
    ...grid([[
      { id: 'ka', activeTabId: 'a1', tabs: [createTab('notes', 'a1'), { id: 'old', kind: 'taskboard', config: {} } as never] },
      { id: 'kb', tabs: [createTab('calendar', 'b1')] },
    ]], { colIds: ['A', 'B'], rowIds: ['R'], rows: [-1] }),
  }
}

function valid(name = 'Plain'): Omit<WorkspaceLayout, 'id'> {
  return { sortOrder: 0, name, createdAt: T0, modifiedAt: T0, ...single({ id: 'kp', tabs: [createTab('notes', 'p1')] }) }
}

async function storedRow(id: number): Promise<PersistedWorkspaceLayout> {
  const row = (await db.layouts.get(id)) as PersistedWorkspaceLayout | undefined
  if (!row) throw new Error(`no layout ${id}`)
  return row
}

const ws = () => useWorkspaceStore.getState()
const notice = () => useUndoStore.getState().snackbar

beforeEach(async () => {
  await resetDb()
  vi.spyOn(console, 'warn').mockImplementation(() => {}).mockClear()
})

describe('layoutRepository reads', () => {
  it('a valid row comes back as stored, with no fixes', async () => {
    const id = await layoutRepository.insert(valid())
    const read = await layoutRepository.get(id)
    expect(read?.fixes).toEqual([])
    expect(read?.layout).toEqual(await storedRow(id))
  })

  it('a row with parts this build can’t use comes back repaired, saying what was fixed; the row is untouched', async () => {
    const id = await layoutRepository.insert(corrupt())
    const before = await storedRow(id)
    const read = await layoutRepository.get(id)
    expect(read?.fixes).toEqual(['size reset', 'tab dropped'])
    expect(read?.layout).toMatchObject({ id, name: 'Daily' })
    expect(read?.layout.grid.rows[0]).toEqual({ id: 'R', weight: 1000 })
    expect(read?.layout.cells[0]).toMatchObject({ tabs: [{ id: 'a1', kind: 'notes' }] })
    expect(await storedRow(id)).toEqual(before)
    const all = await layoutRepository.getAll()
    expect(all.map((r) => r.fixes)).toEqual([['size reset', 'tab dropped']])
  })

  it('a layout with nothing usable left keeps existing, with no cells (the empty-layout tiles)', async () => {
    const id = await layoutRepository.insert({ name: 'Broken', createdAt: T0, modifiedAt: T0, grid: { columns: [], rows: [] }, cells: ['nope' as never] })
    const read = await layoutRepository.get(id)
    expect(read?.layout).toMatchObject({ id, name: 'Broken', ...emptyBody() })
    expect(read?.fixes).toEqual(['cell dropped'])
  })
})

describe('the workspace store opens a repaired layout unsaved', () => {
  it('init: the bad parts are gone, the layout is unsaved, the snackbar says what was repaired', async () => {
    const id = await layoutRepository.insert(corrupt())
    await layoutRepository.setActiveId(id)
    await ws().init()
    expect(ws().working?.cells[0]?.tabs.map((t) => t.kind)).toEqual(['notes'])
    expect(ws().isDirty).toBe(true)
    expect(notice()).toEqual({ description: 'Repaired layout "Daily" — size reset, tab dropped. Save it to keep the repair.', notice: true })
  })

  it('nothing writes the repair back until Save; Save writes it and the layout is saved', async () => {
    const id = await layoutRepository.insert(corrupt())
    await layoutRepository.setActiveId(id)
    await ws().init()
    const before = await storedRow(id)

    // View state stays in memory; a rename writes only the name.
    await ws().setActiveTab('a1')
    await ws().setTrackCollapsed('R', true)
    await ws().setTrackSizes({ A: 2000 })
    expect(ws().working?.grid.rows[0]?.collapsed).toBe(true)
    await ws().rename(id, 'Daily 2')
    expect(await storedRow(id)).toEqual({ ...before, name: 'Daily 2' })
    // Discard goes back to the repaired layout — still unsaved.
    expect(ws().addWidget('notes', { kind: 'insert', edge: 'left' })).not.toBeNull()
    expect(ws().working?.grid.columns).toHaveLength(3)
    ws().discard()
    expect(ws().isDirty).toBe(true)
    expect(ws().working?.grid.columns).toHaveLength(2)

    await ws().save()
    expect(ws().isDirty).toBe(false)
    const row = await storedRow(id)
    expect(row.cells[0]).toMatchObject({ tabs: [{ id: 'a1', kind: 'notes' }] })
    expect(row.grid.columns[0]?.weight).toBe(2000)
    expect((await layoutRepository.get(id))?.fixes).toEqual([])
    // Saved now: view state is written again.
    await ws().setTrackCollapsed('R', false)
    expect((await storedRow(id)).grid.rows[0]?.collapsed).toBeUndefined()
  })

  it('load: switching to a repaired layout opens it unsaved with the notice; switching back to a valid one is saved', async () => {
    const [plain, broken] = [await layoutRepository.insert(valid()), await layoutRepository.insert(corrupt('Old'))]
    await layoutRepository.setActiveId(plain)
    await ws().init()
    expect(ws().isDirty).toBe(false)
    expect(notice()).toBeNull()

    await ws().load(broken)
    expect(ws().activeLayoutId).toBe(broken)
    expect(ws().isDirty).toBe(true)
    expect(notice()?.description).toBe('Repaired layout "Old" — size reset, tab dropped. Save it to keep the repair.')
    // Only the last-used time was written.
    expect((await storedRow(broken)).cells[0]?.tabs).toHaveLength(2)
    expect((await storedRow(broken)).lastUsedAt).toBeInstanceOf(Date)

    await ws().load(plain)
    expect(ws().isDirty).toBe(false)
  })

  it('a valid layout opens saved and silent', async () => {
    const id = await layoutRepository.insert(valid())
    await layoutRepository.setActiveId(id)
    await ws().init()
    expect(ws().isDirty).toBe(false)
    expect(notice()).toBeNull()
    expect(console.warn).not.toHaveBeenCalled()
  })
})
